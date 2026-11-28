import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'
import { encrypt } from '../../src/utils/encryption.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../worker/src/db/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../src/services/metricsService.js', () => ({ default: { processExecutionFill: async () => {} } }))
vi.mock('../../../worker/src/logger.js', () => ({ log: { info() {}, warn() {}, error() {}, debug() {} } }))

const { FakeBroker } = await import('../support/fakePaperBroker.js')
const worker = await import('../../../worker/src/queues/orderWorker.js')
const { clearProviderRegistryCache, resolveExecutionProviderForPortfolio } = await import('../../src/execution/providerRegistry.js')
const { AlpacaLiveProvider } = await import('../../src/execution/providers/AlpacaLiveProvider.js')
const { LiveExecutionDisabledError } = await import('../../src/execution/providers/ExecutionProvider.js')
const { settleScheduledSimulatedExecution } = await import('../../src/execution/executionGateway.js')
const { newPaperForwardState, stepResearchPaperForward } = await import('../../src/services/researchPartner/paperStrategyForward.js')

describe('P2 — Interchangeable Execution Providers & Simulation Consolidation', () => {
  const savedBrokerMode = process.env.BROKER_MODE
  const savedReplay = process.env.SIM_REPLAY_SESSION

  beforeEach(async () => {
    delete process.env.BROKER_MODE
    delete process.env.SIM_REPLAY_SESSION
    clearProviderRegistryCache()
    h.db = createMemoryPrisma()
    let clock = new Date('2026-11-25T15:00:00Z')
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
      engine: {
        getSessionClose: async (ticker, session) => ({
          ticker,
          session: session || '2026-11-25',
          open: 141.5,
          close: 143.25,
          source: 'alpha-engine'
        })
      }
    })
  })

  it('executes internal_sim and alpaca_paper portfolios side-by-side in the same worker without global BROKER_MODE', async () => {
    const fakeAlpacaPaper = new FakeBroker('usr_mixed')
    worker.orderWorkerConfig.alpacaClientFactory = () => ({
      ...fakeAlpacaPaper,
      paper: true,
      submitOrder: (req) => fakeAlpacaPaper.submitOrder(req),
      getOrder: (id) => fakeAlpacaPaper.getOrder(id),
      getOrderByClientOrderId: (cid) => fakeAlpacaPaper.getOrderByClientOrderId(cid),
      cancelOrder: (id) => fakeAlpacaPaper.cancelOrder(id),
      getAccount: () => fakeAlpacaPaper.getAccount(),
      getPositions: () => fakeAlpacaPaper.getPositions(),
      getClock: () => fakeAlpacaPaper.getClock()
    })

    await h.db.user.create({ data: { id: 'usr_mixed', email: 'mixed@example.test', riskSettings: null } })

    // Portfolio A: Internal Simulator ($10,000)
    await h.db.portfolio.create({
      data: {
        id: 'prt_sim_a',
        userId: 'usr_mixed',
        name: 'Internal Sim Sandbox',
        accountKind: 'simulated_custom',
        environment: 'internal_sim',
        status: 'active',
        cashBalance: 10_000,
        totalValue: 10_000
      }
    })

    // Portfolio B: Alpaca Paper Connection (#PA-9000)
    await h.db.brokerConnection.create({
      data: {
        id: 'bcn_pa9000',
        userId: 'usr_mixed',
        provider: 'alpaca',
        environment: 'alpaca_paper',
        externalAccountId: 'PA9000',
        encryptedApiKey: encrypt('PK_PAPER_9000'),
        encryptedApiSecret: encrypt('SK_PAPER_9000'),
        status: 'active'
      }
    })
    await h.db.portfolio.create({
      data: {
        id: 'prt_paper_b',
        userId: 'usr_mixed',
        name: 'Alpaca Paper PA9000',
        accountKind: 'brokerage',
        environment: 'alpaca_paper',
        brokerConnectionId: 'bcn_pa9000',
        status: 'active',
        cashBalance: 0,
        totalValue: 0
      }
    })

    const now = worker.orderWorkerConfig.now()
    await h.db.execution.create({
      data: {
        id: 'exe_sim_1',
        userId: 'usr_mixed',
        portfolioId: 'prt_sim_a',
        ticker: 'NVDA',
        direction: 'buy',
        quantity: 5,
        price: 143,
        clientOrderId: 'tp_exe_sim_1',
        status: 'queued',
        createdAt: now
      }
    })
    await h.db.execution.create({
      data: {
        id: 'exe_alp_1',
        userId: 'usr_mixed',
        portfolioId: 'prt_paper_b',
        ticker: 'AAPL',
        direction: 'buy',
        quantity: 4,
        price: 225,
        clientOrderId: 'tp_exe_alp_1',
        status: 'queued',
        createdAt: now
      }
    })

    // Drain both orders in the exact same worker loop
    await worker.runOnce()
    await worker.runOnce()

    const simOrder = await h.db.execution.findUnique({ where: { id: 'exe_sim_1' } })
    const alpOrder = await h.db.execution.findUnique({ where: { id: 'exe_alp_1' } })

    // Sim order filled deterministically via InternalSimulatorProvider without touching Alpaca!
    expect(simOrder.status).toBe('filled')
    expect(simOrder.filledPrice).toBe(143.25)
    expect(simOrder.brokerOrderId).toMatch(/^simdaily_2026-11-25_/)

    // Alpaca Paper order submitted via AlpacaPaperProvider!
    expect(alpOrder.status).toBe('submitted')
    expect(fakeAlpacaPaper.submitCalls).toBe(1)
    expect(fakeAlpacaPaper.orders.has('tp_exe_alp_1')).toBe(true)
    expect(fakeAlpacaPaper.orders.has('tp_exe_sim_1')).toBe(false)
  })

  it('fails closed on AlpacaLiveProvider across construction, registry resolution, and worker execution', async () => {
    expect(() => new AlpacaLiveProvider()).toThrow(LiveExecutionDisabledError)

    await h.db.user.create({ data: { id: 'usr_live_block', email: 'live@example.test', riskSettings: null } })
    await h.db.portfolio.create({
      data: {
        id: 'prt_live_tampered',
        userId: 'usr_live_block',
        name: 'Tampered Live Portfolio',
        accountKind: 'brokerage',
        environment: 'alpaca_live',
        status: 'active'
      }
    })

    await expect(
      resolveExecutionProviderForPortfolio({
        userId: 'usr_live_block',
        portfolioId: 'prt_live_tampered',
        prismaClient: h.db
      })
    ).rejects.toThrow(LiveExecutionDisabledError)

    await h.db.execution.create({
      data: {
        id: 'exe_live_blocked',
        userId: 'usr_live_block',
        portfolioId: 'prt_live_tampered',
        ticker: 'SPY',
        direction: 'buy',
        quantity: 1,
        price: 580,
        clientOrderId: 'tp_exe_live_blocked',
        status: 'queued',
        createdAt: worker.orderWorkerConfig.now()
      }
    })

    await worker.runOnce()
    const refused = await h.db.execution.findUnique({ where: { id: 'exe_live_blocked' } })
    expect(refused.status).toBe('refused')
    expect(refused.refusalReason).toBe('live_execution_disabled')
  })

  it('consolidates scheduled next_open settlement onto InternalSimulatorProvider with marketObservation provenance', async () => {
    await h.db.user.create({ data: { id: 'usr_sched', email: 'sched@example.test' } })
    await h.db.portfolio.create({
      data: { id: 'prt_sched', userId: 'usr_sched', environment: 'internal_sim', status: 'active', cashBalance: 10_000 }
    })
    const exec = await h.db.execution.create({
      data: {
        id: 'exec_cprop_test1',
        userId: 'usr_sched',
        portfolioId: 'prt_sched',
        botId: 'bot_personal_ai_usr_sched',
        ticker: 'NVDA',
        direction: 'buy',
        quantity: 10,
        price: 140,
        simSession: '2026-11-27',
        clientOrderId: 'co_cprop_test1',
        status: 'queued'
      }
    })
    await h.db.executionAudit.create({
      data: {
        id: 'aud_init_1',
        executionId: exec.id,
        userId: 'usr_sched',
        eventType: 'execution_created',
        detail: 'Queued next_open',
        metadata: { entryType: 'next_open' }
      }
    })

    const settled = await settleScheduledSimulatedExecution(exec, {
      currentSession: '2026-11-27',
      prismaClient: h.db,
      engine: {
        getSessionClose: async (ticker, session) => ({
          ticker,
          session,
          open: 142.5,
          close: 145.0,
          source: 'alpha-engine'
        })
      }
    })

    expect(settled.status).toBe('filled')
    expect(settled.filledExecution.fillPrice).toBe(142.5)
    expect(settled.filledExecution.marketObservation).toMatchObject({
      symbol: 'NVDA',
      price: 142.5,
      asOfSession: '2026-11-27',
      source: 'alpha-engine',
      latencyClass: 'session_open'
    })
  })

  it('enforces strict isolation between Research Partner forward simulation and operational accounts', async () => {
    await expect(
      stepResearchPaperForward({
        definition: {},
        state: newPaperForwardState(10_000),
        asOfSession: '2026-11-25',
        engine: { getDailyBars: async () => ({ bars: [] }) },
        portfolioId: 'prt_operational_123'
      })
    ).rejects.toThrow(/strictly isolated from operational accounts/)

    if (savedBrokerMode === undefined) delete process.env.BROKER_MODE
    else process.env.BROKER_MODE = savedBrokerMode
    if (savedReplay === undefined) delete process.env.SIM_REPLAY_SESSION
    else process.env.SIM_REPLAY_SESSION = savedReplay
  })
})
