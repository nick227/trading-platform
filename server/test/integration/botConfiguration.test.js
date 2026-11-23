/**
 * Unified bot save: POST /api/bots/configuration and PUT /api/bots/:id/configuration.
 * One transaction for bot + rules; config is a deep-merge patch; rules keep their identity.
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
const { activateEmergencyStop } = await import('../../src/services/emergencyStopService.js')

let app, tokenA, tokenB
const as = (t) => ({ Authorization: `Bearer ${t}` })
const post = (body, t = tokenA) => request(app.server).post('/api/bots/configuration').set(as(t)).send(body)
const put = (id, body, t = tokenA) => request(app.server).put(`/api/bots/${id}/configuration`).set(as(t)).send(body)
const rulesOf = (botId) => h.db.botRule.findMany({ where: { botId }, orderBy: { createdAt: 'asc' } })
const botOf = (id) => h.db.bot.findUnique({ where: { id } })

// An existing research bot with settings the builder never shows.
const HIDDEN = { riskLimits: { maxDailyLoss: 250 }, positionSizing: { mode: 'fixed' }, timezone: 'America/New_York', riskOnExposure: 0.8 }
const RESEARCH = { minConfidence: 0.45, maxPredictionAgeHours: 96, maxEntryDriftPct: 5, requireEdgeOverBaseline: true, allowedHorizons: ['5d'] }

beforeAll(async () => {
  h.db = createMemoryPrisma()
  app = await createApp()
  await registerRoutes(app)
  await app.ready()
  tokenA = app.jwt.sign({ sub: 'usr_a' })
  tokenB = app.jwt.sign({ sub: 'usr_b' })
})
afterAll(async () => { await app.close() })

beforeEach(async () => {
  h.db.reset()
  for (const id of ['usr_a', 'usr_b']) {
    await h.db.user.create({ data: { id, email: `${id}@example.test`, riskSettings: null, subscription: { status: 'ACTIVE' } } })
    await h.db.portfolio.create({ data: { id: `por_${id}`, userId: id } })
  }
  await h.db.botTemplate.create({ data: {
    id: 'tmpl_momentum_buy', name: 'Momentum Buy', description: '', botType: 'rule_based',
    config: { tickers: ['SPY'], direction: 'buy', allocatedAmount: 5000, maxOrderNotional: 1000, capitalMode: 'allocated', riskOnExposure: 1 },
    rules: [{ name: 'Price trigger', type: 'price_threshold', config: { operator: 'above' } }, { name: 'Cooldown', type: 'cooldown', config: { windowMs: 3_600_000 } }]
  } })
  await h.db.bot.create({ data: { id: 'bot_r', userId: 'usr_a', portfolioId: 'por_usr_a', name: 'Research', enabled: false,
    config: { tickers: ['AAPL', 'MSFT'], direction: 'buy', allocatedAmount: 10_000, maxOrderNotional: 2000, capitalMode: 'allocated', signalSource: 'alpha_research', research: RESEARCH, ...HIDDEN } } })
  await h.db.botRule.create({ data: { id: 'rule_hours', botId: 'bot_r', name: 'Market hours', type: 'market_hours', config: { allowPremarket: false }, enabled: true, createdAt: new Date(Date.now() - 2000) } })
  await h.db.botRule.create({ data: { id: 'rule_cool', botId: 'bot_r', name: 'Cooldown', type: 'cooldown', config: { windowMs: 3_600_000 }, enabled: true, createdAt: new Date(Date.now() - 1000) } })
})

describe('create', () => {
  it('creates a bot and its rules in one call', async () => {
    const res = await post({ portfolioId: 'por_usr_a', name: 'MSFT breakout', enabled: true,
      config: { tickers: ['msft'], direction: 'buy', allocatedAmount: 5000, maxOrderNotional: 1000 },
      rules: [{ type: 'price_threshold', config: { price: 410, operator: 'above' } }, { type: 'cooldown', config: { windowMs: 3_600_000 } }] })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ name: 'MSFT breakout', enabled: true, config: { tickers: ['MSFT'], capitalMode: 'allocated' } })
    expect(res.body.data.rules.map((r) => [r.type, r.name])).toEqual([['price_threshold', 'Price trigger'], ['cooldown', 'Cooldown']])
    expect(res.body.changes).toMatchObject({ rulesCreated: 2 })
    expect(await rulesOf(res.body.data.id)).toHaveLength(2)
  })

  it('a starting point initializes the same save: template config + rules, overridden by the caller', async () => {
    const res = await post({ portfolioId: 'por_usr_a', templateId: 'tmpl_momentum_buy', config: { tickers: ['QQQ'], allocatedAmount: 3000 },
      rules: [{ type: 'price_threshold', config: { price: 500, operator: 'above' } }, { type: 'cooldown', config: { windowMs: 3_600_000 } }] })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ name: 'Momentum Buy', templateId: 'tmpl_momentum_buy', enabled: false,
      config: { tickers: ['QQQ'], direction: 'buy', allocatedAmount: 3000, maxOrderNotional: 1000, riskOnExposure: 1 } })
  })

  it('template rules are validated too: an unset trigger price is rejected, nothing is created', async () => {
    const res = await post({ portfolioId: 'por_usr_a', templateId: 'tmpl_momentum_buy' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({ code: 'INVALID_RULE', ruleIndex: 0, type: 'price_threshold', message: 'Trigger price must be greater than 0.' })
    expect(await h.db.bot.count({ where: { userId: 'usr_a' } })).toBe(1)
  })

  it('rejects another user’s portfolio, an unknown starting point, and invalid config', async () => {
    expect((await post({ portfolioId: 'por_usr_b', name: 'x', config: { tickers: ['SPY'] } })).body.error.code).toBe('INVALID_PORTFOLIO')
    expect((await post({ portfolioId: 'por_usr_a', templateId: 'nope' })).status).toBe(404)
    const bad = await post({ portfolioId: 'por_usr_a', name: 'x', config: { tickers: [] } })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatchObject({ code: 'INVALID_CONFIG', field: 'tickers' })
    const research = await post({ portfolioId: 'por_usr_a', name: 'x', config: { tickers: ['SPY'], signalSource: 'alpha_research', research: { minConfidence: 2 } } })
    expect(research.body.error).toMatchObject({ code: 'INVALID_CONFIG', field: 'research' })
  })
})

describe('update', () => {
  it('a config patch keeps every key it doesn’t mention, including hidden settings and the research policy', async () => {
    const res = await put('bot_r', { config: { allocatedAmount: 12_000, research: { minConfidence: 0.6 } } })
    expect(res.status).toBe(200)
    const { config } = await botOf('bot_r')
    expect(config).toEqual({ tickers: ['AAPL', 'MSFT'], direction: 'buy', allocatedAmount: 12_000, maxOrderNotional: 2000, capitalMode: 'allocated',
      signalSource: 'alpha_research', research: { ...RESEARCH, minConfidence: 0.6 }, ...HIDDEN })
  })

  it('null removes a key; arrays replace', async () => {
    await put('bot_r', { config: { timezone: null, tickers: ['NVDA'] } })
    const { config } = await botOf('bot_r')
    expect(config.timezone).toBeUndefined()
    expect(config.tickers).toEqual(['NVDA'])
    expect(config.riskLimits).toEqual(HIDDEN.riskLimits)
  })

  it('rules keep their ids; unchanged rules are not rewritten; omitted rules are deleted; new rules are added', async () => {
    const before = await rulesOf('bot_r')
    const coolUpdatedAt = before.find((r) => r.id === 'rule_cool').updatedAt
    await new Promise((r) => setTimeout(r, 5))
    const res = await put('bot_r', { rules: [
      { id: 'rule_cool', type: 'cooldown', config: { windowMs: 3_600_000 } },      // unchanged
      { type: 'daily_loss', config: { maxLoss: 300 } },                           // new
    ] })                                                                          // rule_hours omitted → deleted
    expect(res.status).toBe(200)
    expect(res.body.changes).toEqual({ rulesCreated: 1, rulesUpdated: 0, rulesDeleted: 1, rulesUnchanged: 1 })
    const after = await rulesOf('bot_r')
    expect(after.map((r) => r.id)).toContain('rule_cool')
    expect(after.find((r) => r.id === 'rule_cool').updatedAt).toEqual(coolUpdatedAt)
    expect(after.map((r) => r.type).sort()).toEqual(['cooldown', 'daily_loss'])

    const edit = await put('bot_r', { rules: after.map((r) => (r.type === 'cooldown' ? { id: r.id, config: { minutes: 30 } } : { id: r.id })) })
    expect(edit.body.changes).toMatchObject({ rulesUpdated: 1, rulesUnchanged: 1, rulesCreated: 0, rulesDeleted: 0 })
    expect((await h.db.botRule.findUnique({ where: { id: 'rule_cool' } })).config).toEqual({ minutes: 30 })
  })

  it('omitting rules leaves them untouched; pausing/resuming writes the lifecycle event', async () => {
    await put('bot_r', { name: 'Renamed', enabled: true })
    expect((await rulesOf('bot_r')).map((r) => r.id)).toEqual(['rule_hours', 'rule_cool'])
    expect((await botOf('bot_r')).name).toBe('Renamed')
    expect((await h.db.botEvent.findMany({ where: { botId: 'bot_r' } })).map((e) => e.type)).toEqual(['bot_resumed'])
  })

  it('validation failure writes nothing (valid config + one invalid rule)', async () => {
    const res = await put('bot_r', { name: 'Should not stick', config: { allocatedAmount: 1 }, rules: [{ id: 'rule_hours' }, { type: 'time_window', config: { start: '15:00', end: '10:00' } }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({ code: 'INVALID_RULE', ruleIndex: 1, type: 'time_window' })
    expect(await botOf('bot_r')).toMatchObject({ name: 'Research', config: { allocatedAmount: 10_000 } })
    expect((await rulesOf('bot_r')).map((r) => r.id)).toEqual(['rule_hours', 'rule_cool'])
  })

  it('rolls back everything if a write fails mid-transaction', async () => {
    const original = h.db.botRule.create
    h.db.botRule.create = async () => { throw new Error('disk full') }
    try {
      const res = await put('bot_r', { name: 'Half saved?', config: { allocatedAmount: 20_000 }, rules: [{ id: 'rule_cool', config: { windowMs: 60_000 } }, { type: 'daily_loss', config: { maxLoss: 100 } }] })
      expect(res.status).toBe(500)
    } finally { h.db.botRule.create = original }
    expect(await botOf('bot_r')).toMatchObject({ name: 'Research', config: { allocatedAmount: 10_000 } })
    const rules = await rulesOf('bot_r')
    expect(rules.map((r) => r.id)).toEqual(['rule_hours', 'rule_cool'])
    expect(rules.find((r) => r.id === 'rule_cool').config).toEqual({ windowMs: 3_600_000 })
  })

  it('rejects rule ids from another bot, type changes, and stale edits', async () => {
    await h.db.bot.create({ data: { id: 'bot_o', userId: 'usr_a', portfolioId: 'por_usr_a', name: 'Other', enabled: false, config: { tickers: ['SPY'] } } })
    await h.db.botRule.create({ data: { id: 'rule_other', botId: 'bot_o', name: 'Cooldown', type: 'cooldown', config: { windowMs: 1000 }, enabled: true } })
    expect((await put('bot_r', { rules: [{ id: 'rule_other' }] })).body.error).toMatchObject({ code: 'INVALID_RULE', ruleId: 'rule_other' })
    expect((await put('bot_r', { rules: [{ id: 'rule_cool', type: 'daily_loss' }] })).status).toBe(400)
    expect((await put('bot_r', { rules: [{ id: 'rule_cool', name: 'x'.repeat(101) }] })).body.error).toMatchObject({ code: 'INVALID_RULE', ruleIndex: 0 })
    expect((await put('bot_r', { name: '' })).body.error).toMatchObject({ code: 'INVALID_CONFIG', field: 'name' })
    const stale = await put('bot_r', { name: 'x', expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('STALE_BOT')
    const fresh = await put('bot_r', { name: 'y', expectedUpdatedAt: new Date((await botOf('bot_r')).updatedAt).toISOString() })
    expect(fresh.status).toBe(200)
  })
})

describe('ownership and the emergency stop', () => {
  it('another user can’t read-modify a bot (404) and nothing changes', async () => {
    const res = await put('bot_r', { name: 'hijack', config: { tickers: ['GME'] } }, tokenB)
    expect(res.status).toBe(404)
    expect(await botOf('bot_r')).toMatchObject({ name: 'Research', config: { tickers: ['AAPL', 'MSFT'] } })
    expect((await put('bot_r', { portfolioId: 'por_usr_b' })).body.error).toMatchObject({ code: 'INVALID_CONFIG', field: 'portfolioId' })
  })

  it('while the stop is on: enabling is refused (create and update); saving paused still works', async () => {
    await activateEmergencyStop('usr_a', { reason: 'test' })
    const create = await post({ portfolioId: 'por_usr_a', name: 'x', enabled: true, config: { tickers: ['SPY'] } })
    expect(create.status).toBe(403)
    expect(create.body.error.code).toBe('EMERGENCY_STOP_ACTIVE')
    expect((await put('bot_r', { enabled: true })).status).toBe(403)
    expect((await botOf('bot_r')).enabled).toBe(false)
    expect((await put('bot_r', { config: { maxOrderNotional: 1500 } })).status).toBe(200)
    expect((await post({ portfolioId: 'por_usr_a', name: 'paused', config: { tickers: ['SPY'] } })).status).toBe(201)
  })
})
