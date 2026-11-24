/**
 * Backtests end to end: API validation and limits, one active run per user, worker processing
 * against Alpha Engine's daily-bars contract, isolation from Execution, failure recovery.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../../worker/src/db/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../src/services/alpacaClockService.js', async (orig) => ({
  ...(await orig()),
  getUserAlpacaCredentialsOrThrow: async () => ({ apiKey: 'k', apiSecret: 's', paper: true, baseUrl: 'https://paper-api.alpaca.markets' })
}))

const { default: createApp } = await import('../../src/loaders/fastify.js')
const { default: registerRoutes } = await import('../../src/loaders/routes.js')
const { processNextBacktest, failStaleBacktests } = await import('../../src/services/backtestService.js')

// Fake Alpha Engine over the daily-bars contract: 400 weekday sessions ending 2026-11-20.
const CAL = []
for (let t = Date.UTC(2026, 10, 20); CAL.length < 400; t -= 86_400_000) { const d = new Date(t); if (d.getUTCDay() % 6) CAL.unshift(d.toISOString().slice(0, 10)) }
const px = (t, i) => (t === 'NVDA' && i < 200 ? 10 : 1) * (100 + i * 0.2) // NVDA: a 10:1 price-basis break at session 200
const engine = {
  calls: [],
  async getDailyBars(t, start, end) {
    this.calls.push(['bars', t, start, end])
    const bars = CAL.map((d, i) => [d, px(t, i), px(t, i) * 1.01, px(t, i) * 0.99, px(t, i), 2e6]).filter((b) => b[0] >= start && b[0] <= end)
    return { ticker: t, bars, sha256: `sha-${t}` }
  },
  async getRegimeHistory() { return { points: [] } },
}

let app, tokenA, tokenB
const as = (t) => ({ Authorization: `Bearer ${t}` })
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-24T12:00:00Z') })
  h.db = createMemoryPrisma()
  app = await createApp(); await registerRoutes(app); await app.ready()
  tokenA = app.jwt.sign({ sub: 'usr_a' }); tokenB = app.jwt.sign({ sub: 'usr_b' })
})
afterAll(async () => { vi.useRealTimers(); await app.close() })
beforeEach(async () => {
  h.db.reset()
  for (const id of ['usr_a', 'usr_b']) {
    await h.db.user.create({ data: { id, email: `${id}@example.test`, riskSettings: null, subscription: { status: 'ACTIVE' } } })
    await h.db.portfolio.create({ data: { id: `por_${id}`, userId: id } })
  }
  await h.db.bot.create({ data: { id: 'bot_a', userId: 'usr_a', portfolioId: 'por_usr_a', name: 'Momentum', enabled: true, botType: 'rule_based',
    config: { tickers: ['SPY', 'NVDA'], direction: 'buy', allocatedAmount: 5000, maxOrderNotional: 1000 } } })
  await h.db.botRule.create({ data: { id: 'r1', botId: 'bot_a', name: 'Price', type: 'price_threshold', config: { operator: 'above', price: 50 } } })
  engine.calls = []
})
const post = (body, token = tokenA) => request(app.server).post('/api/backtests').set(as(token)).send(body)

describe('creating backtests', () => {
  it('snapshots the bot, and allows one active run per user', async () => {
    const r = await post({ botId: 'bot_a', range: '1Y' })
    expect(r.status).toBe(202)
    expect(r.body.data).toMatchObject({ status: 'queued', symbols: ['SPY', 'NVDA'], startDate: '2025-11-23', endDate: '2026-11-23', executionModel: 'next_open', riskPolicyVersion: expect.stringMatching(/^normal-/) })
    expect(r.body.data.configSnapshot.bot.rules).toEqual([{ type: 'price_threshold', config: { operator: 'above', price: 50 } }])
    expect(r.body.data.configHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.body.data.userId).toBeUndefined()
    expect((await post({ botId: 'bot_a' })).status).toBe(409)
    expect((await post({ config: { tickers: ['SPY'], direction: 'buy', allocatedAmount: 1000 }, rules: [{ type: 'price_threshold', config: { operator: 'above', price: 1 } }] }, tokenB)).status).toBe(202)
  })
  it('enforces the limits and refuses research bots and other users’ bots', async () => {
    const draft = (over = {}) => ({ config: { tickers: ['SPY'], direction: 'buy', allocatedAmount: 1000, ...over.config }, rules: [{ type: 'price_threshold', config: { operator: 'above', price: 1 } }], ...over.top })
    expect((await post(draft({ top: { start: '2020-01-01', end: '2026-11-20' } }))).body.error.code).toBe('range_too_long')
    expect((await post(draft({ top: { symbols: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'JPM'] } }))).body.error.code).toBe('too_many_symbols')
    expect((await post(draft({ top: { symbols: ['TSLA'] } }))).body.error.code).toBe('unsupported_symbols')
    expect((await post(draft({ config: { signalSource: 'alpha_research' } }))).body.error.code).toBe('research_not_backtestable')
    expect((await post(draft({ top: { end: '2026-12-01' } }))).body.error.code).toBe('future_end')
    expect((await post({ botId: 'bot_a' }, tokenB)).status).toBe(404)
  })
})

describe('processing', () => {
  it('runs from Alpha Engine bars, normalizes them, stores results and never writes executions', async () => {
    const { body } = await post({ botId: 'bot_a', range: '1Y', executionModel: 'same_close' })
    const run = await processNextBacktest({ engine })
    expect(run).toMatchObject({ id: body.data.id, status: 'succeeded', activeKey: null, dataFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(engine.calls.map((c) => c[1])).toEqual(['SPY', 'NVDA']) // calendar reference + the bot's symbols (SPY once)
    expect(engine.calls[0][2]).toBe('2025-10-09') // 45-day warm-up before the start, for the liquidity average
    expect(run.dataIssues).toContainEqual(expect.objectContaining({ ticker: 'NVDA', type: 'price_basis_adjusted', factor: 10 }))
    expect(run.results.metrics.trades).toBeGreaterThan(0)
    expect(run.results.trades.every((t) => t.price < 200)).toBe(true) // never bought on the unadjusted ×10 basis
    expect(await h.db.execution.findMany({})).toEqual([])
    const read = await request(app.server).get(`/api/backtests/${run.id}`).set(as(tokenA))
    expect(read.body.data.results.curve.length).toBeGreaterThan(200)
    expect((await request(app.server).get(`/api/backtests/${run.id}`).set(as(tokenB))).status).toBe(404)
    // The slot is free again.
    expect((await post({ botId: 'bot_a' })).status).toBe(202)
  })
  it('is reproducible: the same snapshot over the same data gives the same fingerprint and results', async () => {
    await post({ botId: 'bot_a', range: '1Y' })
    const a = await processNextBacktest({ engine })
    await post({ botId: 'bot_a', range: '1Y' })
    const b = await processNextBacktest({ engine })
    expect(b.configHash).toBe(a.configHash)
    expect(b.dataFingerprint).toBe(a.dataFingerprint)
    expect(b.results.metrics).toEqual(a.results.metrics)
  })
  it('records a failure and frees the slot; stale running runs are failed on restart', async () => {
    await post({ botId: 'bot_a' })
    const failing = { getDailyBars: async () => { throw new Error('alpha engine unreachable') }, getRegimeHistory: async () => ({ points: [] }) }
    expect(await processNextBacktest({ engine: failing })).toMatchObject({ status: 'failed', activeKey: null, error: 'alpha engine unreachable' })
    await post({ botId: 'bot_a' })
    await h.db.backtestRun.updateMany({ where: { status: 'queued' }, data: { status: 'running', startedAt: new Date(Date.now() - 31 * 60_000) } })
    expect((await failStaleBacktests()).count).toBe(1)
    expect((await post({ botId: 'bot_a' })).status).toBe(202)
  })
})

describe('experiments (M3)', () => {
  it('clones a bot paused, with every rule and its lineage', async () => {
    await h.db.botRule.create({ data: { id: 'r2', botId: 'bot_a', name: 'Cooldown', type: 'cooldown', config: { cooldownHours: 48 }, enabled: false } })
    const r = await request(app.server).post('/api/bots/bot_a/clone').set(as(tokenA)).send({})
    expect(r.status).toBe(201)
    const copy = r.body.data
    expect(copy).toMatchObject({ name: 'Momentum (copy)', enabled: false, config: { tickers: ['SPY', 'NVDA'], allocatedAmount: 5000, clonedFrom: { botId: 'bot_a', name: 'Momentum' } } })
    const rules = await h.db.botRule.findMany({ where: { botId: copy.id } })
    expect(rules.map((x) => [x.type, x.enabled])).toEqual([['price_threshold', true], ['cooldown', false]])
    expect((await request(app.server).post('/api/bots/bot_a/clone').set(as(tokenB)).send({})).status).toBe(404)
  })

  it('runs variants on the same data and reports each against the current settings', async () => {
    const { body, status } = await post({ botId: 'bot_a', range: '1Y', executionModel: 'same_close', variants: [
      { set: { triggerPrice: 1000 } }, { set: { cooldownDays: 200 } }, { label: 'Bigger orders', set: { maxOrderNotional: 2500 } },
    ] })
    expect(status).toBe(202)
    expect(body.data.configSnapshot.variants.map((v) => v.label)).toEqual(['Trigger price 1000', 'Cooldown (days) 200', 'Bigger orders'])
    const run = await processNextBacktest({ engine })
    const v = run.results.variants
    expect(v.map((x) => x.label)).toEqual(['Current', 'Trigger price 1000', 'Cooldown (days) 200', 'Bigger orders'])
    expect(v[0].metrics).toEqual(run.results.metrics)
    expect(v[1].metrics.trades).toBe(0) // never above 1000
    expect(v[2].metrics.trades).toBeLessThan(v[0].metrics.trades)
    expect(v.every((x) => x.curve.length <= 260)).toBe(true)
  })

  it('validates variants', async () => {
    const code = async (variants) => (await post({ botId: 'bot_a', variants })).body.error?.code
    expect(await code([{ set: {} }])).toBe('invalid_variants')
    expect(await code([{ set: { warpFactor: 9 } }])).toBe('invalid_variants')
    expect(await code([{ set: { triggerPrice: -1 } }])).toBe('invalid_variants')
    expect(await code([1, 2, 3, 4].map((p) => ({ set: { triggerPrice: p } })))).toBe('too_many_variants')
  })

  it('compares bots: paper results and the latest linked backtest', async () => {
    await post({ config: { tickers: ['SPY'], direction: 'buy', allocatedAmount: 5000, maxOrderNotional: 1000 }, rules: [{ type: 'price_threshold', config: { operator: 'above', price: 50 } }], linkBotId: 'bot_a', range: '1Y' })
    await processNextBacktest({ engine })
    const r = await request(app.server).get('/api/bots/compare').set(as(tokenA))
    expect(r.status).toBe(200)
    const row = r.body.data.find((x) => x.id === 'bot_a')
    expect(row).toMatchObject({ name: 'Momentum', allocation: 5000, paper: { closedTrades: 0 }, backtest: { executionModel: 'next_open', range: { end: '2026-11-23' } } })
    expect(typeof row.backtest.returnPct).toBe('number')
    expect((await request(app.server).get('/api/bots/compare').set(as(tokenB))).body.data).toEqual([])
  })
})
