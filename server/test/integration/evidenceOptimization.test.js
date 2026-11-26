/**
 * Tests for Stage 3 Evidence Storage Optimization:
 * - Multi-symbol portfolio curve deduplication
 * - Benchmark curve deduplication & hydration
 * - Compaction of superseded historical evidence snapshots
 * - Admin controls for evidence storage and compaction
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
const { generateStrategyEvidence, compactHistoricalEvidence, getPublicStrategy } = await import('../../src/services/strategyEvidenceService.js')
const { getEvidenceStorageMetrics } = await import('../../src/services/adminService.js')

const TEMPLATES = JSON.parse(readFileSync(new URL('../../prisma/seeds/bot-templates.json', import.meta.url), 'utf8'))

const ALL = []
for (let t = Date.UTC(2026, 10, 27); ALL.length < 1400; t -= 86_400_000) {
  const d = new Date(t)
  if (d.getUTCDay() % 6) ALL.unshift(d.toISOString().slice(0, 10))
}
let lastIndex = ALL.indexOf('2026-11-20')
const px = (t, i) => (t === 'NVDA' ? 50 : 300) * (1 + 0.0004 * i + 0.05 * Math.sin(i / 30))

const engine = {
  async getDailyBars(t, start, end) {
    const bars = ALL.slice(0, lastIndex + 1)
      .map((d, i) => [d, px(t, i) * 0.998, px(t, i) * 1.01, px(t, i) * 0.99, px(t, i), 2e6 + (i % 7) * 4e5])
      .filter((b) => b[0] >= start && b[0] <= end)
    return { ticker: t, bars, sha256: `sha-${t}-${lastIndex}` }
  },
  async getRegimeHistory() { return { points: [] } },
}

const config = { tradableSymbols: ['SPY', 'NVDA'] }
const NOW = Date.parse('2026-11-24T12:00:00Z')

let app, regularToken, adminToken

beforeAll(async () => {
  h.db = createMemoryPrisma()
  app = await createApp()
  await registerRoutes(app)
  await app.ready()

  regularToken = app.jwt.sign({ sub: 'usr_reg' })
  adminToken = app.jwt.sign({ sub: 'usr_adm' })
})

afterAll(async () => {
  await app.close()
})

beforeEach(async () => {
  h.db.reset()
  lastIndex = ALL.indexOf('2026-11-20')

  for (const t of TEMPLATES) {
    await h.db.botTemplate.create({ data: t })
  }

  await h.db.user.create({
    data: { id: 'usr_reg', email: 'reg@test.com', role: 'user', subscription: { status: 'ACTIVE' } }
  })
  await h.db.user.create({
    data: { id: 'usr_adm', email: 'admin@test.com', role: 'admin', subscription: { status: 'ACTIVE' } }
  })
})

describe('Evidence Storage Optimization & Compaction', () => {
  it('deduplicates multi-symbol forward curves and hydrates on public read', async () => {
    // Set up a canonical AI bot with forward performance curve
    await h.db.bot.create({
      data: {
        id: 'bot_canonical_ai_catalyst_momentum',
        name: 'AI Catalyst Canonical Bot',
        templateId: 'tmpl_ai_catalyst_momentum',
        userId: 'usr_platform_canonical',
        enabled: true,
        config: { signalSource: 'ai_catalyst_momentum', allocatedAmount: 10000 }
      }
    })

    // Mock computeAiBotForwardEquity to return 10 curve points
    const sampleCurve = [
      { date: '2026-11-15', equity: 10000 },
      { date: '2026-11-16', equity: 10200 },
      { date: '2026-11-17', equity: 10150 },
      { date: '2026-11-18', equity: 10300 },
      { date: '2026-11-19', equity: 10450 }
    ]
    const sampleBh = [
      { date: '2026-11-15', equity: 10000 },
      { date: '2026-11-19', equity: 10100 }
    ]

    vi.doMock('../../src/services/ai/aiBotService.js', () => ({
      computeAiBotForwardEquity: vi.fn().mockResolvedValue({
        status: 'ok',
        startingCapital: 10000,
        returnPct: 4.5,
        maxDrawdownPct: 1.2,
        winRate: 0.75,
        trades: 4,
        curve: sampleCurve,
        buyAndHold: { returnPct: 1.0, curve: sampleBh }
      })
    }))

    await generateStrategyEvidence({ engine, config, now: NOW })

    const rows = await h.db.strategyEvidence.findMany({
      where: { templateId: 'tmpl_ai_catalyst_momentum', window: 'forward' }
    })

    // Symbols are ['SPY', 'NVDA']
    const spyRow = rows.find((r) => r.symbol === 'SPY')
    const nvdaRow = rows.find((r) => r.symbol === 'NVDA')

    expect(spyRow).toBeDefined()
    expect(nvdaRow).toBeDefined()

    // Primary symbol (SPY) retains the stored curve
    expect(spyRow.results.curve).toBeDefined()
    expect(spyRow.results.curveSharedWith).toBeNull()

    // Secondary symbol (NVDA) deduplicates: curve is null, curveSharedWith points to SPY
    expect(nvdaRow.results.curve).toBeNull()
    expect(nvdaRow.results.curveSharedWith).toBe('SPY')

    // On public strategy read, NVDA's curve is hydrated from SPY transparently
    const publicStrat = await getPublicStrategy('tmpl_ai_catalyst_momentum', { prismaClient: h.db })
    const hydratedNvda = publicStrat.results.find((r) => r.symbol === 'NVDA' && r.window === 'forward')

    expect(hydratedNvda.results.curve).toEqual(spyRow.results.curve)
    expect(hydratedNvda.results.buyAndHold.curve).toEqual(spyRow.results.buyAndHold.curve)
    expect(hydratedNvda.results.metrics.returnPct).toBe(4.5)
  })

  it('compacts older superseded sessions while strictly preserving all scalar audit facts', async () => {
    // Generate session 1: 2026-11-20
    await generateStrategyEvidence({ engine, config, now: NOW })
    const session1Rows = await h.db.strategyEvidence.findMany({ where: { endDate: '2026-11-20' } })
    expect(session1Rows.length).toBeGreaterThan(0)

    // Advance calendar by 2 sessions and generate session 2: 2026-11-25
    lastIndex += 2
    await generateStrategyEvidence({ engine, config, now: Date.parse('2026-11-25T23:00:00Z') })

    const session2Rows = await h.db.strategyEvidence.findMany({ where: { endDate: ALL[lastIndex] } })
    expect(session2Rows.length).toBeGreaterThan(0)

    // Run compaction of historical sessions
    const compactionResult = await compactHistoricalEvidence({ prismaClient: h.db })
    expect(compactionResult.compactedRows).toBeGreaterThan(0)

    // Inspect compacted historical rows (session 1)
    const compactedRows = await h.db.strategyEvidence.findMany({ where: { endDate: '2026-11-20' } })
    for (const row of compactedRows) {
      if (row.status === 'ok') {
        // Scalar audit facts are preserved
        expect(row.results.compacted).toBe(true)
        expect(typeof row.results.capital).toBe('number')
        expect(typeof row.results.metrics.returnPct).toBe('number')
        expect(typeof row.results.buyAndHold.returnPct).toBe('number')
        expect(row.dataFingerprint).toBeDefined()
        expect(row.riskPolicyVersion).toBeDefined()

        // Bulky time-series curves and raw trades are pruned from older superseded session
        expect(row.results.curve).toBeUndefined()
        expect(row.results.trades).toBeUndefined()
      }
    }

    // Inspect active newest session (session 2): remains uncompacted for chart visualization
    const activeRows = await h.db.strategyEvidence.findMany({ where: { endDate: ALL[lastIndex] } })
    const okActive = activeRows.find((r) => r.status === 'ok' && r.results?.curve)
    expect(okActive).toBeDefined()
    expect(okActive.results.compacted).toBeUndefined()
  })

  it('admin storage controls: exposes storage metrics and triggers compaction via API', async () => {
    // Generate evidence for session 1
    await generateStrategyEvidence({ engine, config, now: NOW })

    // Advance and generate session 2
    lastIndex += 2
    await generateStrategyEvidence({ engine, config, now: Date.parse('2026-11-25T23:00:00Z') })

    // GET /api/admin/controls/evidence-storage requires admin auth
    const unauth = await request(app.server).get('/api/admin/controls/evidence-storage')
    expect(unauth.status).toBe(401)

    const userForbidden = await request(app.server)
      .get('/api/admin/controls/evidence-storage')
      .set('Authorization', `Bearer ${regularToken}`)
    expect(userForbidden.status).toBe(403)

    const storageMetrics = await request(app.server)
      .get('/api/admin/controls/evidence-storage')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(storageMetrics.status).toBe(200)
    expect(storageMetrics.body.success).toBe(true)
    expect(storageMetrics.body.data).toMatchObject({
      distinctSessions: 2,
      compactedRows: 0
    })
    expect(storageMetrics.body.data.totalRows).toBeGreaterThan(0)

    // POST /api/admin/controls/compact-evidence
    const compactRes = await request(app.server)
      .post('/api/admin/controls/compact-evidence')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(compactRes.status).toBe(200)
    expect(compactRes.body.success).toBe(true)
    expect(compactRes.body.data.compactedRows).toBeGreaterThan(0)

    // Verify updated storage metrics reflects compacted rows
    const updatedMetrics = await request(app.server)
      .get('/api/admin/controls/evidence-storage')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(updatedMetrics.body.data.compactedRows).toBe(compactRes.body.data.compactedRows)
  })
})
