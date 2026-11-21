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

