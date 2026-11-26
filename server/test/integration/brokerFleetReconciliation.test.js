/**
 * Integration tests for Broker Connectivity & Fleet Reconciliation
 * Covers user reconcile status/action and admin fleet status & reconcile-all sweeps.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'
import { encrypt } from '../../src/utils/encryption.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))

const { default: createApp } = await import('../../src/loaders/fastify.js')
const { default: registerRoutes } = await import('../../src/loaders/routes.js')

let app, regularToken, operatorToken, adminToken
const originalEnv = { ...process.env }
const originalFetch = global.fetch

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
  global.fetch = originalFetch
  process.env = originalEnv
  await app.close()
})

beforeEach(async () => {
  h.db.reset()
  vi.clearAllMocks()
  process.env = { ...originalEnv }

  // Default mock fetch for Alpaca
  global.fetch = vi.fn().mockImplementation(async (url) => {
    const urlStr = String(url)
    if (urlStr.includes('/v2/orders')) {
      return {
        ok: true,
        status: 200,
        json: async () => []
      }
    }
    if (urlStr.includes('/v2/positions')) {
      return {
        ok: true,
        status: 200,
        json: async () => []
      }
    }
    if (urlStr.includes('/v2/account')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'acc_test', status: 'ACTIVE', currency: 'USD', cash: '50000', portfolio_value: '50000' })
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({})
    }
  })

  await h.db.user.create({
    data: { id: 'usr_reg', email: 'reg@test.com', name: 'Regular User', role: 'user', subscription: { status: 'ACTIVE' } }
  })
  await h.db.user.create({
    data: { id: 'usr_op', email: 'op@test.com', name: 'Operator User', role: 'operator', subscription: { status: 'ACTIVE' } }
  })
  await h.db.user.create({
    data: { id: 'usr_adm', email: 'admin@test.com', name: 'Admin User', role: 'admin', subscription: { status: 'ACTIVE' } }
  })
})

describe('User Broker Reconciliation APIs (/api/account)', () => {
  it('GET /api/account/reconcile-status returns healthy simulated reconcile status when in simulation mode', async () => {
    process.env.BROKER_MODE = 'simulated'
    process.env.SIM_REPLAY_SESSION = 'latest'
    process.env.SIM_STARTING_CASH = '100000'

    const res = await request(app.server)
      .get('/api/account/reconcile-status')
      .set('Authorization', `Bearer ${regularToken}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      synced: true,
      lastSyncStatus: 'ok',
      inSync: true,
      mismatchCount: 0,
      positionSource: 'simulated'
    })
  })

  it('POST /api/account/reconcile executes simulated reconciliation and returns clean result', async () => {
    process.env.BROKER_MODE = 'simulated'
    process.env.SIM_REPLAY_SESSION = 'latest'
    process.env.SIM_STARTING_CASH = '100000'

    const res = await request(app.server)
      .post('/api/account/reconcile')
      .set('Authorization', `Bearer ${regularToken}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      imported: 0,
      scannedOrders: 0,
      inSync: true,
      mismatchCount: 0,
      positionSource: 'simulated'
    })

    const checkpoint = await h.db.brokerSyncCheckpoint.findUnique({ where: { userId: 'usr_reg' } })
    expect(checkpoint).toBeDefined()
    expect(checkpoint.lastSyncStatus).toBe('ok')
    expect(checkpoint.inSync).toBe(true)
  })

  it('POST /api/account/reconcile reconciles connected Alpaca credentials when not in simulation mode', async () => {
    delete process.env.BROKER_MODE
    delete process.env.SIM_REPLAY_SESSION

    await h.db.brokerAccount.create({
      data: {
        id: 'brk_reg',
        userId: 'usr_reg',
        broker: 'alpaca',
        apiKey: encrypt('PKTESTKEY12345'),
        apiSecret: encrypt('testsecretkey12345'),
        paper: true,
        status: 'active'
      }
    })

    const res = await request(app.server)
      .post('/api/account/reconcile')
      .set('Authorization', `Bearer ${regularToken}`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      imported: 0,
      scannedOrders: 0,
      inSync: true,
      mismatchCount: 0,
      positionSource: 'db'
    })

    const checkpoint = await h.db.brokerSyncCheckpoint.findUnique({ where: { userId: 'usr_reg' } })
    expect(checkpoint).toBeDefined()
    expect(checkpoint.lastSyncStatus).toBe('ok')
    expect(checkpoint.inSync).toBe(true)
  })
})

describe('Admin Broker Fleet Radar (/api/admin/broker/fleet-status)', () => {
  it('enforces RBAC on /api/admin/broker/fleet-status', async () => {
    // Unauthenticated
    const res401 = await request(app.server).get('/api/admin/broker/fleet-status')
    expect(res401.status).toBe(401)

    // Regular user
    const res403 = await request(app.server)
      .get('/api/admin/broker/fleet-status')
      .set('Authorization', `Bearer ${regularToken}`)
    expect(res403.status).toBe(403)

    // Operator (allowed by requireAdmin)
    const resOp = await request(app.server)
      .get('/api/admin/broker/fleet-status')
      .set('Authorization', `Bearer ${operatorToken}`)
    expect(resOp.status).toBe(200)

    // Admin
    const resAdmin = await request(app.server)
      .get('/api/admin/broker/fleet-status')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(resAdmin.status).toBe(200)
  })

  it('reports fleet statistics, paper/live distribution, and accounts with position drift', async () => {
    // Seed broker accounts: 1 paper in sync, 1 live with drift
    await h.db.brokerAccount.create({
      data: {
        id: 'brk_1',
        userId: 'usr_reg',
        broker: 'alpaca',
        apiKey: encrypt('key1'),
        apiSecret: encrypt('sec1'),
        paper: true,
        status: 'active'
      }
    })
    await h.db.brokerSyncCheckpoint.create({
      data: {
        userId: 'usr_reg',
        lastSyncedAt: new Date(),
        lastSyncStatus: 'ok',
        inSync: true,
        mismatchCount: 0,
        mismatchDetails: [],
        positionSource: 'db'
      }
    })

    await h.db.brokerAccount.create({
      data: {
        id: 'brk_2',
        userId: 'usr_op',
        broker: 'alpaca',
        apiKey: encrypt('key2'),
        apiSecret: encrypt('sec2'),
        paper: false,
        status: 'active'
      }
    })
    await h.db.brokerSyncCheckpoint.create({
      data: {
        userId: 'usr_op',
        lastSyncedAt: new Date(),
        lastSyncStatus: 'error',
        inSync: false,
        mismatchCount: 2,
        mismatchDetails: [
          { symbol: 'AAPL', localQty: 10, brokerQty: 0, brokerAvgPrice: 0 },
          { symbol: 'SPY', localQty: 50, brokerQty: 45, brokerAvgPrice: 590 }
        ],
        positionSource: 'broker'
      }
    })

    const res = await request(app.server)
      .get('/api/admin/broker/fleet-status')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.fleet).toEqual({
      totalAccounts: 2,
      paperAccounts: 1,
      liveAccounts: 1,
      inSyncAccounts: 1,
      driftedAccountsCount: 1
    })

    expect(res.body.data.driftedAccounts).toHaveLength(1)
    expect(res.body.data.driftedAccounts[0]).toMatchObject({
      userId: 'usr_op',
      userEmail: 'op@test.com',
      paper: false,
      mismatchCount: 2,
      positionSource: 'broker'
    })
    expect(res.body.data.driftedAccounts[0].mismatchDetails).toHaveLength(2)
  })
})

describe('Admin Fleet Reconciliation Sweep (/api/admin/broker/reconcile-all)', () => {
  it('enforces admin-only RBAC for fleet-wide reconciliation sweeps', async () => {
    // Unauthenticated
    const res401 = await request(app.server).post('/api/admin/broker/reconcile-all')
    expect(res401.status).toBe(401)

    // Regular user
    const res403 = await request(app.server)
      .post('/api/admin/broker/reconcile-all')
      .set('Authorization', `Bearer ${regularToken}`)
    expect(res403.status).toBe(403)

    // Operator (admin-only mutation)
    const resOp = await request(app.server)
      .post('/api/admin/broker/reconcile-all')
      .set('Authorization', `Bearer ${operatorToken}`)
    expect(resOp.status).toBe(403)

    // Admin allowed
    const resAdmin = await request(app.server)
      .post('/api/admin/broker/reconcile-all')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(resAdmin.status).toBe(200)
  })

  it('triggers sweep across active accounts and records immutable audit log', async () => {
    await h.db.brokerAccount.create({
      data: {
        id: 'brk_1',
        userId: 'usr_reg',
        broker: 'alpaca',
        apiKey: encrypt('key1'),
        apiSecret: encrypt('sec1'),
        paper: true,
        status: 'active'
      }
    })

    const res = await request(app.server)
      .post('/api/admin/broker/reconcile-all')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toMatchObject({
      total: 1,
      succeeded: 1,
      failed: 0,
      errors: []
    })

    // Verify audit log
    const auditLogs = await h.db.adminAuditLog.findMany({
      where: { action: 'broker_reconcile_all' }
    })
    expect(auditLogs).toHaveLength(1)
    expect(auditLogs[0]).toMatchObject({
      adminId: 'usr_adm',
      action: 'broker_reconcile_all',
      targetType: 'broker_fleet',
      targetId: 'all'
    })
  })
})
