/**
 * M6 — risk-control routes: authentication, user scoping, and emergency-stop enforcement
 * at the API (bot resume / enabled creation), through the real Fastify app.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createMemoryPrisma } from '../support/memoryPrisma.js'

const h = vi.hoisted(() => ({ db: null }))
vi.mock('../../src/loaders/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
vi.mock('../../../worker/src/db/prisma.js', () => ({ default: new Proxy({}, { get: (_, k) => h.db[k] }) }))
// Broker credential checks are not under test here: treat both users as paper-connected.
vi.mock('../../src/services/alpacaClockService.js', async (orig) => ({
  ...(await orig()),
  getUserAlpacaCredentialsOrThrow: async () => ({ apiKey: 'k', apiSecret: 's', paper: true, baseUrl: 'https://paper-api.alpaca.markets' })
}))

const { default: createApp } = await import('../../src/loaders/fastify.js')
const { default: registerRoutes } = await import('../../src/loaders/routes.js')

let app, tokenA, tokenB

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
  await h.db.bot.create({ data: { id: 'bot_a', userId: 'usr_a', portfolioId: 'por_usr_a', name: 'A', enabled: true, config: {} } })
  await h.db.bot.create({ data: { id: 'bot_b', userId: 'usr_b', portfolioId: 'por_usr_b', name: 'B', enabled: true, config: {} } })
  await h.db.execution.create({ data: { id: 'exe_a', userId: 'usr_a', portfolioId: 'por_usr_a', ticker: 'SPY', direction: 'buy', quantity: 1, price: 100, status: 'queued', clientOrderId: 'tp_exe_a' } })
  await h.db.execution.create({ data: { id: 'exe_b', userId: 'usr_b', portfolioId: 'por_usr_b', ticker: 'SPY', direction: 'buy', quantity: 1, price: 100, status: 'queued', clientOrderId: 'tp_exe_b' } })
})

const as = (token) => ({ Authorization: `Bearer ${token}` })

describe('risk routes', () => {
  it('require authentication', async () => {
    expect((await request(app.server).post('/api/risk/kill-switch').send({ reason: 'x' })).status).toBe(401)
    expect((await request(app.server).get('/api/risk/kill-switch')).status).toBe(401)
    expect((await request(app.server).post('/api/risk/pause-bots').send({ portfolioId: 'por_usr_a', reason: 'x' })).status).toBe(401)
  })

  it('kill switch affects only the caller', async () => {
    const res = await request(app.server).post('/api/risk/kill-switch').set(as(tokenA)).send({ reason: 'panic' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ active: true, botsPaused: 1, cancellationsRequested: 1 })

    expect((await h.db.bot.findUnique({ where: { id: 'bot_a' } })).enabled).toBe(false)
    expect((await h.db.bot.findUnique({ where: { id: 'bot_b' } })).enabled).toBe(true)
    expect((await h.db.execution.findUnique({ where: { id: 'exe_a' } })).cancelRequestReason).toBe('emergency_stop')
    expect((await h.db.execution.findUnique({ where: { id: 'exe_b' } })).cancelRequestedAt).toBeNull()

    expect((await request(app.server).get('/api/risk/kill-switch').set(as(tokenA))).body.data.active).toBe(true)
    expect((await request(app.server).get('/api/risk/kill-switch').set(as(tokenB))).body.data.active).toBe(false)
  })

  it('cannot target another user’s portfolio', async () => {
    const res = await request(app.server).post('/api/risk/kill-switch').set(as(tokenA)).send({ reason: 'x', portfolioId: 'por_usr_b' })
    expect(res.status).toBe(404)
    expect((await h.db.bot.findUnique({ where: { id: 'bot_b' } })).enabled).toBe(true)
    const pause = await request(app.server).post('/api/risk/pause-bots').set(as(tokenA)).send({ portfolioId: 'por_usr_b', reason: 'x' })
    expect(pause.status).toBe(404)
  })

  it('blocks resuming bots and creating enabled bots while active; clearing does not resume', async () => {
    await request(app.server).post('/api/risk/kill-switch').set(as(tokenA)).send({ reason: 'panic' })
    const resume = await request(app.server).put('/api/bots/bot_a').set(as(tokenA)).send({ enabled: true })
    expect(resume.status).toBe(403)
    expect(resume.body.error.code).toBe('EMERGENCY_STOP_ACTIVE')
    const create = await request(app.server).post('/api/bots/catalog/from-template').set(as(tokenA)).send({ templateId: 't', portfolioId: 'por_usr_a', enabled: true })
    expect(create.status).toBe(403)

    const cleared = await request(app.server).delete('/api/risk/kill-switch').set(as(tokenA))
    expect(cleared.body.data).toMatchObject({ active: false, botsResumed: 0 })
    expect((await h.db.bot.findUnique({ where: { id: 'bot_a' } })).enabled).toBe(false)
  })
})
