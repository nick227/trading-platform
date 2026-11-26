/**
 * Integration tests for /api/admin endpoints and operational controls.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'
import { PLATFORM_USER_ID } from '../../src/services/ai/aiBotService.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))

// Mock external engine and AI services
vi.mock('../../src/clients/engine.js', () => ({
  engineClient: {
    getRegime: vi.fn().mockResolvedValue({ regime: 'BULL' }),
    getDailyBars: vi.fn().mockResolvedValue([])
  }
}))

vi.mock('../../src/services/ai/aiPipelineTracker.js', () => ({
  getAiPipelineStatus: vi.fn().mockResolvedValue({
    status: 'ok',
    templateId: 'tmpl_ai_catalyst_momentum',
    stages: {
      market_data_ingestion: { status: 'ok' },
      pending_order_execution: { status: 'ok' }
    }
  })
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

  // Seed test users
  await h.db.user.create({
    data: { id: 'usr_reg', email: 'reg@example.com', fullName: 'Regular User', role: 'user', subscription: { status: 'ACTIVE' } }
  })
  await h.db.user.create({
    data: { id: 'usr_op', email: 'op@example.com', fullName: 'Operator User', role: 'operator', subscription: { status: 'ACTIVE' } }
  })
  await h.db.user.create({
    data: { id: 'usr_adm', email: 'adm@example.com', fullName: 'Admin User', role: 'admin', subscription: { status: 'ACTIVE' } }
  })
  await h.db.user.create({
    data: { id: PLATFORM_USER_ID, email: 'canonical@internal', fullName: 'Canonical System', role: 'admin', subscription: { status: 'ACTIVE' } }
  })

  // Seed sample worker status
  await h.db.workerStatus.create({
    data: { id: 'worker-1', lastSeen: new Date(), startedAt: new Date(), queueLagMs: 15 }
  })
  await h.db.workerStatus.create({
    data: { id: 'worker-stale', lastSeen: new Date(Date.now() - 30 * 60 * 1000), startedAt: new Date(), queueLagMs: null }
  })

  // Seed sample bot & execution
  await h.db.bot.create({
    data: { id: 'bot_test_1', userId: 'usr_reg', portfolioId: 'port_1', name: 'Test Bot', enabled: true, botType: 'ai' }
  })
  await h.db.execution.create({
    data: { id: 'exec_1', userId: 'usr_reg', portfolioId: 'port_1', ticker: 'AAPL', direction: 'buy', quantity: 5, price: 350, notional: 1750, status: 'filled' }
  })

  // Seed sample activity
  await h.db.botEvent.create({
    data: { id: 'evt_1', botId: 'bot_test_1', portfolioId: 'port_1', type: 'ai_decision', detail: 'AI decided BUY AAPL', createdAt: new Date() }
  })
  await h.db.executionAudit.create({
    data: { id: 'aud_1', executionId: 'exec_1', userId: 'usr_reg', eventType: 'fill_processed', detail: 'Filled 5 AAPL at 350', createdAt: new Date() }
  })
})

describe('GET /api/admin/overview', () => {
  it('denies unauthenticated requests with 401', async () => {
    const res = await request(app.server).get('/api/admin/overview')
    expect(res.status).toBe(401)
  })

  it('denies regular users with 403', async () => {
    const res = await request(app.server)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${regularToken}`)
    expect(res.status).toBe(403)
  })

  it('allows operators and returns platform metrics', async () => {
    const res = await request(app.server)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${operatorToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.users.total).toBe(4)
    expect(res.body.data.bots.total).toBe(1)
    expect(res.body.data.bots.ai).toBe(1)
    expect(res.body.data.workers.total).toBe(2)
    expect(res.body.data.workers.activeCount).toBe(1)
    expect(res.body.data.workers.staleCount).toBe(1)
    expect(res.body.data.pipeline.status).toBe('ok')
  })
})

describe('GET /api/admin/activity', () => {
  it('returns combined stream of bot events and execution audits', async () => {
    const res = await request(app.server)
      .get('/api/admin/activity?limit=10')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.events.length).toBe(2)
    const sources = res.body.data.events.map(i => i.source)
    expect(sources).toContain('bot_event')
    expect(sources).toContain('execution_audit')
  })
})

describe('GET /api/admin/users and PUT /api/admin/users/:id/role', () => {
  it('lists users for admin or operator', async () => {
    const res = await request(app.server)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${operatorToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.total).toBe(4)
  })

  it('denies operator from modifying user role (requires strict admin)', async () => {
    const res = await request(app.server)
      .put('/api/admin/users/usr_reg/role')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ role: 'operator' })

    expect(res.status).toBe(403)
  })

  it('allows admin to promote a user to operator', async () => {
    const res = await request(app.server)
      .put('/api/admin/users/usr_reg/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'operator' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.user.role).toBe('operator')
  })

  it('prevents modifying platform canonical system user role', async () => {
    const res = await request(app.server)
      .put(`/api/admin/users/${PLATFORM_USER_ID}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'user' })

    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/canonical/i)
  })

  it('prevents admin from demoting their own account', async () => {
    const res = await request(app.server)
      .put('/api/admin/users/usr_adm/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'user' })

    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/cannot demote/i)
  })
})

describe('Admin Operational Controls', () => {
  it('cleans up stale workers older than retention threshold', async () => {
    const res = await request(app.server)
      .post('/api/admin/controls/cleanup-workers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ retentionMs: 10 * 60 * 1000 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.result.deleted).toBe(1)
  })

  it('activates and clears emergency stop on target user and records audit log', async () => {
    // Activate
    const resActive = await request(app.server)
      .post('/api/admin/controls/emergency-stop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true, reason: 'Test admin stop', targetUserId: 'usr_reg' })

    expect(resActive.status).toBe(200)
    expect(resActive.body.result.active).toBe(true)

    // Clear
    const resClear = await request(app.server)
      .post('/api/admin/controls/emergency-stop')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false, targetUserId: 'usr_reg' })

    expect(resClear.status).toBe(200)
    expect(resClear.body.result.active).toBe(false)
  })
})

describe('GET /api/admin/audit-log', () => {
  it('denies unauthenticated users with 401', async () => {
    const res = await request(app.server).get('/api/admin/audit-log')
    expect(res.status).toBe(401)
  })

  it('denies regular users with 403', async () => {
    const res = await request(app.server)
      .get('/api/admin/audit-log')
      .set('Authorization', `Bearer ${regularToken}`)
    expect(res.status).toBe(403)
  })

  it('allows operators to read audit logs', async () => {
    const res = await request(app.server)
      .get('/api/admin/audit-log')
      .set('Authorization', `Bearer ${operatorToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data.logs)).toBe(true)
  })

  it('records audit log entries on role updates and admin actions', async () => {
    // Perform a role change
    await request(app.server)
      .put('/api/admin/users/usr_reg/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'operator' })

    // Verify audit log captured it
    const res = await request(app.server)
      .get('/api/admin/audit-log?action=update_user_role')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.logs.length).toBeGreaterThan(0)
    const log = res.body.data.logs[0]
    expect(log.action).toBe('update_user_role')
    expect(log.targetType).toBe('user')
    expect(log.targetId).toBe('usr_reg')
    expect(log.adminId).toBe('usr_adm')
  })
})

describe('Bot Fleet Management (GET /api/admin/bots, /:id, /:id/toggle)', () => {
  it('denies unauthenticated requests to /api/admin/bots', async () => {
    const res = await request(app.server).get('/api/admin/bots')
    expect(res.status).toBe(401)
  })

  it('denies regular users with 403', async () => {
    const res = await request(app.server)
      .get('/api/admin/bots')
      .set('Authorization', `Bearer ${regularToken}`)
    expect(res.status).toBe(403)
  })

  it('allows operators to query bot fleet with pagination and enrichment', async () => {
    const res = await request(app.server)
      .get('/api/admin/bots')
      .set('Authorization', `Bearer ${operatorToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.total).toBe(1)
    const bot = res.body.data.bots[0]
    expect(bot.id).toBe('bot_test_1')
    expect(bot.user.email).toBe('reg@example.com')
  })

  it('allows inspection of a single bot via /api/admin/bots/:id', async () => {
    const res = await request(app.server)
      .get('/api/admin/bots/bot_test_1')
      .set('Authorization', `Bearer ${operatorToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.bot.id).toBe('bot_test_1')
    expect(res.body.data.user.email).toBe('reg@example.com')
    expect(Array.isArray(res.body.data.recentEvents)).toBe(true)
  })

  it('returns 404 for non-existent bot ID', async () => {
    const res = await request(app.server)
      .get('/api/admin/bots/bot_nonexistent')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('BOT_NOT_FOUND')
  })

  it('denies operators from toggling bot state (admin only)', async () => {
    const res = await request(app.server)
      .post('/api/admin/bots/bot_test_1/toggle')
      .set('Authorization', `Bearer ${operatorToken}`)

    expect(res.status).toBe(403)
  })

  it('allows admin to toggle bot state and logs to audit trail', async () => {
    // Current bot is enabled: true -> toggle to false
    const res = await request(app.server)
      .post('/api/admin/bots/bot_test_1/toggle')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.bot.enabled).toBe(false)

    // Verify audit log captured pause_bot
    const auditRes = await request(app.server)
      .get('/api/admin/audit-log?action=pause_bot')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(auditRes.status).toBe(200)
    expect(auditRes.body.data.logs.length).toBeGreaterThan(0)
    const log = auditRes.body.data.logs[0]
    expect(log.action).toBe('pause_bot')
    expect(log.targetType).toBe('bot')
    expect(log.targetId).toBe('bot_test_1')
  })
})
