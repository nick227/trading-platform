/**
 * Internal historical-replay simulator: research bot → decision (judged at the replayed
 * session's close) → simulated fill at that session's daily close → trade history.
 * No Alpaca client may ever be constructed, and no broker credentials exist.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import request from 'supertest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'

const h = vi.hoisted(() => ({ db: null, alpacaConstructed: 0, risk: null }))
vi.mock('../../../worker/src/db/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../src/services/metricsService.js', () => ({ default: { processExecutionFill: async () => {} } }))
vi.mock('../../../worker/src/logger.js', () => ({ log: { info() {}, warn() {}, error() {}, debug() {} } }))
vi.mock('../../../worker/src/market/dataStream.js', () => ({ subscribe() {}, unsubscribe() {} }))
vi.mock('../../../worker/src/risk/riskManagement.js', () => ({ riskManager: { evaluateExecutionRisk: async () => h.risk ?? { approved: true, decision: 'approve', riskScore: 0.1 } } }))
vi.mock('../../../worker/src/broker/alpacaClient.js', async (orig) => {
  const real = await orig()
  return { ...real, AlpacaClient: class { constructor() { h.alpacaConstructed += 1; throw new Error('Alpaca must never be constructed in simulator mode') } } }
})

const { traces } = JSON.parse(readFileSync(new URL('../fixtures/alpha-engine/traces.json', import.meta.url), 'utf8'))
const SESSION = '2026-11-20' // fixture research observed 2026-11-20T14:30Z; replay clock = session close 21:00Z
const KEY = 'test-internal-key'
const ae = { closes: {}, latest: {}, requests: [] }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  ae.requests.push(url.pathname + url.search)
  const send = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)) }
  if (req.headers['x-internal-key'] !== KEY) return send(401, {})
  if (url.pathname === '/api/research/latest') {
    const t = url.searchParams.get('ticker')
    const ok = t === 'SPY' && url.searchParams.get('mode') === 'historical_replay' && url.searchParams.get('session') === SESSION
    return send(200, ok
      ? { found: true, ticker: t, predictionId: 'pred_spy_buy', publicationId: 'pub_replay', mode: 'historical_replay', marketDate: SESSION, run: { intelligenceConfidenceTier: 'full', rankedUnderDegradedRun: false, runStatus: 'HEALTHY' } }
      : { found: false, reason: 'no_accepted_publication' })
  }
  if (url.pathname === '/api/predictions/pred_spy_buy/trace') return send(200, traces.pred_spy_buy)
  if (url.pathname === '/api/market/session-close') {
    const t = url.searchParams.get('ticker'); const c = url.searchParams.get('session') ? ae.closes[t] : ae.latest[t]
    return c ? send(200, { ticker: t, session: c.session, close: c.close, volume: 3e6, avgVolume20: 2e6, timeframe: '1d', source: 'alpha-engine price_bars' }) : send(404, {})
  }
  send(404, {})
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
Object.assign(process.env, {
  ENGINE_URL: `http://127.0.0.1:${server.address().port}`, INTERNAL_READ_KEY: KEY, RESEARCH_INDEX_TTL_MS: '0',
  BROKER_MODE: 'simulated', SIM_REPLAY_SESSION: SESSION, SIM_STARTING_CASH: '100000',
})

const { getBrokerClient } = await import('../../../worker/src/broker/clientCache.js')
const { clearSimulatedBrokers, SimulatedBroker } = await import('../../../worker/src/broker/simulatedBroker.js')
const engine = await import('../../../worker/src/engine/botEngine.js')
const worker = await import('../../../worker/src/queues/orderWorker.js')
const { eligibilityConfig } = await import('../../../worker/src/risk/orderEligibility.js')
const { replayTick } = await import('../../../worker/src/market/replayFeed.js')
const { getMarketHours, setMarketOpenState } = await import('../../../worker/src/market/calendar.js')
const { simulationConfig } = await import('../../src/services/simulationService.js')
const { default: createApp } = await import('../../src/loaders/fastify.js')
const { default: registerRoutes } = await import('../../src/loaders/routes.js')

let app, token
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-21T22:00:00Z') }) // a Saturday: markets closed
  h.db = createMemoryPrisma()
  app = await createApp(); await registerRoutes(app); await app.ready()
  token = app.jwt.sign({ sub: 'usr_a' })
})
afterAll(async () => { vi.useRealTimers(); await app.close(); await new Promise((r) => server.close(r)) })

beforeEach(async () => {
  h.db.reset()
  h.alpacaConstructed = 0
  clearSimulatedBrokers()
  engine.stopBotEngine()
  engine.inflightMap.clear()
  worker.setInflightMap(engine.inflightMap)
  ae.closes = { SPY: { session: SESSION, close: 540.25 } }
  ae.latest = { SPY: { session: '2026-11-21', close: 545.75 } }
  ae.requests = []
  h.risk = null
  delete process.env.SIM_TEST_SCENARIO
  setMarketOpenState(false)
  Object.assign(worker.orderWorkerConfig, { sleep: async () => {}, now: () => { vi.setSystemTime(new Date(Date.now() + 1)); return new Date() },
    fillTimeoutMs: 0, fillPollIntervalMs: 0, reconcileIntervalMs: 0, notFoundGraceMs: 60_000, stuckAfterMs: 120_000, cancelPollMs: 0, maxAttempts: 3 })
  eligibilityConfig.maxPriceAgeMs = 5 * 60_000
  await h.db.user.create({ data: { id: 'usr_a', email: 'a@example.test', riskSettings: null, subscription: { status: 'ACTIVE' } } })
  await h.db.portfolio.create({ data: { id: 'por_a', userId: 'usr_a' } })
  await h.db.bot.create({ data: { id: 'bot_r', userId: 'usr_a', portfolioId: 'por_a', name: 'R', enabled: true, botType: 'rule_based',
    config: { signalSource: 'alpha_research', tickers: ['SPY'], capitalMode: 'allocated', allocatedAmount: 10_000, maxOrderNotional: 5_000, research: { requireEdgeOverBaseline: false } } } })
  await h.db.botRule.create({ data: { id: 'rule_mh', botId: 'bot_r', name: 'Market Hours', type: 'market_hours', config: {} } })
})

async function feedTick() {
  const bot = async () => ({ ...(await h.db.bot.findUnique({ where: { id: 'bot_r' } })), rules: await h.db.botRule.findMany({ where: { botId: 'bot_r' } }) })
  return replayTick({ session: SESSION, onTick: async () => engine.evaluateBot(await bot(), 'SPY') })
}
async function drain() { for (let i = 0; i < 20; i++) if (!(await worker.runOnce())) return }
const as = () => ({ Authorization: `Bearer ${token}` })

describe('historical-replay simulator', () => {
  it('keeps a buy bot buying when the owner already holds the ticker through another bot', async () => {
    // Regression: loading positions (position_limit / trend_filter) used to override the
    // configured direction with "sell if any shares are held", turning buy bots into sellers.
    await h.db.execution.create({ data: { id: 'exe_prior', userId: 'usr_a', portfolioId: 'por_a', botId: 'bot_other', ticker: 'SPY', direction: 'buy',
      quantity: 2, price: 540.25, status: 'filled', filledQuantity: 2, filledPrice: 540.25, fees: 0, commission: 0, origin: 'bot',
      brokerOrderId: `simreplay_${SESSION}_tp_exe_prior`, createdAt: new Date('2026-11-21T21:00:00Z'), filledAt: new Date('2026-11-21T21:00:00Z') } })
    await h.db.bot.create({ data: { id: 'bot_b', userId: 'usr_a', portfolioId: 'por_a', name: 'B', enabled: true, botType: 'rule_based',
      config: { direction: 'buy', tickers: ['SPY'], capitalMode: 'allocated', allocatedAmount: 5_000, maxOrderNotional: 1_000 } } })
    await h.db.botRule.create({ data: { id: 'rule_pl', botId: 'bot_b', name: 'Position Limit', type: 'position_limit', config: { maxShares: 100, maxQuantity: 100 } } })
    setMarketOpenState(true)
    const bot = { ...(await h.db.bot.findUnique({ where: { id: 'bot_b' } })), rules: await h.db.botRule.findMany({ where: { botId: 'bot_b' } }) }
    await replayTick({ session: SESSION, onTick: async () => engine.evaluateBot(bot, 'SPY') })
    const created = await h.db.execution.findMany({ where: { botId: 'bot_b' } })
    expect(created).toHaveLength(1)
    expect(created[0].direction).toBe('buy')
  })

  it('is enabled only by explicit, complete configuration', () => {
    expect(simulationConfig().enabled).toBe(true)
    expect(simulationConfig({ BROKER_MODE: 'simulated' }).enabled).toBe(false)
    expect(simulationConfig({ BROKER_MODE: 'simulated', SIM_REPLAY_SESSION: 'yesterday' }).enabled).toBe(false)
    expect(simulationConfig({ SIM_REPLAY_SESSION: SESSION }).enabled).toBe(false)
    expect(() => new SimulatedBroker('u', { config: simulationConfig({}) })).toThrow('not enabled')
  })

  it('trades verified research through simulated replay fills without any broker', async () => {
    expect(await h.db.brokerAccount.count()).toBe(0)
    expect(await getBrokerClient('usr_a')).toBeInstanceOf(SimulatedBroker)

    // The market_hours rule passes because the replayed session was a trading session.
    setMarketOpenState(true)
    expect(await feedTick()).toEqual(['SPY'])
    const [exe] = await h.db.execution.findMany({})
    expect(exe).toMatchObject({ ticker: 'SPY', direction: 'buy', quantity: 9, price: 540.25, status: 'queued' })
    const decision = await h.db.botEvent.findFirst({ where: { type: 'decision_made' } })
    expect(decision.metadata.decisionContext).toMatchObject({ reason: 'research_accepted', ageHours: 6.5, simulation: { mode: 'historical_replay', session: SESSION } })
    expect(ae.requests).toContain(`/api/research/latest?ticker=SPY&tenant_id=default&mode=historical_replay&session=${SESSION}`)

    await drain()
    const filled = await h.db.execution.findUnique({ where: { id: exe.id } })
    expect(filled).toMatchObject({ status: 'filled', filledQuantity: 9, filledPrice: 540.25, brokerOrderId: `simreplay_${SESSION}_${exe.clientOrderId}` })
    expect(h.alpacaConstructed).toBe(0)

    const research = await request(app.server).get(`/api/executions/${exe.id}/research`).set(as())
    expect(research.body.data).toMatchObject({ status: 'verified_digest', predictionId: 'pred_spy_buy' })
    const status = await request(app.server).get('/api/account/broker-credentials').set(as())
    expect(status.body).toMatchObject({ connected: true, paper: true, simulated: true, mode: 'historical_replay', session: SESSION, cash: 100000 - 9 * 540.25 })
    const account = await request(app.server).get('/api/account').set(as())
    expect(account.body.buying_power).toBeCloseTo(100000 - 9 * 540.25, 2)
  })

  it('refuses to fill at any session other than the configured one', async () => {
    setMarketOpenState(true)
    ae.closes = { SPY: { session: '2026-11-19', close: 530 } }
    await feedTick() // price feed refuses the wrong session: no tick, no decision
    expect(await h.db.execution.count()).toBe(0)

    ae.closes = { SPY: { session: SESSION, close: 540.25 } }
    await feedTick()
    ae.closes = { SPY: { session: '2026-11-19', close: 530 } }
    await drain()
    const [exe] = await h.db.execution.findMany({})
    expect(exe.status).not.toBe('filled')
    expect(exe.filledQuantity ?? 0).toBe(0)
  })

  it('reconstructs simulated orders after a restart (no resubmission)', async () => {
    setMarketOpenState(true)
    await feedTick()
    await drain()
    const [exe] = await h.db.execution.findMany({})
    clearSimulatedBrokers()
    const broker = await getBrokerClient('usr_a')
    expect(await broker.getOrderByClientOrderId(exe.clientOrderId)).toMatchObject({ status: 'filled', filledQty: 9, filledAvgPrice: 540.25 })
    expect(await broker.getOrder(exe.brokerOrderId)).toMatchObject({ alpacaOrderId: exe.brokerOrderId })
    await expect(broker.submitOrder({ ticker: 'SPY', side: 'buy', qty: 1, clientOrderId: exe.clientOrderId })).rejects.toBeTruthy()
  })

  it('does not trade when the replayed calendar is not open', async () => {
    expect(getMarketHours().isOpen).toBe(false)
    await feedTick()
    expect(await h.db.execution.count()).toBe(0)
  })
})

describe('normal risk policy inside the simulator', () => {
  const reject = { approved: false, decision: 'reject', reason: 'execution_weak', adjustedQuantity: 0, failedChecks: [], scores: { execution: { score: 45 } }, riskScore: 100 }

  it('blocks research the risk engine rejects, recording the verdict and real market data', async () => {
    h.risk = reject
    setMarketOpenState(true)
    await feedTick()
    expect(await h.db.execution.count()).toBe(0)
    const ev = await h.db.botEvent.findFirst({ where: { type: 'execution_blocked_by_risk' } })
    expect(ev.metadata.riskDecision).toMatchObject({ basis: 'rejected', decision: 'reject', reason: 'execution_weak',
      marketData: { ticker: 'SPY', price: 540.25, volume: 3e6, avgVolume: 2e6, session: SESSION } })
    expect(ev.metadata.riskDecision.marketData.regime).toBeUndefined()
  })

  it('a labelled test scenario simulates the lifecycle anyway, with P&L at the latest known close', async () => {
    h.risk = reject
    process.env.SIM_TEST_SCENARIO = 'p0-demo'
    setMarketOpenState(true)
    await feedTick()
    const [exe] = await h.db.execution.findMany({})
    const created = await h.db.botEvent.findFirst({ where: { type: 'execution_created' } })
    expect(created.metadata.riskDecision).toMatchObject({ basis: 'simulator_test_scenario', decision: 'reject', reason: 'execution_weak',
      testScenario: { name: 'p0-demo', mode: 'historical_replay', session: SESSION } })
    const audit = await h.db.executionAudit.findFirst({ where: { executionId: exe.id, eventType: 'execution_created' } })
    expect(audit.metadata.riskDecision.basis).toBe('simulator_test_scenario')
    await drain()
    expect(await h.db.execution.findUnique({ where: { id: exe.id } })).toMatchObject({ status: 'filled', filledPrice: 540.25, brokerOrderId: `simreplay_${SESSION}_${exe.clientOrderId}` })

    const bot = await request(app.server).get('/api/bots/bot_r').set(as())
    expect(bot.body.data.performance).toMatchObject({ unrealizedPnl: Number(((545.75 - 540.25) * 9).toFixed(2)),
      valuation: { simulated: true, sessions: { SPY: '2026-11-21' } } })
  })
})


describe('risk evaluation uses the Home valuation (same user-scoped model and as-of)', () => {
  it('gate state equals /api/account/valuation, and an unpriced holding fails closed', async () => {
    await h.db.execution.create({ data: { id: 'exe_v', userId: 'usr_a', portfolioId: 'por_a', botId: 'bot_r', ticker: 'SPY', direction: 'buy',
      quantity: 9, price: 540.25, status: 'filled', filledQuantity: 9, filledPrice: 540.25, fees: 0, commission: 0, origin: 'bot',
      brokerOrderId: `simreplay_${SESSION}_tp_exe_v`, createdAt: new Date(), filledAt: new Date() } })
    const { riskGateService } = await import('../../../worker/src/risk/services/RiskGateService.js')
    const { clearRiskSnapshotCache } = await import('../../../worker/src/risk/accountSnapshot.js')
    clearRiskSnapshotCache()

    const home = (await request(app.server).get('/api/account/valuation').set(as())).body.data
    const state = await riskGateService.getPortfolioState('por_a')
    expect(state.totalValue).toBeCloseTo(home.equity, 2)          // marked at 545.75, not cost
    expect(state.totalValue).toBeCloseTo(100000 - 9 * 540.25 + 9 * 545.75, 2)
    expect(state.cashBalance).toBeCloseTo(home.cash, 2)
    expect(state.totalExposure).toBeCloseTo(home.marketValue, 2)
    expect(state.positions).toEqual([expect.objectContaining({ ticker: 'SPY', quantity: 9, value: home.positions[0].marketValue })])
    expect(state.pricesAsOf).toBe(home.pricesAsOf)
    expect(state.drawdown).toBe(0)                                  // above starting cash
    expect(state.dailyLoss).toBe(0)

    ae.latest = {}                                                  // no known close any more
    clearRiskSnapshotCache()
    await expect(riskGateService.getPortfolioState('por_a')).rejects.toThrow('price_unavailable:SPY')
    const verdict = await riskGateService.evaluateExecutionRisk({ portfolioId: 'por_a', ticker: 'SPY', direction: 'buy', quantity: 1, price: 545.75, signal: {}, marketData: {} })
    expect(verdict).toMatchObject({ approved: false, decision: 'reject' })
  })
})

describe('unrealized drawdown stays covered by the risk gate (realized-only daily-loss rule is separate)', () => {
  it('a large unrealized drop fails the gate’s drawdown and session-loss checks at the default thresholds', async () => {
    await h.db.execution.create({ data: { id: 'exe_dd', userId: 'usr_a', portfolioId: 'por_a', botId: 'bot_r', ticker: 'SPY', direction: 'buy',
      quantity: 100, price: 540.25, status: 'filled', filledQuantity: 100, filledPrice: 540.25, fees: 0, commission: 0, origin: 'bot',
      brokerOrderId: `simreplay_${SESSION}_tp_exe_dd`, createdAt: new Date(), filledAt: new Date() } })
    ae.latest = { SPY: { session: '2026-11-21', close: 300 } }            // −44% on the position, nothing sold
    const { riskGateService } = await import('../../../worker/src/risk/services/RiskGateService.js')
    const { clearRiskSnapshotCache } = await import('../../../worker/src/risk/accountSnapshot.js')
    const { evaluateDailyLoss, resetDailyLossCache } = await import('../../../worker/src/engine/rules/dailyLoss.js')
    clearRiskSnapshotCache(); resetDailyLossCache()

    const state = await riskGateService.getPortfolioState('por_a')
    const settings = riskGateService.getDefaultRiskSettings()
    expect(state.totalValue).toBeCloseTo(100000 - 54025 + 30000, 2)
    expect(state.drawdown).toBeGreaterThan(settings.maxDrawdown)       // 24% > 15%
    expect((await riskGateService.checkDrawdown(state, settings)).passed).toBe(false)
    expect(state.dailyLoss).toBeGreaterThan(settings.maxDailyLoss)     // value lost since the reference close
    expect((await riskGateService.checkDailyLoss(state, settings)).passed).toBe(false)
    // …while the bot's daily-loss *rule* stays realized-only: nothing was sold, so it passes.
    expect(await evaluateDailyLoss({ maxLoss: 500 }, 'por_a')).toEqual({ pass: true, currentLoss: 0 })
  })
})
