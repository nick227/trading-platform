/**
 * Integration tests for /api/admin/market-data/* Ingestion & Feed Diagnostics routes.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))

// Mock engineClient for market data
vi.mock('../../src/clients/engine.js', () => ({
  engineClient: {
    getDailyBars: vi.fn().mockImplementation(async (symbol, options) => {
      // Return 25 valid bars ending on session date
      const session = options?.session || '2026-11-25'
      const bars = []
      for (let i = 24; i >= 0; i--) {
        const d = new Date(new Date(session).getTime() - i * 86400000).toISOString().slice(0, 10)
        bars.push([d, 100 + i, 105 + i, 98 + i, 103 + i, 1000000])
      }
      return { bars, source: 'alpha-engine' }
    })
  }
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

  await h.db.user.create({
    data: { id: 'usr_reg', email: 'reg@test.com', role: 'user', subscription: { status: 'ACTIVE' } }
  })
  await h.db.user.create({
    data: { id: 'usr_op', email: 'op@test.com', role: 'operator', subscription: { status: 'ACTIVE' } }
  })
  await h.db.user.create({
    data: { id: 'usr_adm', email: 'admin@test.com', role: 'admin', subscription: { status: 'ACTIVE' } }
  })
})

describe('GET /api/admin/market-data/diagnostics', () => {
  it('blocks unauthenticated requests with 401', async () => {
    const res = await request(app.server).get('/api/admin/market-data/diagnostics')
    expect(res.status).toBe(401)
  })

  it('blocks non-admin/non-operator users with 403', async () => {
    const res = await request(app.server)
      .get('/api/admin/market-data/diagnostics')
      .set('Authorization', `Bearer ${regularToken}`)
    expect(res.status).toBe(403)
  })

  it('returns universe-wide ticker feed diagnostics for admin', async () => {
    const res = await request(app.server)
      .get('/api/admin/market-data/diagnostics?session=2026-11-25')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const data = res.body.data
    expect(data.session).toBe('2026-11-25')
    expect(data.status).toBe('healthy')
    expect(data.summary.total).toBe(10)
    expect(data.summary.healthy).toBe(10)
    expect(data.symbols).toHaveLength(10)

    const aapl = data.symbols.find(s => s.symbol === 'AAPL')
    expect(aapl).toBeDefined()
    expect(aapl.status).toBe('healthy')
    expect(aapl.barsCount).toBeGreaterThanOrEqual(20)
    expect(aapl.source).toBe('alpha-engine')
  })
})

describe('POST /api/admin/market-data/revalidate', () => {
  it('blocks operator users from re-validating feed (adminOnly requirement)', async () => {
    const res = await request(app.server)
      .post('/api/admin/market-data/revalidate')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ session: '2026-11-25' })

    expect(res.status).toBe(403)
  })

  it('allows administrator to re-validate market feed and records audit log', async () => {
    const res = await request(app.server)
      .post('/api/admin/market-data/revalidate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ session: '2026-11-25' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('healthy')

    // Verify audit log
    const auditRes = await request(app.server)
      .get('/api/admin/audit-log?action=revalidate_market_data')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(auditRes.status).toBe(200)
    expect(auditRes.body.data.logs).toHaveLength(1)
    const log = auditRes.body.data.logs[0]
    expect(log.action).toBe('revalidate_market_data')
    expect(log.targetType).toBe('market_feed')
    expect(log.targetId).toBe('2026-11-25')
    expect(log.payload.status).toBe('healthy')
  })
})
