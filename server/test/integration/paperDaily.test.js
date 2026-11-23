/**
 * paper_daily simulator (SIM_REPLAY_SESSION=latest): the session is Alpha Engine's latest
 * daily close, so it advances every trading day. A bot acts at most once per symbol per
 * session, fills at the close of the session it decided on, and fails closed on stale data.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import http from 'node:http'
import request from 'supertest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../../worker/src/db/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../src/services/metricsService.js', () => ({ default: { processExecutionFill: async () => {} } }))
vi.mock('../../../worker/src/logger.js', () => ({ log: { info() {}, warn() {}, error() {}, debug() {} } }))
vi.mock('../../../worker/src/market/dataStream.js', () => ({ subscribe() {}, unsubscribe() {} }))
vi.mock('../../../worker/src/risk/riskManagement.js', () => ({ riskManager: { evaluateExecutionRisk: async () => ({ approved: true, decision: 'approve', riskScore: 0.1 }) } }))
vi.mock('../../../worker/src/broker/alpacaClient.js', async (orig) => {
  const real = await orig()
  return { ...real, AlpacaClient: class { constructor() { throw new Error('Alpaca must never be constructed in simulator mode') } } }
})

const KEY = 'test-internal-key'
// latest[t] = the newest close Alpha Engine has; closes[t][session] = that session's close.
const ae = { latest: {}, closes: {} }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const send = (s, b) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)) }
  if (req.headers['x-internal-key'] !== KEY) return send(401, {})
  if (url.pathname === '/api/market/session-close') {
    const t = url.searchParams.get('ticker'); const s = url.searchParams.get('session')
    const c = s ? (ae.closes[t]?.[s] != null ? { session: s, close: ae.closes[t][s] } : null) : ae.latest[t]
    return c ? send(200, { ticker: t, session: c.session, close: c.close, volume: 3e6, avgVolume20: 2e6, timeframe: '1d', source: 'alpha-engine price_bars' }) : send(404, {})
  }
  if (url.pathname === '/api/research/latest') return send(200, { found: false, reason: 'no_accepted_publication' })
  send(404, {})
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
Object.assign(process.env, {
  ENGINE_URL: `http://127.0.0.1:${server.address().port}`, INTERNAL_READ_KEY: KEY, RESEARCH_INDEX_TTL_MS: '0',
  BROKER_MODE: 'simulated', SIM_REPLAY_SESSION: 'latest', SIM_STARTING_CASH: '100000',
})

const { clearSimulatedBrokers } = await import('../../../worker/src/broker/simulatedBroker.js')
const engine = await import('../../../worker/src/engine/botEngine.js')
const worker = await import('../../../worker/src/queues/orderWorker.js')
const { eligibilityConfig } = await import('../../../worker/src/risk/orderEligibility.js')
const { replayTick } = await import('../../../worker/src/market/replayFeed.js')
const { setMarketOpenState } = await import('../../../worker/src/market/calendar.js')
const { simulationConfig, currentSimSession, resetSimSessionCache, simulatedAccount } = await import('../../src/services/simulationService.js')
const { waitForSchema } = await import('../../../worker/src/db/schemaGate.js')
const { default: createApp } = await import('../../src/loaders/fastify.js')
const { default: registerRoutes } = await import('../../src/loaders/routes.js')

let app, token
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T23:00:00Z') })
  h.db = createMemoryPrisma()
  app = await createApp(); await registerRoutes(app); await app.ready()
  token = app.jwt.sign({ sub: 'usr_a' })
})
afterAll(async () => { vi.useRealTimers(); await app.close(); await new Promise((r) => server.close(r)) })

const DAY1 = '2026-11-20', DAY2 = '2026-11-23'
function setSession(session, close, { at } = {}) {
  ae.latest.SPY = { session, close }
  ae.closes.SPY = { ...(ae.closes.SPY ?? {}), [session]: close }
  resetSimSessionCache()
  if (at) vi.setSystemTime(new Date(at))
}

beforeEach(async () => {
  h.db.reset()
  clearSimulatedBrokers()
  engine.stopBotEngine()
  engine.inflightMap.clear()
  worker.setInflightMap(engine.inflightMap)
  ae.latest = {}; ae.closes = {}
  setSession(DAY1, 540.25, { at: '2026-11-20T23:00:00Z' })
  setMarketOpenState(true)
  Object.assign(worker.orderWorkerConfig, { sleep: async () => {}, now: () => new Date(), fillTimeoutMs: 0, fillPollIntervalMs: 0, reconcileIntervalMs: 0, notFoundGraceMs: 60_000, stuckAfterMs: 120_000, cancelPollMs: 0, maxAttempts: 3 })
  eligibilityConfig.maxPriceAgeMs = 5 * 60_000
  await h.db.user.create({ data: { id: 'usr_a', email: 'a@example.test', riskSettings: null, subscription: { status: 'ACTIVE' } } })
  await h.db.portfolio.create({ data: { id: 'por_a', userId: 'usr_a' } })
  await h.db.bot.create({ data: { id: 'bot_p', userId: 'usr_a', portfolioId: 'por_a', name: 'P', enabled: true, botType: 'rule_based',
    config: { direction: 'buy', tickers: ['SPY'], capitalMode: 'allocated', allocatedAmount: 10_000, maxOrderNotional: 1_000 } } })
  await h.db.botRule.create({ data: { id: 'rule_pt', botId: 'bot_p', name: 'Price', type: 'price_threshold', config: { operator: 'above', price: 100 } } })
})

const bot = async () => ({ ...(await h.db.bot.findUnique({ where: { id: 'bot_p' } })), rules: await h.db.botRule.findMany({ where: { botId: 'bot_p' } }) })
const tick = async () => replayTick({ resolveSession: () => currentSimSession(), onTick: async (t) => engine.evaluateBot(await bot(), t) })
async function drain() { for (let i = 0; i < 20; i++) if (!(await worker.runOnce())) return }
const orders = () => h.db.execution.findMany({ where: { botId: 'bot_p' }, orderBy: { createdAt: 'asc' } })

describe('paper_daily simulator', () => {
  it('is enabled by SIM_REPLAY_SESSION=latest and resolves the latest close', async () => {
    expect(simulationConfig()).toMatchObject({ enabled: true, mode: 'paper_daily', session: null })
    expect(await currentSimSession()).toBe(DAY1)
    expect(simulationConfig({ SIM_REPLAY_SESSION: 'latest' }).enabled).toBe(false) // still needs BROKER_MODE=simulated
  })

  it('fills at the session close, labelled simdaily_, and acts once per session', async () => {
    await tick(); await drain()
    await tick(); await tick(); await drain() // same session: no more orders
    const [o, ...rest] = await orders()
    expect(rest).toHaveLength(0)
    expect(o).toMatchObject({ simSession: DAY1, status: 'filled', filledPrice: 540.25 })
    expect(o.brokerOrderId).toMatch(new RegExp(`^simdaily_${DAY1}_`))
    const skips = await h.db.botEvent.findMany({ where: { botId: 'bot_p', type: 'execution_skipped' } })
    expect(skips.some((e) => e.metadata?.reason === 'acted_this_session')).toBe(true)
  })

  it('after acting, the reason shown is "done for this session", even with a cooldown rule', async () => {
    // Own bot id: the engine's in-memory cooldown and log-dedupe caches are keyed by bot.
    await h.db.bot.create({ data: { id: 'bot_cd', userId: 'usr_a', portfolioId: 'por_a', name: 'CD', enabled: true, botType: 'rule_based',
      config: { direction: 'buy', tickers: ['SPY'], capitalMode: 'allocated', allocatedAmount: 10_000, maxOrderNotional: 1_000 } } })
    await h.db.botRule.create({ data: { id: 'rule_cd_pt', botId: 'bot_cd', name: 'Price', type: 'price_threshold', config: { operator: 'above', price: 100 } } })
    await h.db.botRule.create({ data: { id: 'rule_cd', botId: 'bot_cd', name: 'Cooldown', type: 'cooldown', config: { windowMs: 3_600_000 } } })
    const cd = async () => ({ ...(await h.db.bot.findUnique({ where: { id: 'bot_cd' } })), rules: await h.db.botRule.findMany({ where: { botId: 'bot_cd' } }) })
    const tickCd = () => replayTick({ resolveSession: () => currentSimSession(), onTick: async (t) => engine.evaluateBot(await cd(), t) })
    await tickCd(); await drain()
    expect(await h.db.execution.count({ where: { botId: 'bot_cd', status: 'filled' } })).toBe(1)
    await tickCd()
    const skips = (await h.db.botEvent.findMany({ where: { botId: 'bot_cd', type: 'execution_skipped' } })).map((e) => e.metadata?.reason)
    expect(skips).toContain('acted_this_session')
    expect(skips).not.toContain('cooldown_active')
  })

  it('acts again on the next session’s close (prices advance day to day)', async () => {
    await tick(); await drain()
    setSession(DAY2, 551.5, { at: '2026-11-23T23:00:00Z' })
    await tick(); await drain()
    const os = await orders()
    expect(os.map((o) => [o.simSession, o.filledPrice])).toEqual([[DAY1, 540.25], [DAY2, 551.5]])
    const acct = await simulatedAccount('usr_a')
    expect(acct).toMatchObject({ simulated: true, mode: 'paper_daily' })
    expect(Number(acct.positions.find((p) => p.symbol === 'SPY').qty)).toBe(os.reduce((s, o) => s + o.filledQuantity, 0))
  })

  it('fills at the session it decided on, even if a newer close arrives before the fill', async () => {
    await tick() // decided on DAY1
    setSession(DAY2, 551.5, { at: '2026-11-20T23:01:00Z' }) // a newer close lands a minute later
    await drain()
    const [o] = await orders()
    expect(o).toMatchObject({ simSession: DAY1, status: 'filled', filledPrice: 540.25 })
  })

  it('a refusal also uses up the session: no retry until the next close', async () => {
    await h.db.execution.create({ data: { id: 'exe_ref', userId: 'usr_a', portfolioId: 'por_a', botId: 'bot_p', ticker: 'SPY', direction: 'buy', quantity: 1, price: 540.25,
      status: 'refused', refusalReason: 'max_daily_notional', simSession: DAY1, fees: 0, commission: 0, origin: 'bot', createdAt: new Date(Date.now() - 20 * 60_000) } })
    await tick(); await drain()
    expect((await orders()).map((o) => o.id)).toEqual(['exe_ref'])
  })

  it('fails closed: stale market data or a symbol without the current close is never traded', async () => {
    vi.setSystemTime(new Date('2026-11-30T23:00:00Z')); resetSimSessionCache() // latest close DAY1 is 10 days old
    await expect(currentSimSession()).rejects.toMatchObject({ code: 'SIM_STALE_SESSION' })
    await tick(); await drain()
    expect(await orders()).toHaveLength(0)

    // Reference session is current, but this bot's symbol only has an older close.
    setSession(DAY2, 551.5, { at: '2026-11-23T23:00:00Z' })
    await h.db.bot.update({ where: { id: 'bot_p' }, data: { config: { direction: 'buy', tickers: ['XYZ'], capitalMode: 'allocated', allocatedAmount: 10_000, maxOrderNotional: 1_000 } } })
    ae.latest.XYZ = { session: DAY1, close: 10 }; ae.closes.XYZ = { [DAY1]: 10 }
    await tick(); await drain()
    expect(await orders()).toHaveLength(0)
  })

  it('reports the mode and current session to the app', async () => {
    const res = await request(app.server).get('/api/account/broker-credentials').set({ Authorization: `Bearer ${token}` })
    expect(res.body).toMatchObject({ simulated: true, mode: 'paper_daily', session: DAY1 })
  })
})

describe('worker schema gate (deploy-order safety)', () => {
  it('waits while columns are missing, then starts', async () => {
    let calls = 0
    const client = new Proxy({}, { get: () => ({ findFirst: async () => { calls++; if (calls <= 2) throw Object.assign(new Error('The column `Execution.simSession` does not exist'), { code: 'P2022' }); return null } }) })
    const sleeps = []
    expect(await waitForSchema({ client, sleep: async (ms) => { sleeps.push(ms) }, intervalMs: 5 })).toBe(true)
    expect(sleeps).toEqual([5, 5])
  })

  it('rethrows other errors, and gives up after the timeout', async () => {
    const boom = new Proxy({}, { get: () => ({ findFirst: async () => { throw Object.assign(new Error('connection refused'), { code: 'P1001' }) } }) })
    await expect(waitForSchema({ client: boom, sleep: async () => {} })).rejects.toMatchObject({ code: 'P1001' })
    let t = 0
    const missing = new Proxy({}, { get: () => ({ findFirst: async () => { throw Object.assign(new Error('missing'), { code: 'P2022' }) } }) })
    await expect(waitForSchema({ client: missing, sleep: async () => {}, timeoutMs: 10, now: () => (t += 6) })).rejects.toMatchObject({ code: 'P2022' })
  })
})
