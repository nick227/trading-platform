/**
 * Integration tests for Role-Based Access Control (RBAC) middleware and authentication routes.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { createMemoryPrisma } from '../support/memoryPrisma.js'
import { requireAdmin, requireRole } from '../../src/middleware/requireAdmin.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))

const { default: createApp } = await import('../../src/loaders/fastify.js')
const { default: authRoutes } = await import('../../src/routes/auth.js')

let app, regularToken, operatorToken, adminToken

beforeAll(async () => {
  h.db = createMemoryPrisma()
  app = await createApp()
  await app.register(authRoutes, { prefix: '/api/auth' })

  // Register test endpoints using requireAdmin and requireRole
  app.get('/api/test/admin-or-operator', { preHandler: [requireAdmin] }, async (req) => {
    return { ok: true, role: req.user.role }
  })

  app.post('/api/test/admin-only', { preHandler: [requireRole(['admin'])] }, async (req) => {
    return { ok: true, adminAction: true }
  })

  await app.ready()

  regularToken = app.jwt.sign({ sub: 'usr_regular' })
  operatorToken = app.jwt.sign({ sub: 'usr_operator' })
  adminToken = app.jwt.sign({ sub: 'usr_admin' })
})

afterAll(async () => {
  await app.close()
})

beforeEach(async () => {
  h.db.reset()

  const passwordHash = await bcrypt.hash('Secret123!', 10)

  // Regular user
  await h.db.user.create({
    data: {
      id: 'usr_regular',
      email: 'regular@example.com',
      fullName: 'Regular User',
      passwordHash,
      role: 'user',
      subscription: { status: 'ACTIVE' }
    }
  })

  // Operator user
  await h.db.user.create({
    data: {
      id: 'usr_operator',
      email: 'operator@example.com',
      fullName: 'Operations User',
      passwordHash,
      role: 'operator',
      subscription: { status: 'ACTIVE' }
    }
  })

  // Admin user
  await h.db.user.create({
    data: {
      id: 'usr_admin',
      email: 'admin@example.com',
      fullName: 'Admin User',
      passwordHash,
      role: 'admin',
      subscription: { status: 'ACTIVE' }
    }
  })
})

describe('RBAC Middleware and Guards', () => {
  it('rejects unauthenticated requests with 401 Unauthorized', async () => {
    const res = await request(app.server).get('/api/test/admin-or-operator')
    expect(res.status).toBe(401)
  })

  it('rejects regular users (role: user) with 403 Forbidden', async () => {
    const res = await request(app.server)
      .get('/api/test/admin-or-operator')
      .set('Authorization', `Bearer ${regularToken}`)
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('FORBIDDEN')
  })

  it('allows operators (role: operator) on requireAdmin endpoints', async () => {
    const res = await request(app.server)
      .get('/api/test/admin-or-operator')
      .set('Authorization', `Bearer ${operatorToken}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.role).toBe('operator')
  })

  it('allows admins (role: admin) on requireAdmin endpoints', async () => {
    const res = await request(app.server)
      .get('/api/test/admin-or-operator')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.role).toBe('admin')
  })

  it('rejects operators on strict admin-only routes via requireRole', async () => {
    const res = await request(app.server)
      .post('/api/test/admin-only')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({})
    expect(res.status).toBe(403)
  })

  it('allows admins on strict admin-only routes via requireRole', async () => {
    const res = await request(app.server)
      .post('/api/test/admin-only')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.adminAction).toBe(true)
  })
})

describe('Auth Endpoint Role Exposure', () => {
  it('/api/auth/me returns the role field for authenticated users', async () => {
    const resAdmin = await request(app.server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(resAdmin.status).toBe(200)
    expect(resAdmin.body.role).toBe('admin')

    const resRegular = await request(app.server)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${regularToken}`)
    expect(resRegular.status).toBe(200)
    expect(resRegular.body.role).toBe('user')
  })

  it('/api/auth/login returns role in payload and sets cookie', async () => {
    const res = await request(app.server)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'Secret123!' })

    expect(res.status).toBe(200)
    expect(res.body.role).toBe('admin')
    expect(res.body.email).toBe('admin@example.com')
  })
})
