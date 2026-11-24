/**
 * Public Strategy Evidence: platform-generated, standardized, versioned, public.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import request from 'supertest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../../worker/src/db/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))

const { default: createApp } = await import('../../src/loaders/fastify.js')
const { default: registerRoutes } = await import('../../src/loaders/routes.js')
const { generateStrategyEvidence, canonicalStrategy } = await import('../../src/services/strategyEvidenceService.js')
const TEMPLATES = JSON.parse(readFileSync(new URL('../../prisma/seeds/bot-templates.json', import.meta.url), 'utf8'))

// Weekday sessions; the last one moves forward to simulate a new completed session.
const ALL = []
for (let t = Date.UTC(2026, 10, 27); ALL.length < 1400; t -= 86_400_000) { const d = new Date(t); if (d.getUTCDay() % 6) ALL.unshift(d.toISOString().slice(0, 10)) }
let lastIndex = ALL.indexOf('2026-11-20')
const px = (t, i) => (t === 'NVDA' ? 50 : 300) * (1 + 0.0004 * i + 0.05 * Math.sin(i / 30))
const engine = {
  async getDailyBars(t, start, end) {
    const bars = ALL.slice(0, lastIndex + 1).map((d, i) => [d, px(t, i) * 0.998, px(t, i) * 1.01, px(t, i) * 0.99, px(t, i), 2e6 + (i % 7) * 4e5]).filter((b) => b[0] >= start && b[0] <= end)
    return { ticker: t, bars, sha256: `sha-${t}-${lastIndex}` }
  },
  async getRegimeHistory() { return { points: [] } },
}
const config = { tradableSymbols: ['SPY', 'NVDA'] }
const NOW = Date.parse('2026-11-24T12:00:00Z')

let app
beforeAll(async () => {
  h.db = createMemoryPrisma()
  app = await createApp(); await registerRoutes(app); await app.ready()
})
afterAll(() => app.close())
beforeEach(async () => {
  h.db.reset(); lastIndex = ALL.indexOf('2026-11-20')
  for (const t of TEMPLATES) await h.db.botTemplate.create({ data: { ...t } })
})

describe('platform strategy evidence', () => {
  it('publishes every strategy on every symbol and window, including untradeable ones', async () => {
    const out = await generateStrategyEvidence({ engine, config, now: NOW })
    const designed = TEMPLATES.filter((t) => ['tmpl_spy_trend_filter', 'tmpl_momentum_sell', 'tmpl_dca_accumulator', 'tmpl_loss_guard'].includes(t.id)).length
    expect(out).toMatchObject({ end: '2026-11-20', created: (TEMPLATES.length * 3 + designed * 2) * 2 })
    const rows = await h.db.strategyEvidence.findMany({})
    const of = (id, w = '5Y', s = 'SPY') => rows.find((r) => r.templateId === id && r.window === w && r.symbol === s)
    expect(of('tmpl_alpha_research')).toMatchObject({ status: 'not_backtestable', reason: expect.stringMatching(/point-in-time research/) })
    const mb = of('tmpl_momentum_buy')
    expect(mb).toMatchObject({ status: 'ok', executionModel: 'next_open', riskPolicyVersion: expect.stringMatching(/^normal-/), dataFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(mb.parameters).toMatchObject({ triggerPrice: expect.any(Number), triggerFrom: expect.any(String) })
    expect(mb.parameters.triggerFrom < mb.startDate).toBe(true) // standardized from data known before the window
    expect(mb.results.capital).toBe(10_000)
    // Redesigned versions: development (fixed, ends 2025-11-21) and holdout (after it) windows.
    expect(of('tmpl_loss_guard', 'development')).toMatchObject({ status: 'ok', startDate: '2021-11-21' })
    expect(of('tmpl_loss_guard', 'development').results.range.lastSession <= '2025-11-21').toBe(true)
    expect(of('tmpl_loss_guard', 'holdout')).toMatchObject({ status: 'ok', startDate: '2025-11-22' })
    expect(of('tmpl_momentum_buy', 'holdout')).toBeUndefined() // unchanged version: no design, no new windows
    // Momentum Exit buys before it sells, and never sells more than it holds.
    for (const sym of ['SPY', 'NVDA']) {
      let held = 0
      for (const t of of('tmpl_momentum_sell', '5Y', sym).results.trades) { held += t.side === 'buy' ? t.quantity : -t.quantity; expect(held).toBeGreaterThanOrEqual(0) }
    }
    expect(of('tmpl_momentum_buy', 'forward')).toMatchObject({ status: 'awaiting_sessions' })
    expect(await h.db.execution.findMany({})).toEqual([])
  })

  it('is idempotent, and a new session adds new snapshots (forward included) without rewriting old ones', async () => {
    await generateStrategyEvidence({ engine, config, now: NOW })
    const before = await h.db.strategyEvidence.findMany({})
    expect((await generateStrategyEvidence({ engine, config, now: NOW })).created).toBe(0)
    lastIndex += 2 // two more completed sessions
    const out = await generateStrategyEvidence({ engine, config, now: Date.parse('2026-11-25T23:00:00Z') })
    expect(out.end).toBe(ALL[lastIndex])
    const fwd = (await h.db.strategyEvidence.findMany({ where: { templateId: 'tmpl_dca_accumulator', window: 'forward', endDate: ALL[lastIndex], symbol: 'SPY' } }))[0]
    expect(fwd).toMatchObject({ status: 'ok', startDate: ALL[lastIndex - 1] })
    const still = await h.db.strategyEvidence.findMany({ where: { endDate: '2026-11-20' } })
    expect(still).toEqual(before)
  })

  it('ties results to a strategy version: a changed template is a new version that inherits nothing', async () => {
    await generateStrategyEvidence({ engine, config, now: NOW })
    const t = TEMPLATES.find((x) => x.id === 'tmpl_dca_accumulator')
    const v1 = canonicalStrategy(t).id
    await h.db.botTemplate.update({ where: { id: t.id }, data: { rules: t.rules.map((r) => (r.type === 'cooldown' ? { ...r, config: { windowMs: 2 * 86_400_000 } } : r)) } })
    const v2 = canonicalStrategy(await h.db.botTemplate.findUnique({ where: { id: t.id } })).id
    expect(v2).not.toBe(v1)
    const res = await request(app.server).get(`/api/public/strategies/${t.id}`)
    expect(res.body.data).toMatchObject({ version: { id: v2, published: false }, results: [] })
    await generateStrategyEvidence({ engine, config, now: NOW })
    const pub = (await request(app.server).get(`/api/public/strategies/${t.id}`)).body.data
    expect(pub.version).toMatchObject({ id: v2, published: true })
    expect(pub.versions.map((x) => x.id).sort()).toEqual([v1, v2].sort())
  })

  it('keeps a replaced version’s evidence published and viewable', async () => {
    // Publish an old definition first (as staging had before the redesign), then the new one.
    const old = { ...TEMPLATES.find((x) => x.id === 'tmpl_dca_accumulator'), rules: [{ type: 'cooldown', config: { windowMs: 86_400_000 } }], config: { direction: 'buy', tickers: ['SPY'], allocatedAmount: 5000, maxOrderNotional: 1000 } }
    await h.db.botTemplate.update({ where: { id: old.id }, data: { rules: old.rules, config: old.config } })
    await generateStrategyEvidence({ engine, config, now: NOW })
    const oldId = canonicalStrategy(await h.db.botTemplate.findUnique({ where: { id: old.id } })).id
    const t = TEMPLATES.find((x) => x.id === old.id)
    await h.db.botTemplate.update({ where: { id: old.id }, data: { rules: t.rules, config: t.config } }) // the seed's redesign
    await generateStrategyEvidence({ engine, config, now: NOW })
    const cur = (await request(app.server).get(`/api/public/strategies/${old.id}`)).body.data
    expect(cur.version).toMatchObject({ current: true })
    expect(cur.version.id).not.toBe(oldId)
    expect(cur.design).toMatchObject({ developmentEnd: '2025-11-21' })
    const prev = (await request(app.server).get(`/api/public/strategies/${old.id}?version=${oldId}`)).body.data
    expect(prev.version).toMatchObject({ id: oldId, current: false })
    expect(prev.results.length).toBeGreaterThanOrEqual(6)
    expect(prev.results.every((r) => r.endDate === '2026-11-20')).toBe(true)
    expect((await request(app.server).get(`/api/public/strategies/${old.id}?version=sv_nope`)).status).toBe(404)
  })

  it('serves the evidence publicly, without an account', async () => {
    await generateStrategyEvidence({ engine, config, now: NOW })
    const list = await request(app.server).get('/api/public/strategies')
    expect(list.status).toBe(200)
    expect(list.headers['cache-control']).toBe('public, max-age=300')
    const mb = list.body.data.find((s) => s.templateId === 'tmpl_momentum_buy')
    expect(mb).toMatchObject({ asOf: '2026-11-20', windows: { '5Y': { symbolsTested: 2, status: 'ok' }, forward: { status: 'awaiting_sessions' } } })
    expect(typeof mb.windows['5Y'].medianReturnPct).toBe('number')
    expect(list.body.data.find((s) => s.templateId === 'tmpl_alpha_research').windows['5Y']).toMatchObject({ status: 'not_backtestable', symbolsTested: 0 })
    const detail = await request(app.server).get('/api/public/strategies/tmpl_momentum_buy')
    expect(detail.body.data).toMatchObject({ definition: { parameters: { triggerPrice: 'close_before_window' } }, assumptions: expect.any(Array) })
    expect(detail.body.data.results).toHaveLength(6)
    expect((await request(app.server).get('/api/public/strategies/nope')).status).toBe(404)
  })
})
