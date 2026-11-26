/**
 * Integration tests for /api/admin/ai/* Explainability & Research Inspector routes.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))

const { default: createApp } = await import('../../src/loaders/fastify.js')
const { default: registerRoutes } = await import('../../src/loaders/routes.js')

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

  await h.db.user.create({
    data: { id: 'usr_reg', email: 'reg@test.com', role: 'user', subscription: { status: 'ACTIVE' } }
  })
  await h.db.user.create({
    data: { id: 'usr_adm', email: 'admin@test.com', role: 'admin', subscription: { status: 'ACTIVE' } }
  })

  // Seed AI Bot
  await h.db.bot.create({
    data: {
      id: 'bot_ai_1',
      userId: 'usr_adm',
      portfolioId: 'port_1',
      name: 'Autonomous AI Alpha Bot',
      templateId: 'tmpl_ai_catalyst_momentum',
      botType: 'ai_strategy',
      enabled: true,
      config: {}
    }
  })

  // Seed AI Research Cycle Event
  await h.db.botEvent.create({
    data: {
      id: 'evt_cycle_1',
      botId: 'bot_ai_1',
      portfolioId: 'port_1',
      type: 'decision_made',
      detail: 'AI Research Cycle (2026-11-25): Bullish regime detected across market',
      metadata: {
        strategy: 'catalyst_momentum_v1',
        asOfSession: '2026-11-25',
        intendedExecutionSession: '2026-11-26',
        decisionTimestamp: '2026-11-25T21:00:00.000Z',
        isReplay: false,
        cached: false,
        model: 'gpt-4o-mini-2024-07-18',
        provider: 'openai',
        usage: { prompt_tokens: 1500, completion_tokens: 450, total_tokens: 1950 },
        estimatedCostUsd: 0.00048,
        marketSummary: 'Risk-on regime with tech leadership',
        selectedDecisions: [
          { symbol: 'AAPL', action: 'BUY', targetAllocationPct: 0.1, confidence: 0.88 }
        ],
        symbolEvaluations: [
          {
            symbol: 'AAPL',
            action: 'BUY',
            confidence: 0.88,
            exitRule: { stopLossPct: 4.0, takeProfitPct: 8.0, timeStopDays: 5 },
            evidence: { trend: 'bullish', volumeMultiple: 1.5, catalyst: 'Strong earnings revision' },
            thesis: 'Strong institutional accumulation above 20-day moving average.'
          },
          {
            symbol: 'MSFT',
            action: 'HOLD',
            confidence: 0.52,
            exitRule: {},
            evidence: { trend: 'neutral' },
            thesis: 'Consolidating near 50-day average; awaiting breakout.'
          }
        ],
        portfolioAtDecision: { cash: 10000, totalEquity: 10000 }
      }
    }
  })
})

describe('GET /api/admin/ai/cycles', () => {
  it('blocks unauthenticated requests with 401', async () => {
    const res = await request(app.server).get('/api/admin/ai/cycles')
    expect(res.status).toBe(401)
  })

  it('blocks regular non-admin users with 403', async () => {
    const res = await request(app.server)
      .get('/api/admin/ai/cycles')
      .set('Authorization', `Bearer ${regularToken}`)
    expect(res.status).toBe(403)
  })

  it('returns list of AI research cycles with metrics to admin', async () => {
    const res = await request(app.server)
      .get('/api/admin/ai/cycles')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.cycles).toHaveLength(1)

    const cycle = res.body.data.cycles[0]
    expect(cycle.id).toBe('evt_cycle_1')
    expect(cycle.session).toBe('2026-11-25')
    expect(cycle.model).toBe('gpt-4o-mini-2024-07-18')
    expect(cycle.actionableCount).toBe(1)
    expect(cycle.totalEvaluated).toBe(2)
    expect(cycle.decisionCounts).toEqual({ buy: 1, hold: 1, sell: 0 })
    expect(cycle.isReplay).toBe(false)

    expect(res.body.data.metrics.totalCycles).toBe(1)
    expect(res.body.data.metrics.totalTokens).toBe(1950)
  })

  it('filters cycles by session parameter', async () => {
    const resMatch = await request(app.server)
      .get('/api/admin/ai/cycles?session=2026-11-25')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(resMatch.body.data.cycles).toHaveLength(1)

    const resNone = await request(app.server)
      .get('/api/admin/ai/cycles?session=2020-01-01')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(resNone.body.data.cycles).toHaveLength(0)
  })
})

describe('GET /api/admin/ai/cycles/:id', () => {
  it('returns 404 for unknown cycle ID', async () => {
    const res = await request(app.server)
      .get('/api/admin/ai/cycles/unknown_cycle_id')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('returns complete explainability details for existing cycle', async () => {
    const res = await request(app.server)
      .get('/api/admin/ai/cycles/evt_cycle_1')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const detail = res.body.data
    expect(detail.id).toBe('evt_cycle_1')
    expect(detail.marketSummary).toBe('Risk-on regime with tech leadership')
    expect(detail.symbolEvaluations).toHaveLength(2)

    const aapl = detail.symbolEvaluations.find(s => s.symbol === 'AAPL')
    expect(aapl.action).toBe('BUY')
    expect(aapl.confidence).toBe(0.88)
    expect(aapl.thesis).toContain('Strong institutional accumulation')
    expect(aapl.exitRule.stopLossPct).toBe(4.0)
    expect(aapl.evidence.trend).toBe('bullish')
  })
})

describe('GET /api/admin/ai/decisions', () => {
  it('returns all symbol decisions across cycles', async () => {
    const res = await request(app.server)
      .get('/api/admin/ai/decisions')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.decisions).toHaveLength(2)
  })

  it('filters symbol decisions by ticker and action', async () => {
    const resAapl = await request(app.server)
      .get('/api/admin/ai/decisions?symbol=AAPL&action=BUY')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(resAapl.status).toBe(200)
    expect(resAapl.body.data.decisions).toHaveLength(1)
    expect(resAapl.body.data.decisions[0].symbol).toBe('AAPL')
    expect(resAapl.body.data.decisions[0].action).toBe('BUY')

    const resHold = await request(app.server)
      .get('/api/admin/ai/decisions?action=HOLD')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(resHold.status).toBe(200)
    expect(resHold.body.data.decisions).toHaveLength(1)
    expect(resHold.body.data.decisions[0].symbol).toBe('MSFT')
  })
})
