/**
 * Execution integrity (review of c43d5ca + f860c93): a bot's direction is never overwritten
 * by existing holdings, SELL behaviour is unchanged, duplicate/concurrent evaluations place one
 * order, cooldowns hold after fills, across restarts and at their boundaries, and risk checks
 * still gate every order. Runs on the isolated simulator harness (no broker).
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
const { evaluateCooldown, resetCooldownCache } = await import('../../../worker/src/engine/rules/cooldown.js')
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
  resetCooldownCache()
})


const HOUR = 3_600_000
const sessionOrder = (id) => `simreplay_${SESSION}_tp_${id}`

async function mkBot(id, config, rules = [{ type: 'market_hours' }]) {
  await h.db.bot.create({ data: { id, userId: 'usr_a', portfolioId: 'por_a', name: id, enabled: true, botType: 'rule_based',
    config: { tickers: ['SPY'], capitalMode: 'allocated', allocatedAmount: 5_000, maxOrderNotional: 1_000, ...config } } })
  for (const [i, r] of rules.entries()) await h.db.botRule.create({ data: { id: `${id}_r${i}`, botId: id, name: r.type, type: r.type, config: r.config ?? {} } })
}
async function holding(botId, qty, id = `exe_hold_${botId}`) {
  const at = new Date(Date.now() - 60_000)
  await h.db.execution.create({ data: { id, userId: 'usr_a', portfolioId: 'por_a', botId, ticker: 'SPY', direction: 'buy', quantity: qty, price: 540.25,
    status: 'filled', filledQuantity: qty, filledPrice: 540.25, fees: 0, commission: 0, origin: 'bot', brokerOrderId: sessionOrder(id), createdAt: at, filledAt: at } })
}
const loadBot = async (id) => ({ ...(await h.db.bot.findUnique({ where: { id } })), rules: await h.db.botRule.findMany({ where: { botId: id } }) })
async function tick(id) {
  const bot = await loadBot(id)
  return replayTick({ session: SESSION, onTick: async () => engine.evaluateBot(bot, 'SPY') })
}
async function drain() { for (let i = 0; i < 20; i++) if (!(await worker.runOnce())) return }
const ordersOf = (botId) => h.db.execution.findMany({ where: { botId } })
const eventsOf = async (botId, type) => (await h.db.botEvent.findMany({ where: { botId } })).filter((e) => !type || e.type === type)
const restart = () => { resetCooldownCache(); engine.inflightMap.clear() }

describe('direction integrity (c43d5ca)', () => {
  beforeEach(() => setMarketOpenState(true))

  it('BUY: buys even when the owner already holds the symbol through another bot', async () => {
    await holding('bot_other', 2)
    await mkBot('bot_b', { direction: 'buy' }, [{ type: 'position_limit', config: { maxShares: 100 } }])
    await tick('bot_b')
    const [o] = await ordersOf('bot_b')
    expect(o).toMatchObject({ direction: 'buy', ticker: 'SPY' })
  })

  it('BUY: rule order (position_limit / trend data loaded first) cannot flip the direction', async () => {
    await holding('bot_other', 2)
    await mkBot('bot_b2', { direction: 'buy' }, [{ type: 'position_limit', config: { maxShares: 100 } }, { type: 'market_hours' }])
    await tick('bot_b2')
    expect((await ordersOf('bot_b2')).map((o) => o.direction)).toEqual(['buy'])
  })

  it('SELL with a shared symbol: each bot sells only its own lots, and the sell fills', async () => {
    await holding('bot_s1', 1)
    await holding('bot_other', 2) // account holds 3 SPY across two bots
    await mkBot('bot_s1', { direction: 'sell' })
    await tick('bot_s1')
    await drain()
    const sells = (await ordersOf('bot_s1')).filter((x) => x.direction === 'sell')
    expect(sells).toHaveLength(1)
    expect(sells[0]).toMatchObject({ quantity: 1, status: 'filled' }) // not 3, not refused
    expect((await ordersOf('bot_other')).filter((x) => x.direction === 'sell')).toHaveLength(0)
  })

  it('SELL with a shared symbol: a bot holding none never sells another bot’s shares', async () => {
    await holding('bot_other', 2)
    await mkBot('bot_none', { direction: 'sell' })
    await tick('bot_none')
    expect((await ordersOf('bot_none')).filter((x) => x.direction === 'sell')).toHaveLength(0)
    expect((await eventsOf('bot_none', 'execution_skipped')).map((e) => e.metadata?.reason)).toContain('no_position')
  })

  it('EXIT: a buy bot with a stop-loss sells its own shares, sized by its per-order limit', async () => {
    ae.closes = { SPY: { session: SESSION, close: 480 } } // 11% below the 540.25 cost
    await holding('bot_x', 3)
    await holding('bot_other', 5)
    await mkBot('bot_x', { direction: 'buy', maxOrderNotional: 1000, exit: { rules: [{ type: 'stop_loss', config: { pct: 10 } }] } },
      [{ type: 'price_threshold', config: { operator: 'above', price: 10_000 } }]) // entry never passes
    await tick('bot_x')
    await drain()
    const sells = (await ordersOf('bot_x')).filter((o) => o.direction === 'sell')
    expect(sells).toHaveLength(1)
    expect(sells[0]).toMatchObject({ quantity: 2, status: 'filled' }) // floor(1000 / 480), of its own 3
    const ev = (await eventsOf('bot_x', 'decision_made')).find((e) => e.metadata?.exit)
    expect(ev.metadata.exit).toMatchObject({ rule: 'stop_loss' })
  })

  it('EXIT: never sells without its own shares (no naked or borrowed selling)', async () => {
    ae.closes = { SPY: { session: SESSION, close: 480 } }
    await holding('bot_other', 5)
    await mkBot('bot_y', { direction: 'buy', exit: { rules: [{ type: 'stop_loss', config: { pct: 1 } }] } }, [{ type: 'price_threshold', config: { operator: 'above', price: 10_000 } }])
    await tick('bot_y')
    expect((await ordersOf('bot_y')).filter((o) => o.direction === 'sell')).toHaveLength(0)
  })

  it('SELL: a sell bot sells the shares it holds (unchanged behaviour)', async () => {
    await holding('bot_s', 3)
    await mkBot('bot_s', { direction: 'sell' })
    await tick('bot_s')
    const sells = (await ordersOf('bot_s')).filter((o) => o.direction === 'sell')
    expect(sells).toHaveLength(1)
    expect(sells[0].quantity).toBe(3)
    await drain()
    expect(await h.db.execution.findUnique({ where: { id: sells[0].id } })).toMatchObject({ status: 'filled', filledQuantity: 3 })
  })

  it('SELL: cannot sell shares that belong to another bot (attributable-holdings guard)', async () => {
    await holding('bot_other', 2)
    await mkBot('bot_s2', { direction: 'sell' })
    await tick('bot_s2')
    await drain()
    const fills = (await ordersOf('bot_s2')).filter((o) => Number(o.filledQuantity) > 0)
    expect(fills).toHaveLength(0)
  })

  it('SELL: with nothing held, it records no_position and places no order', async () => {
    await mkBot('bot_s3', { direction: 'sell' })
    await tick('bot_s3')
    expect(await ordersOf('bot_s3')).toHaveLength(0)
    expect((await eventsOf('bot_s3', 'execution_skipped')).map((e) => e.metadata.reason)).toContain('no_position')
  })

  it('no configured direction is never defaulted from holdings', async () => {
    await holding('bot_other', 2)
    await mkBot('bot_n', { direction: undefined }, [{ type: 'position_limit', config: { maxShares: 100 } }])
    await tick('bot_n')
    expect(await ordersOf('bot_n')).toHaveLength(0)
    expect((await eventsOf('bot_n', 'execution_skipped')).map((e) => e.metadata.reason)).toContain('missing_direction')
  })

  it('risk still gates a buy bot that holds the symbol elsewhere (no bypass)', async () => {
    await holding('bot_other', 2)
    h.risk = { approved: false, decision: 'reject', reason: 'execution_weak', adjustedQuantity: 0, failedChecks: [], scores: {}, riskScore: 100 }
    await mkBot('bot_r1', { direction: 'buy' }, [{ type: 'position_limit', config: { maxShares: 100 } }])
    await tick('bot_r1')
    expect(await ordersOf('bot_r1')).toHaveLength(0)
    const [blocked] = await eventsOf('bot_r1', 'execution_blocked_by_risk')
    expect(blocked.metadata).toMatchObject({ signal: 'buy', riskDecision: { decision: 'reject' } })
  })
})

describe('duplicate and concurrent evaluations', () => {
  beforeEach(() => setMarketOpenState(true))

  it('two simultaneous evaluations of one bot and symbol place exactly one order', async () => {
    await mkBot('bot_d', { direction: 'buy' })
    const bot = await loadBot('bot_d')
    await replayTick({ session: SESSION, onTick: async () => { await Promise.all([engine.evaluateBot(bot, 'SPY'), engine.evaluateBot(bot, 'SPY')]) } })
    expect(await ordersOf('bot_d')).toHaveLength(1)
  })

  it('a repeated tick while the first order is still open does not add a second order', async () => {
    await mkBot('bot_d2', { direction: 'buy' })
    await tick('bot_d2')
    await tick('bot_d2')
    expect(await ordersOf('bot_d2')).toHaveLength(1)
  })
})

describe('cooldown integrity (f860c93)', () => {
  const cooldown = [{ type: 'cooldown', config: { windowMs: HOUR } }]
  beforeEach(() => setMarketOpenState(true))

  it('holds after the order fills (no second order inside the window)', async () => {
    await mkBot('bot_c', { direction: 'buy' }, cooldown)
    await tick('bot_c')
    await drain()
    expect((await ordersOf('bot_c'))[0].status).toBe('filled')
    await tick('bot_c')
    expect(await ordersOf('bot_c')).toHaveLength(1)
  })

  it('holds across a worker restart (empty caches → database decides)', async () => {
    await mkBot('bot_c2', { direction: 'buy' }, cooldown)
    await tick('bot_c2')
    await drain()
    restart()
    await tick('bot_c2')
    expect(await ordersOf('bot_c2')).toHaveLength(1)
    expect((await eventsOf('bot_c2')).some((e) => e.metadata?.reason === 'cooldown_active')).toBe(true)
  })

  it('a stale cached pass cannot place an order another evaluation already placed and filled', async () => {
    await mkBot('bot_c3', { direction: 'buy' }, cooldown)
    expect(await evaluateCooldown({ windowMs: HOUR }, 'bot_c3', 'SPY')).toEqual({ pass: true }) // cache now says "pass"
    await holding('bot_c3', 1, 'exe_elsewhere') // an order filled meanwhile (other evaluation / process)
    await tick('bot_c3')
    expect((await ordersOf('bot_c3')).map((o) => o.id)).toEqual(['exe_elsewhere'])
  })

  it('boundary: blocked just inside the window, allowed once it has elapsed', async () => {
    await mkBot('bot_c4', { direction: 'buy' }, cooldown)
    await tick('bot_c4')
    await drain()
    const [first] = await ordersOf('bot_c4')
    const placedAt = new Date(first.createdAt).getTime()

    vi.setSystemTime(new Date(placedAt + HOUR - 1_000))
    restart()
    await tick('bot_c4')
    expect(await ordersOf('bot_c4')).toHaveLength(1)

    vi.setSystemTime(new Date(placedAt + HOUR + 1_000))
    restart()
    await tick('bot_c4')
    expect(await ordersOf('bot_c4')).toHaveLength(2)
  })
})

describe('multi-worker atomicity (cooldown check + insert in one transaction)', () => {
  const cooldown = [{ type: 'cooldown', config: { windowMs: HOUR } }]
  beforeEach(() => setMarketOpenState(true))

  it('blocks when another process places AND fills an order between the pre-checks and the insert', async () => {
    await mkBot('bot_m1', { direction: 'buy' }, cooldown)
    // Simulate worker B: just before our transaction starts (at the pre-insert intent check),
    // another process inserts and fills an order for the same bot, releasing its intent key.
    const realFindUnique = h.db.execution.findUnique
    let raced = false
    h.db.execution.findUnique = async (args) => {
      if (!raced && args?.where?.activeIntentKey) {
        raced = true
        await holding('bot_m1', 1, 'exe_other_worker')
      }
      return realFindUnique(args)
    }
    try {
      await tick('bot_m1')
    } finally {
      h.db.execution.findUnique = realFindUnique
    }
    expect(raced).toBe(true)
    expect((await ordersOf('bot_m1')).map((o) => o.id)).toEqual(['exe_other_worker'])
    expect((await eventsOf('bot_m1')).some((e) => e.metadata?.reason === 'cooldown_active')).toBe(true)
  })

  it('locks the bot row inside the same transaction as the insert, before the cooldown read', async () => {
    await mkBot('bot_m2', { direction: 'buy' }, cooldown)
    const calls = []
    h.db.$queryRaw = async (strings, ...values) => { calls.push(['lock', strings.join('?'), values]); return [] }
    const realCreate = h.db.execution.create
    const realFindFirst = h.db.execution.findFirst
    h.db.execution.findFirst = async (args) => { calls.push(['cooldown-read']); return realFindFirst(args) }
    h.db.execution.create = async (args) => { calls.push(['insert']); return realCreate(args) }
    try {
      await tick('bot_m2')
    } finally {
      delete h.db.$queryRaw
      h.db.execution.create = realCreate
      h.db.execution.findFirst = realFindFirst
    }
    const i = calls.findIndex((c) => c[0] === 'lock')
    expect(calls[i][1]).toMatch(/SELECT id FROM Bot WHERE id = \? FOR UPDATE/)
    expect(calls[i][2]).toEqual(['bot_m2'])
    expect(calls.slice(i).map((c) => c[0])).toEqual(['lock', 'cooldown-read', 'insert'])
  })

  it('bots without a cooldown are unaffected (no lock, normal placement)', async () => {
    await mkBot('bot_m3', { direction: 'buy' })
    let locked = false
    h.db.$queryRaw = async () => { locked = true; return [] }
    try { await tick('bot_m3') } finally { delete h.db.$queryRaw }
    expect(locked).toBe(false)
    expect(await ordersOf('bot_m3')).toHaveLength(1)
  })
})

describe('ownership isolation', () => {
  beforeEach(() => setMarketOpenState(true))

  it('another user’s holdings never count: a sell bot with no own position places nothing; a buy bot buys', async () => {
    await h.db.user.create({ data: { id: 'usr_b', email: 'b@example.test', riskSettings: null, subscription: { status: 'ACTIVE' } } })
    await h.db.portfolio.create({ data: { id: 'por_b', userId: 'usr_b' } })
    const at = new Date(Date.now() - 60_000)
    await h.db.execution.create({ data: { id: 'exe_b', userId: 'usr_b', portfolioId: 'por_b', botId: 'bot_of_b', ticker: 'SPY', direction: 'buy', quantity: 50, price: 540.25,
      status: 'filled', filledQuantity: 50, filledPrice: 540.25, fees: 0, commission: 0, origin: 'bot', brokerOrderId: sessionOrder('exe_b'), createdAt: at, filledAt: at } })
    await mkBot('bot_sell_a', { direction: 'sell' })
    await mkBot('bot_buy_a', { direction: 'buy' }, [{ type: 'position_limit', config: { maxShares: 100 } }])
    await tick('bot_sell_a')
    await tick('bot_buy_a')
    expect(await ordersOf('bot_sell_a')).toHaveLength(0)
    expect((await eventsOf('bot_sell_a', 'execution_skipped')).map((e) => e.metadata.reason)).toContain('no_position')
    expect((await ordersOf('bot_buy_a')).map((o) => o.direction)).toEqual(['buy'])
  })
})

describe('refused orders and the cooldown', () => {
  beforeEach(() => setMarketOpenState(true))
  const refused = (botId, id, at = new Date()) => h.db.execution.create({ data: { id, userId: 'usr_a', portfolioId: 'por_a', botId, ticker: 'SPY', direction: 'buy', quantity: 1, price: 540.25,
    status: 'cancelled', cancelReason: 'refused:max_daily_notional', fees: 0, commission: 0, origin: 'bot', createdAt: at } })

  it('an order refused at submission counts as an attempt: no re-submission inside the window', async () => {
    await mkBot('bot_rf', { direction: 'buy' }, [{ type: 'cooldown', config: { windowMs: HOUR } }])
    await refused('bot_rf', 'exe_refused_1')
    await tick('bot_rf')
    expect((await ordersOf('bot_rf')).map((o) => o.id)).toEqual(['exe_refused_1'])
  })

  it('after the window it tries again; a user-cancelled order does not count', async () => {
    await mkBot('bot_rf2', { direction: 'buy' }, [{ type: 'cooldown', config: { windowMs: HOUR } }])
    await refused('bot_rf2', 'exe_refused_old', new Date(Date.now() - HOUR - 1000))
    await h.db.execution.create({ data: { id: 'exe_user_cancel', userId: 'usr_a', portfolioId: 'por_a', botId: 'bot_rf2', ticker: 'SPY', direction: 'buy', quantity: 1, price: 540.25,
      status: 'cancelled', cancelReason: null, fees: 0, commission: 0, origin: 'bot', createdAt: new Date() } })
    await tick('bot_rf2')
    expect(await ordersOf('bot_rf2')).toHaveLength(3)
  })
})

describe('refusal back-off (independent of rules)', () => {
  beforeEach(() => setMarketOpenState(true))
  const refusedAt = (botId, id, at) => h.db.execution.create({ data: { id, userId: 'usr_a', portfolioId: 'por_a', botId, ticker: 'SPY', direction: 'buy', quantity: 1, price: 540.25,
    status: 'cancelled', cancelReason: 'refused:bot_allocation_exceeded', fees: 0, commission: 0, origin: 'bot', createdAt: at } })

  it('a bot without a cooldown does not re-submit an order refused minutes ago', async () => {
    await mkBot('bot_nb', { direction: 'buy' })
    await refusedAt('bot_nb', 'exe_nb_refused', new Date(Date.now() - 60_000))
    await tick('bot_nb')
    expect((await ordersOf('bot_nb')).map((o) => o.id)).toEqual(['exe_nb_refused'])
    expect((await eventsOf('bot_nb', 'execution_skipped')).map((e) => e.metadata.reason)).toContain('refused_recently')
  })

  it('tries again once the back-off has passed', async () => {
    await mkBot('bot_nb2', { direction: 'buy' })
    await refusedAt('bot_nb2', 'exe_nb2_refused', new Date(Date.now() - engine.REFUSAL_BACKOFF_MS - 1000))
    await tick('bot_nb2')
    expect(await ordersOf('bot_nb2')).toHaveLength(2)
  })
})

describe('refused status (current shape) in cooldown and back-off', () => {
  beforeEach(() => setMarketOpenState(true))
  const refusedNew = (botId, id, at) => h.db.execution.create({ data: { id, userId: 'usr_a', portfolioId: 'por_a', botId, ticker: 'SPY', direction: 'buy', quantity: 1, price: 540.25,
    status: 'refused', refusalReason: 'max_daily_notional', fees: 0, commission: 0, origin: 'bot', createdAt: at } })

  it('cooldown counts a status-"refused" order as an attempt', async () => {
    await mkBot('bot_rn', { direction: 'buy' }, [{ type: 'cooldown', config: { windowMs: HOUR } }])
    await refusedNew('bot_rn', 'exe_rn', new Date())
    await tick('bot_rn')
    expect((await ordersOf('bot_rn')).map((o) => o.id)).toEqual(['exe_rn'])
  })

  it('back-off applies to a status-"refused" order without any rules, and lifts after the window', async () => {
    await mkBot('bot_rn2', { direction: 'buy' })
    await refusedNew('bot_rn2', 'exe_rn2', new Date(Date.now() - 60_000))
    await tick('bot_rn2')
    expect(await ordersOf('bot_rn2')).toHaveLength(1)
    const [skip] = (await eventsOf('bot_rn2', 'execution_skipped')).filter((e) => e.metadata.reason === 'refused_recently')
    expect(skip.metadata.detail).toBe('max_daily_notional')

    await mkBot('bot_rn3', { direction: 'buy' })
    await refusedNew('bot_rn3', 'exe_rn3', new Date(Date.now() - engine.REFUSAL_BACKOFF_MS - 1000))
    await tick('bot_rn3')
    expect(await ordersOf('bot_rn3')).toHaveLength(2)
  })
})

describe.each([
  ['current', { status: 'refused', refusalReason: 'max_daily_notional', cancelReason: null }],
  ['legacy', { status: 'cancelled', cancelReason: 'refused:max_daily_notional' }],
])('refusal parity (%s shape): cooldown and back-off', (shape, fields) => {
  beforeEach(() => setMarketOpenState(true))
  const make = (botId, id, at) => h.db.execution.create({ data: { id, userId: 'usr_a', portfolioId: 'por_a', botId, ticker: 'SPY', direction: 'buy', quantity: 1, price: 540.25, fees: 0, commission: 0, origin: 'bot', createdAt: at, ...fields } })

  it('cooldown: blocks inside the window', async () => {
    await mkBot(`bot_p_${shape}`, { direction: 'buy' }, [{ type: 'cooldown', config: { windowMs: HOUR } }])
    await make(`bot_p_${shape}`, `exe_p_${shape}`, new Date())
    await tick(`bot_p_${shape}`)
    expect(await ordersOf(`bot_p_${shape}`)).toHaveLength(1)
  })

  it('back-off: blocks for 15 minutes with the same logged reason, then lifts', async () => {
    await mkBot(`bot_q_${shape}`, { direction: 'buy' })
    await make(`bot_q_${shape}`, `exe_q_${shape}`, new Date(Date.now() - 60_000))
    await tick(`bot_q_${shape}`)
    expect(await ordersOf(`bot_q_${shape}`)).toHaveLength(1)
    const skip = (await eventsOf(`bot_q_${shape}`, 'execution_skipped')).find((e) => e.metadata.reason === 'refused_recently')
    expect(skip.metadata.detail).toBe('max_daily_notional')

    await mkBot(`bot_r_${shape}`, { direction: 'buy' })
    await make(`bot_r_${shape}`, `exe_r_${shape}`, new Date(Date.now() - engine.REFUSAL_BACKOFF_MS - 1000))
    await tick(`bot_r_${shape}`)
    expect(await ordersOf(`bot_r_${shape}`)).toHaveLength(2)
  })
})
