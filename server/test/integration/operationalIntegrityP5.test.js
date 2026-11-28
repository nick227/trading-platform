import { randomBytes } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'

const h = vi.hoisted(() => ({ db: null, brokers: new Map() }))
vi.mock('../../../worker/src/db/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../../worker/src/broker/clientCache.js', () => ({ getBrokerClient: async (userId) => h.brokers.get(userId) ?? null }))
vi.mock('../../src/services/metricsService.js', () => ({ default: { processExecutionFill: async () => {} } }))
vi.mock('../../../worker/src/logger.js', () => ({ log: { info() {}, warn() {}, error() {}, debug() {} } }))

const { FakeBroker } = await import('../support/fakePaperBroker.js')
const worker = await import('../../../worker/src/queues/orderWorker.js')
const { reconcileBrokerActivity } = await import('../../src/services/brokerReconciliationService.js')
const {
  AUTHORIZATION_MODES,
  buildAuthorizationEnvelope,
  buildMarketObservation,
  evaluateAndReserveTradeIntentTx,
  EXECUTION_TIMINGS
} = await import('../../src/policy/centralPolicyEngine.js')
const { MARKET_LATENCY_CLASSES } = await import('../../src/execution/providers/ExecutionProvider.js')
const {
  decrypt,
  encrypt,
  parseCiphertextVersion,
  reencryptWithCurrentKey,
  resetEncryptionKeyCache
} = await import('../../src/utils/encryption.js')

describe('P5 — Operational Integrity: Monotonic CAS Recovery, Drift Quarantine & Versioned Encryption', () => {
  const origFetch = global.fetch
  const origEnv = { ...process.env }

  beforeEach(async () => {
    process.env = { ...origEnv }
    resetEncryptionKeyCache()
    h.db = createMemoryPrisma()
    h.brokers.clear()
    let clock = new Date('2026-11-27T15:00:00Z')
    Object.assign(worker.orderWorkerConfig, {
      sleep: async () => {},
      now: () => { clock = new Date(clock.getTime() + 1); return new Date(clock) },
      fillTimeoutMs: 0,
      fillPollIntervalMs: 0,
      reconcileIntervalMs: 0,
      notFoundGraceMs: 60_000,
      stuckAfterMs: 120_000,
      cancelPollMs: 0,
      maxAttempts: 3,
      alpacaClientFactory: null
    })
  })

  afterAll(() => {
    global.fetch = origFetch
    process.env = origEnv
    resetEncryptionKeyCache()
  })

  it('prevents ABA stale-worker overwrites via monotonic version CAS and terminal-state immutability', async () => {
    await h.db.user.create({ data: { id: 'usr_p5_cas', email: 'cas@example.test', riskSettings: null } })
    await h.db.portfolio.create({ data: { id: 'por_p5_cas', userId: 'usr_p5_cas', environment: 'alpaca_paper' } })
    const fakeBroker = new FakeBroker('usr_p5_cas')
    h.brokers.set('usr_p5_cas', fakeBroker)

    const e = await h.db.execution.create({
      data: {
        id: 'exe_aba_1',
        userId: 'usr_p5_cas',
        portfolioId: 'por_p5_cas',
        ticker: 'SPY',
        direction: 'buy',
        quantity: 2,
        price: 580,
        clientOrderId: 'tp_exe_aba_1',
        status: 'queued',
        version: 0,
        createdAt: worker.orderWorkerConfig.now()
      }
    })

    // Simulate ABA race: while submitOrder is in flight, another recovery cycle increments version
    // and settles the row to terminal 'filled' — EVEN WITH THE SAME lockedBy WORKER_ID!
    const origSubmit = fakeBroker.submitOrder.bind(fakeBroker)
    fakeBroker.submitOrder = async (args) => {
      const res = await origSubmit(args)
      await h.db.execution.updateMany({
        where: { id: e.id },
        data: {
          status: 'filled',
          filledQuantity: 2,
          filledPrice: 580.10,
          brokerOrderId: res.alpacaOrderId,
          lockedBy: worker.WORKER_ID, // Same WORKER_ID (ABA scenario)
          version: { increment: 5 }
        }
      })
      return res
    }

    await worker.runOnce()

    // Stale in-flight worker MUST NOT downgrade terminal 'filled' back to 'submitted'!
    const finalRow = await h.db.execution.findUnique({ where: { id: e.id } })
    expect(finalRow.status).toBe('filled')
    expect(finalRow.filledPrice).toBe(580.10)
    expect(fakeBroker.submitCalls).toBe(1)

    const auditTypes = (await h.db.executionAudit.findMany({ where: { executionId: e.id } })).map((a) => a.eventType)
    expect(auditTypes).toContain('lease_lost')
  })

  it('automatically quarantines a brokerage portfolio on position drift and restores active status when reconciled clean', async () => {
    delete process.env.BROKER_MODE
    delete process.env.SIM_REPLAY_SESSION

    await h.db.user.create({ data: { id: 'usr_p5_drift', email: 'drift@example.test', riskSettings: null } })
    await h.db.brokerAccount.create({
      data: {
        id: 'brk_p5_drift',
        userId: 'usr_p5_drift',
        broker: 'alpaca',
        apiKey: encrypt('PK_DRIFT'),
        apiSecret: encrypt('SK_DRIFT'),
        paper: true,
        status: 'active'
      }
    })
    const portfolio = await h.db.portfolio.create({
      data: {
        id: 'prt_p5_drift',
        userId: 'usr_p5_drift',
        name: 'Brokerage Portfolio',
        accountKind: 'brokerage',
        environment: 'alpaca_paper',
        status: 'active'
      }
    })

    // Local DB believes user bought 10 AAPL, but Alpaca reports 0 AAPL -> unexplained drift!
    await h.db.execution.create({
      data: {
        id: 'exe_local_aapl',
        userId: 'usr_p5_drift',
        portfolioId: portfolio.id,
        ticker: 'AAPL',
        direction: 'buy',
        quantity: 10,
        price: 200,
        filledQuantity: 10,
        filledPrice: 200,
        status: 'filled',
        origin: 'bot'
      }
    })

    global.fetch = vi.fn(async (url) => {
      const u = String(url)
      if (u.includes('/v2/orders')) return { ok: true, status: 200, json: async () => [] }
      if (u.includes('/v2/positions')) return { ok: true, status: 200, json: async () => [] }
      return { ok: true, status: 200, json: async () => ({}) }
    })

    const driftSync = await reconcileBrokerActivity('usr_p5_drift')
    expect(driftSync.inSync).toBe(false)
    expect(driftSync.mismatchCount).toBe(1)

    const quarantined = await h.db.portfolio.findUnique({ where: { id: portfolio.id } })
    expect(quarantined.status).toBe('quarantined_drift')

    // CentralPolicyEngine MUST block new orders while portfolio is quarantined_drift!
    const now = new Date('2026-11-27T15:10:00Z')
    const blockedIntent = await h.db.$transaction((tx) =>
      evaluateAndReserveTradeIntentTx(tx, {
        userId: 'usr_p5_drift',
        portfolioId: portfolio.id,
        symbol: 'MSFT',
        side: 'buy',
        quantity: 1,
        referencePrice: 400,
        executionTiming: EXECUTION_TIMINGS.IMMEDIATE,
        authorization: buildAuthorizationEnvelope({
          authorizationMode: AUTHORIZATION_MODES.USER_MANUAL,
          actorUserId: 'usr_p5_drift',
          authorizedAt: now
        }),
        marketObservation: buildMarketObservation({
          symbol: 'MSFT',
          price: 400,
          observedAt: now,
          latencyClass: MARKET_LATENCY_CLASSES.REALTIME_STREAM
        }),
        now
      })
    )
    expect(blockedIntent.allowed).toBe(false)
    expect(blockedIntent.reason).toBe('portfolio_not_active:quarantined_drift')

    // Once Alpaca reports the matching 10 AAPL shares, reconciliation clears the quarantine automatically!
    global.fetch = vi.fn(async (url) => {
      const u = String(url)
      if (u.includes('/v2/orders')) return { ok: true, status: 200, json: async () => [] }
      if (u.includes('/v2/positions')) {
        return { ok: true, status: 200, json: async () => [{ symbol: 'AAPL', qty: '10', avg_entry_price: '200.00' }] }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })

    const cleanSync = await reconcileBrokerActivity('usr_p5_drift')
    expect(cleanSync.inSync).toBe(true)
    const restored = await h.db.portfolio.findUnique({ where: { id: portfolio.id } })
    expect(restored.status).toBe('active')
  })

  it('supports v1 versioned AES-256-GCM encryption, legacy v0 ciphertexts, and zero-downtime key rotation', () => {
    const key1 = randomBytes(32).toString('hex')
    const key2 = randomBytes(32).toString('hex')

    process.env.ENCRYPTION_KEY = key1
    delete process.env.ENCRYPTION_KEY_CURRENT
    delete process.env.ENCRYPTION_KEY_PREVIOUS
    resetEncryptionKeyCache()

    const v1Cipher = encrypt('PK_SECRET_ALPHA_999')
    expect(parseCiphertextVersion(v1Cipher)).toBe('v1')
    expect(decrypt(v1Cipher)).toBe('PK_SECRET_ALPHA_999')

    // Simulate legacy 3-part unprefixed v0 ciphertext
    const legacyV0Cipher = v1Cipher.slice(3)
    expect(parseCiphertextVersion(legacyV0Cipher)).toBe('legacy_v0')
    expect(decrypt(legacyV0Cipher)).toBe('PK_SECRET_ALPHA_999')

    // Rotate to key2 while retaining key1 in ENCRYPTION_KEY_PREVIOUS
    process.env.ENCRYPTION_KEY = key2
    process.env.ENCRYPTION_KEY_PREVIOUS = key1
    resetEncryptionKeyCache()

    // Old ciphertexts still decrypt seamlessly via previous key
    expect(decrypt(v1Cipher)).toBe('PK_SECRET_ALPHA_999')
    expect(decrypt(legacyV0Cipher)).toBe('PK_SECRET_ALPHA_999')

    // Re-encrypt upgrades ciphertext to key2; removing ENCRYPTION_KEY_PREVIOUS still succeeds!
    const rotatedCipher = reencryptWithCurrentKey(legacyV0Cipher)
    delete process.env.ENCRYPTION_KEY_PREVIOUS
    resetEncryptionKeyCache()

    expect(parseCiphertextVersion(rotatedCipher)).toBe('v1')
    expect(decrypt(rotatedCipher)).toBe('PK_SECRET_ALPHA_999')
    expect(() => decrypt(v1Cipher)).toThrow()
  })
})
