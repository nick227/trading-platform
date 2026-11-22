/**
 * M6 — execution integrity, risk boundary, accounting, and multi-user reliability.
 * Runs the real order worker, eligibility checks, accounting, and emergency stop against an
 * in-memory database and a scripted paper broker. Deterministic: no timers, no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'

const h = vi.hoisted(() => ({ db: null, brokers: new Map() }))

vi.mock('../../../worker/src/db/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../../worker/src/broker/clientCache.js', () => ({ getBrokerClient: async (userId) => h.brokers.get(userId) ?? null }))
vi.mock('../../src/services/metricsService.js', () => ({ default: { processExecutionFill: async () => {} } }))
vi.mock('../../../worker/src/logger.js', () => ({ log: { info() {}, warn() {}, error() {}, debug() {} } }))

const { BrokerNetworkError, BrokerRejectionError, wrapError } = await import('../../../worker/src/broker/alpacaClient.js')
const { FakeBroker } = await import('../support/fakePaperBroker.js')
const worker = await import('../../../worker/src/queues/orderWorker.js')
const { eligibilityConfig } = await import('../../../worker/src/risk/orderEligibility.js')
const { activateEmergencyStop, clearEmergencyStop, getEmergencyStop } = await import('../../src/services/emergencyStopService.js')
const { calculateFifoAccounting, computeBotAccounting, realizedPnlSince, isBrokerFill } = await import('../../src/services/botAccountingService.js')

const { orderWorkerConfig, runOnce, processExecution, claimNextExecution, recoverStuckJobs, WORKER_ID } = worker

// ── Fixtures ─────────────────────────────────────────────────────────────────────

let clock
let seq = 0
async function seed() {
  h.db = createMemoryPrisma()
  h.brokers.clear()
  seq = 0
  clock = new Date('2026-11-23T15:00:00Z')
  Object.assign(orderWorkerConfig, {
    sleep: async () => {},
    // Deterministic monotonic clock: each read is 1ms later, like real elapsed time.
    now: () => { clock = new Date(clock.getTime() + 1); return new Date(clock) },
    fillTimeoutMs: 0,          // follow-up happens via the reconciliation sweep
    fillPollIntervalMs: 0,
    reconcileIntervalMs: 0,
    notFoundGraceMs: 60_000,
    stuckAfterMs: 120_000,
    cancelPollMs: 0,
    maxAttempts: 3,
  })
  eligibilityConfig.maxPriceAgeMs = 5 * 60_000
  for (const id of ['usr_a', 'usr_b']) {
    await h.db.user.create({ data: { id, email: `${id}@example.test`, riskSettings: null } })
    await h.db.portfolio.create({ data: { id: `por_${id}`, userId: id } })
    h.brokers.set(id, new FakeBroker(id))
  }
}

async function addBot(id, { userId = 'usr_a', config = {}, enabled = true } = {}) {
  return h.db.bot.create({ data: { id, userId, portfolioId: `por_${userId}`, name: id, enabled, config: { capitalMode: 'allocated', allocatedAmount: 10_000, maxOrderNotional: 5_000, ...config } } })
}

async function queue({ userId = 'usr_a', botId = null, ticker = 'SPY', direction = 'buy', quantity = 10, price = 100, createdAt = new Date(clock) } = {}) {
  const id = `exe_${++seq}`
  return h.db.execution.create({ data: { id, userId, portfolioId: `por_${userId}`, botId, ticker, direction, quantity, price, clientOrderId: `tp_${id}`, status: 'queued', createdAt } })
}

/** A historical broker fill (already reconciled), for accounting/limits. */
async function filled({ userId = 'usr_a', botId, ticker = 'SPY', direction, qty, price, at, status = 'filled', fees = 0 }) {
  const id = `exe_${++seq}`
  return h.db.execution.create({ data: { id, userId, portfolioId: `por_${userId}`, botId, ticker, direction, quantity: qty, price, status, filledQuantity: qty, filledPrice: price, filledAt: at ?? new Date(clock.getTime() - 86_400_000), clientOrderId: `tp_${id}`, fees } })
}

const exec = (id) => h.db.execution.findUnique({ where: { id } })
const audits = async (id) => (await h.db.executionAudit.findMany({ where: { executionId: id }, orderBy: { createdAt: 'asc' } })).map((a) => a.eventType)
const broker = (u = 'usr_a') => h.brokers.get(u)
const advance = (ms) => { clock = new Date(clock.getTime() + ms) }
async function drain(max = 20) { for (let i = 0; i < max; i++) if (!(await runOnce())) return }

beforeEach(seed)

// ── 1. Execution integrity ───────────────────────────────────────────────────────

describe('execution integrity', () => {
  it('submits once, persists the broker id, and reconciles to filled with an ordered audit trail', async () => {
    const e = await queue()
    await runOnce()
    let row = await exec(e.id)
    expect(row.status).toBe('submitted')
    expect(row.brokerOrderId).toBeTruthy()
    expect(row.submitAttemptedAt).toBeTruthy()
    expect(row.lockedBy).toBeNull()

    broker().fill(e.clientOrderId, 10, 101.5)
    await runOnce()
    row = await exec(e.id)
    expect(row).toMatchObject({ status: 'filled', filledQuantity: 10, filledPrice: 101.5, activeIntentKey: null })
    expect(broker().submitCalls).toBe(1)
    expect(await audits(e.id)).toEqual(['claimed', 'submit_attempted', 'submit_confirmed', 'filled'])
  })

  it('concurrent workers: an execution is claimed exactly once and submitted exactly once', async () => {
    const e = await queue()
    const claims = await Promise.all([claimNextExecution(), claimNextExecution(), claimNextExecution()])
    expect(claims.filter(Boolean)).toHaveLength(1)
    await processExecution(claims.find(Boolean))
    await Promise.all([runOnce(), runOnce()])
    expect(broker().submitCalls).toBe(1)
    expect(broker().createdOrders).toBe(1)
    expect((await exec(e.id)).attempts).toBe(1)
  })

  it('a worker that lost its lease stops without writing (fencing)', async () => {
    const e = await queue()
    const b = broker()
    const original = b.submitOrder.bind(b)
    b.submitOrder = async (args) => {
      // Simulate recovery handing the row to another worker while this submit is in flight.
      await h.db.execution.updateMany({ where: { id: e.id }, data: { lockedBy: 'other-worker' } })
      return original(args)
    }
    await runOnce()
    const row = await exec(e.id)
    expect(row.lockedBy).toBe('other-worker')
    expect(row.status).toBe('processing')      // this worker did not overwrite it
    expect(row.brokerOrderId).toBeNull()
    expect(await audits(e.id)).toContain('lease_lost')
  })

  it('lost response after the broker accepted: reconciles by clientOrderId, never submits again', async () => {
    const e = await queue()
    broker().nextSubmit = 'lostResponse'
    await runOnce()
    let row = await exec(e.id)
    expect(row.status).toBe('needs_reconciliation')
    expect(row.brokerOrderId).toBeNull()

    await runOnce() // reconciliation sweep finds the order by clientOrderId
    row = await exec(e.id)
    expect(row.status).toBe('submitted')
    expect(row.brokerOrderId).toBe(broker().orders.get(e.clientOrderId).alpacaOrderId)

    broker().fill(e.clientOrderId, 10, 100)
    await drain()
    expect((await exec(e.id)).status).toBe('filled')
    expect(broker().submitCalls).toBe(1)
    expect(broker().createdOrders).toBe(1)
    expect(await audits(e.id)).toContain('reconcile_required')
  })

  it('network failure before receipt: waits the grace period, then resubmits with the SAME clientOrderId', async () => {
    const e = await queue()
    broker().nextSubmit = 'networkBeforeReceipt'
    await runOnce()
    expect((await exec(e.id)).status).toBe('needs_reconciliation')

    await runOnce() // inside grace: not concluded
    expect((await exec(e.id)).status).toBe('needs_reconciliation')

    advance(61_000)
    await runOnce() // not at broker after grace -> requeued
    expect((await exec(e.id)).status).toBe('queued')
    await runOnce() // resubmit
    const row = await exec(e.id)
    expect(row.status).toBe('submitted')
    expect(broker().seenClientOrderIds).toEqual([e.clientOrderId, e.clientOrderId])
    expect(broker().createdOrders).toBe(1)
  })

  it('a late-landing order is adopted, not duplicated, when resubmission is attempted', async () => {
    const e = await queue()
    broker().nextSubmit = 'networkBeforeReceipt'
    await runOnce()
    advance(61_000)
    await runOnce() // requeued (broker shows nothing yet)
    // The original request lands at the broker before the resubmit.
    await h.brokers.get('usr_a').submitOrder({ ticker: 'SPY', side: 'buy', qty: 10, clientOrderId: e.clientOrderId })
    await runOnce()
    const row = await exec(e.id)
    expect(row.status).toBe('submitted')
    expect(broker().createdOrders).toBe(1)
    expect(await audits(e.id)).toContain('reconciled')
  })

  it('bounded retries: pre-submit failures end as failed after maxAttempts with nothing sent', async () => {
    const e = await queue()
    broker().getAccount = async () => { throw new BrokerNetworkError('timeout') }
    await drain()
    const row = await exec(e.id)
    expect(row).toMatchObject({ status: 'failed', cancelReason: 'max_attempts_exceeded', attempts: 3 })
    expect(broker().submitCalls).toBe(0)
  })

  it('an order the broker holds is never failed locally, however long it stays open', async () => {
    const e = await queue()
    await runOnce()
    for (let i = 0; i < 10; i++) { advance(60_000); await runOnce() }
    const row = await exec(e.id)
    expect(row.status).toBe('submitted')
    expect(broker().submitCalls).toBe(1)
  })

  it('partial fills update cumulatively and idempotently; cancel-after-partial keeps the real fill', async () => {
    const e = await queue({ quantity: 10 })
    await runOnce()
    broker().fill(e.clientOrderId, 4, 100)
    await runOnce()
    await runOnce() // repeated identical broker update
    let row = await exec(e.id)
    expect(row).toMatchObject({ status: 'partially_filled', filledQuantity: 4, filledPrice: 100 })
    broker().fill(e.clientOrderId, 7, 100.3)
    await runOnce()
    expect((await exec(e.id)).filledQuantity).toBe(7) // cumulative, not 4 + 7
    broker().setStatus(e.clientOrderId, 'canceled')
    await runOnce()
    row = await exec(e.id)
    expect(row).toMatchObject({ status: 'cancelled', filledQuantity: 7, filledPrice: 100.3, cancelReason: 'broker_status:canceled' })
    const acct = calculateFifoAccounting([row])
    expect(acct.openPositions.SPY.quantity).toBe(7)
  })

  it('rejected and canceled-without-fill orders contribute no fills', async () => {
    const a = await queue()
    const b = await queue()
    await drain()
    broker().setStatus(a.clientOrderId, 'rejected')
    broker().setStatus(b.clientOrderId, 'canceled')
    await drain()
    const rows = [await exec(a.id), await exec(b.id)]
    expect(rows.map((r) => r.status)).toEqual(['cancelled', 'cancelled'])
    expect(rows.map((r) => r.cancelReason)).toEqual(['broker_status:rejected', 'broker_status:canceled'])
    expect(calculateFifoAccounting(rows).hasFills).toBe(false)
  })

  it('a broker 4xx rejection at submit is final and not retried', async () => {
    const e = await queue()
    broker().nextSubmit = 'reject'
    await drain()
    expect(await exec(e.id)).toMatchObject({ status: 'cancelled', cancelReason: 'broker_rejected:insufficient qty' })
    expect(broker().submitCalls).toBe(1)
  })

  it('cancellation: before submit nothing is sent; after submit the broker order is canceled', async () => {
    const pre = await queue()
    await h.db.execution.updateMany({ where: { id: pre.id }, data: { cancelRequestedAt: new Date(clock) } })
    await runOnce()
    expect(await exec(pre.id)).toMatchObject({ status: 'cancelled', cancelReason: 'user_cancel_requested_pre_submit' })
    expect(broker().submitCalls).toBe(0)

    const post = await queue()
    await runOnce()
    await h.db.execution.updateMany({ where: { id: post.id }, data: { cancelRequestedAt: new Date(clock) } })
    await drain()
    expect(await exec(post.id)).toMatchObject({ status: 'cancelled', cancelReason: 'broker_cancelled_after_user_request' })
    expect(broker().orders.get(post.clientOrderId).status).toBe('canceled')
  })

  it('restart recovery: stalled rows are routed by what reached the broker, then reconciled', async () => {
    const stale = new Date(clock.getTime() - 10 * 60_000)
    const fresh = await queue()
    const attempted = await queue()
    const acked = await queue()
    await h.db.execution.updateMany({ where: { id: fresh.id }, data: { status: 'processing', lockedAt: stale, lockedBy: 'dead-worker' } })
    await h.db.execution.updateMany({ where: { id: attempted.id }, data: { status: 'processing', lockedAt: stale, lockedBy: 'dead-worker', submitAttemptedAt: stale } })
    // The dead worker's submit for `acked` landed and was acknowledged.
    await broker().submitOrder({ ticker: 'SPY', side: 'buy', qty: 10, clientOrderId: acked.clientOrderId })
    const ackedOrder = broker().orders.get(acked.clientOrderId)
    await h.db.execution.updateMany({ where: { id: acked.id }, data: { status: 'processing', lockedAt: stale, lockedBy: 'dead-worker', submitAttemptedAt: stale, brokerOrderId: ackedOrder.alpacaOrderId } })
    broker().fill(acked.clientOrderId, 10, 99)
    const submitsBefore = broker().submitCalls

    expect(await recoverStuckJobs()).toBe(3)
    expect((await exec(fresh.id)).status).toBe('queued')
    expect((await exec(attempted.id)).status).toBe('needs_reconciliation')
    expect((await exec(acked.id)).status).toBe('submitted')

    advance(61_000)
    await drain()
    expect(await exec(acked.id)).toMatchObject({ status: 'filled', filledQuantity: 10 })
    expect((await exec(fresh.id)).status).toBe('submitted')
    expect((await exec(attempted.id)).status).toBe('submitted') // not at broker after grace -> resubmitted once
    expect(broker().submitCalls - submitsBefore).toBe(2)
    expect(broker().createdOrders).toBe(3)
  })

  it('classifies broker errors: no response / 429 / 5xx are unknown outcomes; 4xx are rejections', () => {
    expect(wrapError({ code: 'ECONNABORTED', message: 't' })).toBeInstanceOf(BrokerNetworkError)
    expect(wrapError({ code: 'ENOTFOUND', message: 'dns' })).toBeInstanceOf(BrokerNetworkError)
    expect(wrapError({ response: { status: 429 }, message: 'rate' })).toBeInstanceOf(BrokerNetworkError)
    expect(wrapError({ response: { status: 503 }, message: 'down' })).toBeInstanceOf(BrokerNetworkError)
    const auth = wrapError({ response: { status: 401, data: { message: 'unauthorized' } }, message: 'x' })
    expect(auth).toBeInstanceOf(BrokerRejectionError)
    expect(auth.credentialError).toBe(true)
    const bp = wrapError({ response: { status: 403, data: { message: 'insufficient buying power' } }, message: 'x' })
    expect(bp.credentialError).toBe(false)
  })
})

// ── 2/3. Risk boundary ───────────────────────────────────────────────────────────

describe('final order-eligibility boundary (recorded refusals, nothing sent)', () => {
  async function expectRefused(execution, reason) {
    await runOnce()
    const row = await exec(execution.id)
    expect(row).toMatchObject({ status: 'refused', refusalReason: reason, cancelReason: null, activeIntentKey: null })
    expect(await audits(execution.id)).toContain('risk_blocked')
    if (execution.botId) {
      const ev = await h.db.botEvent.findMany({ where: { botId: execution.botId, type: 'execution_blocked_by_risk' } })
      expect(ev.map((x) => x.metadata.reason)).toContain(reason)
    }
    expect(broker(execution.userId).submitCalls).toBe(0)
  }

  it('paused bot', async () => {
    await addBot('bot1', { enabled: false })
    await expectRefused(await queue({ botId: 'bot1' }), 'bot_paused')
  })

  it('stopped bot', async () => {
    await addBot('bot1')
    await h.db.bot.updateMany({ where: { id: 'bot1' }, data: { deletedAt: new Date(clock) } })
    await expectRefused(await queue({ botId: 'bot1' }), 'bot_stopped')
  })

  it('maximum order value', async () => {
    await addBot('bot1', { config: { maxOrderNotional: 500 } })
    await expectRefused(await queue({ botId: 'bot1', quantity: 10, price: 100 }), 'max_order_value')
  })

  it('bot allocation counts filled exposure and its own pending buys', async () => {
    await addBot('bot1', { config: { allocatedAmount: 2_000, maxOrderNotional: 5_000 } })
    await filled({ botId: 'bot1', direction: 'buy', qty: 10, price: 100 }) // 1,000 in use
    const pending = await queue({ botId: 'bot1', quantity: 5, price: 100 }) // 500 committed
    await h.db.execution.updateMany({ where: { id: pending.id }, data: { status: 'submitted', brokerOrderId: 'x', lockedAt: new Date(clock), lockedBy: 'someone' } })
    await expectRefused(await queue({ botId: 'bot1', quantity: 6, price: 100 }), 'bot_allocation_exceeded')
  })

  it('sell larger than the bot’s attributable holdings', async () => {
    await addBot('bot1')
    await filled({ botId: 'bot1', direction: 'buy', qty: 5, price: 100 })
    await expectRefused(await queue({ botId: 'bot1', direction: 'sell', quantity: 6 }), 'sell_exceeds_attributable_holdings')
  })

  it('daily loss limit from the bot’s daily_loss rule (realized FIFO today)', async () => {
    await addBot('bot1')
    await h.db.botRule.create({ data: { id: 'r1', botId: 'bot1', type: 'daily_loss', config: { maxLoss: 100 } } })
    await filled({ botId: 'bot1', direction: 'buy', qty: 10, price: 100, at: new Date(clock.getTime() - 3 * 3600_000) })
    await filled({ botId: 'bot1', direction: 'sell', qty: 10, price: 85, at: new Date(clock.getTime() - 3600_000) }) // -150 today
    await expectRefused(await queue({ botId: 'bot1' }), 'daily_loss_limit')
  })

  it('available paper buying power', async () => {
    broker().buyingPower = 500
    await expectRefused(await queue({ quantity: 10, price: 100 }), 'insufficient_buying_power')
  })

  it('missing and stale prices', async () => {
    await expectRefused(await queue({ price: null }), 'missing_price')
    await expectRefused(await queue({ createdAt: new Date(clock.getTime() - 6 * 60_000) }), 'stale_price')
  })

  it('missing broker credentials', async () => {
    h.brokers.delete('usr_a')
    const e = await queue()
    await runOnce()
    expect(await exec(e.id)).toMatchObject({ status: 'refused', refusalReason: 'invalid_credentials' })
  })

  it('emergency stop: disables bots, cancels active work, refuses, and blocks nothing for other users', async () => {
    await addBot('bot1')
    const pre = await queue({ botId: 'bot1' })
    const sent = await queue()
    await h.db.execution.updateMany({ where: { id: pre.id }, data: { status: 'queued' } })
    // `sent` reaches the broker before the stop.
    await runOnce(); await runOnce()
    const other = await queue({ userId: 'usr_b' })

    const res = await activateEmergencyStop('usr_a', 'test', { now: new Date(clock) })
    expect(res).toMatchObject({ active: true, botsPaused: 1 })
    expect((await h.db.bot.findUnique({ where: { id: 'bot1' } })).enabled).toBe(false)
    expect((await getEmergencyStop('usr_a')).active).toBe(true)

    await drain()
    expect((await exec(sent.id)).status).toBe('cancelled')
    expect(broker().orders.get(sent.clientOrderId).status).toBe('canceled')
    expect((await exec(other.id)).status).toBe('submitted') // user B unaffected

    const later = await queue()
    await runOnce()
    expect(await exec(later.id)).toMatchObject({ status: 'refused', refusalReason: 'emergency_stop' })
    const cleared = await clearEmergencyStop('usr_a')
    expect(cleared).toMatchObject({ active: false, botsResumed: 0 })
    expect((await h.db.bot.findUnique({ where: { id: 'bot1' } })).enabled).toBe(false) // clearing never resumes
  })
})

// ── 4. Multi-user reliability ────────────────────────────────────────────────────

describe('multi-user reliability', () => {
  it('one user’s invalid credentials refuse only their order; the other user’s order proceeds', async () => {
    broker('usr_a').credentialsValid = false
    const a = await queue({ userId: 'usr_a' })
    const b = await queue({ userId: 'usr_b' })
    await drain()
    expect(await exec(a.id)).toMatchObject({ status: 'refused', refusalReason: 'invalid_credentials' })
    expect((await exec(b.id)).status).toBe('submitted')
    expect(broker('usr_a').submitCalls).toBe(0)
    expect(broker('usr_b').seenClientOrderIds).toEqual([b.clientOrderId]) // never saw user A's order
  })

  it('separate bots never consume each other’s allocation', async () => {
    await addBot('bot1', { config: { allocatedAmount: 1_000 } })
    await addBot('bot2', { config: { allocatedAmount: 1_000 } })
    await filled({ botId: 'bot1', direction: 'buy', qty: 9, price: 100 }) // bot1 900 in use
    const b2 = await queue({ botId: 'bot2', quantity: 5, price: 100 })
    const b1 = await queue({ botId: 'bot1', quantity: 5, price: 100 })
    await drain()
    expect((await exec(b2.id)).status).toBe('submitted')
    expect((await exec(b1.id)).refusalReason).toBe('bot_allocation_exceeded')
  })

  it('a bot order cannot run under another user’s identity', async () => {
    await addBot('bot1', { userId: 'usr_a' })
    const forged = await queue({ userId: 'usr_b', botId: 'bot1' })
    await runOnce()
    expect((await exec(forged.id)).refusalReason).toBe('bot_owner_mismatch')
  })

  it('ownership and state survive a restart (recovery keeps userId/botId; reconciles with the owner’s broker)', async () => {
    await addBot('bot1', { userId: 'usr_b' })
    const e = await queue({ userId: 'usr_b', botId: 'bot1' })
    await runOnce()
    await h.db.execution.updateMany({ where: { id: e.id }, data: { lockedAt: new Date(clock.getTime() - 10 * 60_000), lockedBy: 'dead' } })
    await recoverStuckJobs()
    broker('usr_b').fill(e.clientOrderId, 10, 100)
    await drain()
    expect(await exec(e.id)).toMatchObject({ status: 'filled', userId: 'usr_b', botId: 'bot1' })
    expect(broker('usr_a').submitCalls).toBe(0)
  })
})

// ── 2. Authoritative accounting ──────────────────────────────────────────────────

describe('authoritative accounting', () => {
  const t = (h) => new Date(Date.UTC(2026, 10, 20, h))

  it('FIFO across multiple lots with fees, partial fills of canceled orders, and no invented fills', () => {
    const rows = [
      { id: 'b1', ticker: 'AAPL', direction: 'buy', status: 'filled', filledQuantity: 10, filledPrice: 100, filledAt: t(10), fees: 1 },
      { id: 'b2', ticker: 'AAPL', direction: 'buy', status: 'cancelled', filledQuantity: 5, filledPrice: 110, filledAt: t(11), fees: 0.5 }, // partial then canceled
      { id: 'x1', ticker: 'AAPL', direction: 'buy', status: 'filled', quantity: 100, price: 1, filledQuantity: null, filledPrice: null }, // no broker fill data
      { id: 'x2', ticker: 'AAPL', direction: 'buy', status: 'cancelled', quantity: 50, price: 1, filledQuantity: 0 },
      { id: 's1', ticker: 'AAPL', direction: 'sell', status: 'filled', filledQuantity: 12, filledPrice: 120, filledAt: t(12), fees: 1.2 },
    ]
    const r = calculateFifoAccounting(rows)
    expect(r.fillCount).toBe(3)
    // 10 @100 + 2 @110 closed at 120: 200 + 20
    expect(r.perExecutionPnl.get('s1')).toBe(220)
    expect(r.performance.realizedPnl).toBe(220)
    // net: 220 - (10*0.1 + 2*0.1) buy fees - 1.2 sell fee
    expect(r.realizedPnlNetOfFees).toBe(217.6)
    expect(r.performance.fees).toBe(2.7)
    expect(r.openPositions.AAPL).toMatchObject({ quantity: 3, costBasis: 330 })
    expect(r.performance.unrealizedPnl).toBeNull() // no verified price
    expect(isBrokerFill(rows[2])).toBe(false)
  })

  it('sells beyond attributable holdings are reported, never turned into shorts or extra P/L', () => {
    const r = calculateFifoAccounting([
      { id: 'b1', ticker: 'MSFT', direction: 'buy', filledQuantity: 5, filledPrice: 100, filledAt: t(9) },
      { id: 's1', ticker: 'MSFT', direction: 'sell', filledQuantity: 8, filledPrice: 110, filledAt: t(10) },
    ])
    expect(r.performance.realizedPnl).toBe(50)
    expect(r.unattributedSellQuantity).toEqual({ MSFT: 3 })
    expect(r.openPositions).toEqual({})
  })

  it('repeated broker updates for one order never double count', () => {
    const order = { id: 'b1', ticker: 'SPY', direction: 'buy', filledQuantity: 7, filledPrice: 100, filledAt: t(9) }
    const once = calculateFifoAccounting([order])
    const again = calculateFifoAccounting([{ ...order }]) // same row after another identical update
    expect(again.openPositions.SPY.quantity).toBe(once.openPositions.SPY.quantity)
  })

  it('realized P/L since a time only counts sells filled in the window', () => {
    const rows = [
      { id: 'b1', ticker: 'SPY', direction: 'buy', filledQuantity: 10, filledPrice: 100, filledAt: t(8) },
      { id: 's1', ticker: 'SPY', direction: 'sell', filledQuantity: 5, filledPrice: 90, filledAt: t(9) },
      { id: 's2', ticker: 'SPY', direction: 'sell', filledQuantity: 5, filledPrice: 110, filledAt: t(15) },
    ]
    expect(realizedPnlSince(rows, t(12))).toBe(50)
    expect(realizedPnlSince(rows, t(0))).toBe(0)
  })

  it('the bot dashboard figures equal the persisted executions after a real worker run', async () => {
    await addBot('bot1')
    const buy = await queue({ botId: 'bot1', quantity: 10, price: 100 })
    await runOnce()
    broker().fill(buy.clientOrderId, 10, 100)
    await drain()
    // Holdings exist now; sell 4.
    const sell = await queue({ botId: 'bot1', direction: 'sell', quantity: 4, price: 110 })
    await runOnce()
    broker().fill(sell.clientOrderId, 4, 110)
    await drain()

    const persisted = await h.db.execution.findMany({ where: { botId: 'bot1' } })
    const dashboard = await computeBotAccounting('bot1')
    expect(dashboard.performance.realizedPnl).toBe(40)
    expect(dashboard.capitalInUse).toBe(600)
    expect(dashboard.openPositions.SPY.quantity).toBe(6)
    expect(dashboard.performance.unrealizedPnl).toBeNull()
    expect(calculateFifoAccounting(persisted).performance.realizedPnl).toBe(dashboard.performance.realizedPnl)
    expect((await exec(sell.id)).pnl).toBe(40) // per-fill P/L persisted at settlement
  })
})

it('worker identity is stable within a process', () => {
  expect(WORKER_ID).toMatch(/-\d+$/)
})

// ── Refused: a distinct terminal outcome ─────────────────────────────────────────

describe('refused orders (status "refused")', () => {
  it('a refusal is terminal, never sent, releases its intent key, and keeps its audit and bot event', async () => {
    await addBot('bot1', { config: { maxOrderNotional: 500 } })
    const e = await queue({ botId: 'bot1', quantity: 10, price: 100 })
    await h.db.execution.update({ where: { id: e.id }, data: { activeIntentKey: 'bot:bot1:SPY:buy' } })
    await runOnce()
    expect(await exec(e.id)).toMatchObject({ status: 'refused', refusalReason: 'max_order_value', cancelReason: null, activeIntentKey: null, lockedBy: null, brokerOrderId: null })
    expect(broker().submitCalls).toBe(0)
    expect(await audits(e.id)).toEqual(expect.arrayContaining(['claimed', 'risk_blocked']))
    const [evt] = await h.db.botEvent.findMany({ where: { executionId: e.id } })
    expect(evt).toMatchObject({ type: 'execution_blocked_by_risk' })
    expect(evt.metadata.reason).toBe('max_order_value')
  })

  it('restart recovery and reconciliation never touch a refused row, even with a stale lock', async () => {
    await addBot('bot1', { config: { maxOrderNotional: 500 } })
    const e = await queue({ botId: 'bot1', quantity: 10, price: 100 })
    await runOnce()
    await h.db.execution.update({ where: { id: e.id }, data: { lockedAt: new Date(clock.getTime() - 60 * 60_000), lockedBy: 'dead-worker' } })
    expect(await recoverStuckJobs()).toBe(0)
    advance(10 * 60_000)
    await drain()
    expect(await exec(e.id)).toMatchObject({ status: 'refused', refusalReason: 'max_order_value' })
    expect(broker().submitCalls).toBe(0)
  })

  it('a refused order is never counted as a fill, holding, or pending exposure', async () => {
    await addBot('bot1', { config: { allocatedAmount: 2_000, maxOrderNotional: 5_000 } })
    await h.db.execution.create({ data: { id: 'exe_ref', userId: 'usr_a', portfolioId: 'por_usr_a', botId: 'bot1', ticker: 'SPY', direction: 'buy', quantity: 15, price: 100, status: 'refused', refusalReason: 'bot_allocation_exceeded', clientOrderId: 'tp_exe_ref', createdAt: new Date(clock) } })
    const ok = await queue({ botId: 'bot1', quantity: 15, price: 100 }) // 1,500 ≤ 2,000: the refused 1,500 must not count
    await runOnce()
    expect((await exec(ok.id)).status).toBe('submitted')
    const acct = await computeBotAccounting('bot1', { prismaClient: h.db })
    expect(acct).toMatchObject({ hasFills: false, fillCount: 0, openPositions: {} })
  })
})

describe.each([
  ['current', { status: 'refused', refusalReason: 'bot_allocation_exceeded', cancelReason: null }],
  ['legacy', { status: 'cancelled', cancelReason: 'refused:bot_allocation_exceeded' }],
])('refusal parity (%s shape): recovery and history', (shape, fields) => {
  const mk = async () => {
    await addBot('bot1', { config: { allocatedAmount: 2_000, maxOrderNotional: 5_000 } })
    return h.db.execution.create({ data: { id: `exe_${shape}`, userId: 'usr_a', portfolioId: 'por_usr_a', botId: 'bot1', ticker: 'SPY', direction: 'buy', quantity: 15, price: 100,
      clientOrderId: `tp_${shape}`, lockedAt: new Date(clock.getTime() - 60 * 60_000), lockedBy: 'dead-worker', createdAt: new Date(clock), ...fields } })
  }

  it('recovery and reconciliation leave it untouched and nothing is sent', async () => {
    const e = await mk()
    expect(await recoverStuckJobs()).toBe(0)
    advance(10 * 60_000)
    await drain()
    expect(await exec(e.id)).toMatchObject(fields)
    expect(broker().submitCalls).toBe(0)
  })

  it('history: no fill, no holding, no pending exposure', async () => {
    await mk()
    expect(await computeBotAccounting('bot1', { prismaClient: h.db })).toMatchObject({ hasFills: false, fillCount: 0, openPositions: {} })
    const ok = await queue({ botId: 'bot1', quantity: 15, price: 100 })
    await runOnce()
    expect((await exec(ok.id)).status).toBe('submitted')
  })
})
