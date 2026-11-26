/**
 * Integration tests for /api/admin/research/pipeline-diagnostics
 * Signed research publication pipeline health, verification gates, and trading safeguards.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))

// Mock engineClient for research pipeline
const mockEngine = {
  getHealth: vi.fn().mockResolvedValue({ status: 'ok', live_bars: { AAPL: '2026-11-25' } }),
  locateResearchPrediction: vi.fn(),
  getPredictionTrace: vi.fn().mockResolvedValue({
    evidence: {
      snapshot: { direction: 'BUY', confidence: 0.478, rankScore: 0.478 }
    }
  }),
  getResearchPublication: vi.fn().mockResolvedValue({
    publication_id: 'pub_test_123',
    market_date: '2026-11-25',
    publisher_key_id: 'key_ae_pub_01',
    worker_id: 'ae-worker-staging',
    schema_version: 'research-publication/v1',
    gates: [
      { gate: 'schema', status: 'pass' },
      { gate: 'universe', status: 'pass' },
      { gate: 'provenance', status: 'pass' },
      { gate: 'freshness', status: 'pass' },
      { gate: 'reproduction', status: 'pass' },
      { gate: 'market_data', status: 'pass' },
      { gate: 'holdout_sufficient', status: 'pass' },
      { gate: 'edge_over_baseline', status: 'fail' }
    ]
  })
}

vi.mock('../../src/clients/engine.js', () => ({
  engineClient: mockEngine
}))

const { default: createApp } = await import('../../src/loaders/fastify.js')
const { default: registerRoutes } = await import('../../src/loaders/routes.js')

let app, regularToken, operatorToken, adminToken

beforeAll(async () => {
  h.db = createMemoryPrisma()
  app = await createApp()
  await registerRoutes(app)
  await app.ready()

  regularToken = app.jwt.sign({ sub: 'usr_reg' })
  operatorToken = app.jwt.sign({ sub: 'usr_op' })
  adminToken = app.jwt.sign({ sub: 'usr_adm' })
})

afterAll(async () => {
  await app.close()
})

beforeEach(async () => {
  h.db.reset()
  vi.clearAllMocks()

  await h.db.user.create({
    data: { id: 'usr_reg', email: 'reg@test.com', role: 'user', subscription: { status: 'ACTIVE' } }
  })
  await h.db.user.create({
    data: { id: 'usr_op', email: 'op@test.com', role: 'operator', subscription: { status: 'ACTIVE' } }
  })
  await h.db.user.create({
    data: { id: 'usr_adm', email: 'admin@test.com', role: 'admin', subscription: { status: 'ACTIVE' } }
  })

  // Setup default mock response: published model with no edge
  mockEngine.locateResearchPrediction.mockImplementation(async (symbol) => ({
    publicationId: 'pub_test_123',
    predictionId: `pred_${symbol}_20261125`,
    marketDate: '2026-11-25',
    rankedAt: '2026-11-25T22:00:00Z',
    run: {
      runStatus: 'HEALTHY',
      intelligenceConfidenceTier: 'full'
    },
    researchQuality: {
      model: 'trend_momentum_v1',
      verdict: 'no_demonstrated_edge'
    },
    quality: {
      edgeOverBaseline: false,
      genuineOutOfSample: true
    }
  }))
})

describe('GET /api/admin/research/pipeline-diagnostics', () => {
  it('enforces RBAC — rejects unauthenticated and non-admin requests', async () => {
    const unauth = await request(app.server).get('/api/admin/research/pipeline-diagnostics')
    expect(unauth.status).toBe(401)

    const user = await request(app.server)
      .get('/api/admin/research/pipeline-diagnostics')
      .set('Authorization', `Bearer ${regularToken}`)
    expect(user.status).toBe(403)

    // Operators have monitoring/read access under requireAdmin
    const operator = await request(app.server)
      .get('/api/admin/research/pipeline-diagnostics')
      .set('Authorization', `Bearer ${operatorToken}`)
    expect(operator.status).toBe(200)
  })

  it('returns publication diagnostics and verifies publication metadata & verification gates', async () => {
    const res = await request(app.server)
      .get('/api/admin/research/pipeline-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const data = res.body.data
    expect(data.status).toBe('healthy')
    expect(data.publication).toMatchObject({
      id: 'pub_test_123',
      marketDate: '2026-11-25',
      model: 'trend_momentum_v1',
      runStatus: 'HEALTHY',
      publisherKeyId: 'key_ae_pub_01',
      workerId: 'ae-worker-staging',
      schemaVersion: 'research-publication/v1'
    })

    expect(data.gates).toHaveLength(8)
    expect(data.failedGates).toContain('edge_over_baseline')
    expect(data.symbols).toHaveLength(10)
  })

  it('upholds requireOutOfSample safeguard: explains PROTECTED_NO_EDGE when edgeOverBaseline is false', async () => {
    const res = await request(app.server)
      .get('/api/admin/research/pipeline-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const summary = res.body.data.summary
    expect(summary.pipelineActive).toBe(true)
    expect(summary.operationalStatus).toBe('HEALTHY')
    expect(summary.tradingEligibleCount).toBe(0)
    expect(summary.tradingEligibilityVerdict).toBe('PROTECTED_NO_EDGE')
    expect(summary.explanation).toContain('statistically significant edge')
  })

  it('marks trading eligible only when edgeOverBaseline, genuineOutOfSample, and full confidence tier are true', async () => {
    mockEngine.locateResearchPrediction.mockImplementation(async (symbol) => ({
      publicationId: 'pub_proven_456',
      predictionId: `pred_${symbol}_20261125`,
      marketDate: '2026-11-25',
      rankedAt: '2026-11-25T22:00:00Z',
      run: {
        runStatus: 'HEALTHY',
        intelligenceConfidenceTier: 'full'
      },
      researchQuality: {
        model: 'alpha_statistical_v2',
        verdict: 'verified_edge'
      },
      quality: {
        edgeOverBaseline: true,
        genuineOutOfSample: true
      }
    }))

    mockEngine.getResearchPublication.mockResolvedValueOnce({
      publication_id: 'pub_proven_456',
      market_date: '2026-11-25',
      publisher_key_id: 'key_ae_pub_01',
      worker_id: 'ae-worker-staging',
      schema_version: 'research-publication/v1',
      gates: [
        { gate: 'schema', status: 'pass' },
        { gate: 'edge_over_baseline', status: 'pass' }
      ]
    })

    const res = await request(app.server)
      .get('/api/admin/research/pipeline-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.summary.tradingEligibleCount).toBe(10)
    expect(data.summary.tradingEligibilityVerdict).toBe('ELIGIBLE')
    expect(data.symbols[0].eligibleForTrading).toBe(true)
  })

  it('handles dormant pipeline when no research publications exist', async () => {
    mockEngine.locateResearchPrediction.mockResolvedValue(null)
    mockEngine.getResearchPublication.mockResolvedValue(null)

    const res = await request(app.server)
      .get('/api/admin/research/pipeline-diagnostics')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const data = res.body.data
    expect(data.status).toBe('dormant')
    expect(data.publication).toBeNull()
    expect(data.summary.pipelineActive).toBe(false)
    expect(data.summary.tradingEligibilityVerdict).toBe('PROTECTED_NO_EDGE')
    expect(data.summary.explanation).toContain('No research publications have been accepted')
  })
})
