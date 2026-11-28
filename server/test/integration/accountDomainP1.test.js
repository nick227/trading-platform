import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import prisma from '../../src/loaders/prisma.js'
import accountRoutes from '../../src/routes/account.js'
import brokerRoutes from '../../src/routes/broker.js'
import portfoliosRoutes from '../../src/routes/portfolios.js'
import botsRoutes from '../../src/routes/bots/index.js'
import { authenticate } from '../../src/middleware/authenticate.js'
import { ensureDefaultPaperPortfolio } from '../../src/services/defaultPaperPortfolioService.js'
import {
  PORTFOLIO_ENVIRONMENTS,
  PORTFOLIO_STATUSES
} from '../../src/services/accountDomainService.js'

describe('P1 — Account, Portfolio, and Brokerage Identity Architecture', () => {
  let app
  const createdUserIds = []
  const origFetch = global.fetch

  beforeAll(async () => {
    app = Fastify()
    await app.register(cookie)
    await app.register(jwt, {
      secret: process.env.JWT_SECRET || 'test-p1-jwt-secret',
      cookie: { cookieName: 'access_token', signed: false }
    })
    await app.register(accountRoutes, { prefix: '/api/account' })
    await app.register(brokerRoutes, { prefix: '/api/broker' })
    await app.register(portfoliosRoutes, { prefix: '/api/portfolios' })
    await app.register(async (scoped) => {
      scoped.addHook('preHandler', authenticate)
      await scoped.register(botsRoutes)
    }, { prefix: '/api/bots' })
    await app.ready()
  })

  afterAll(async () => {
    global.fetch = origFetch
    for (const uid of createdUserIds) {
      const bots = await prisma.bot.findMany({ where: { userId: uid }, select: { id: true } }).catch(() => [])
      if (bots.length) {
        const ids = bots.map((b) => b.id)
        await prisma.botEvent.deleteMany({ where: { botId: { in: ids } } }).catch(() => {})
        await prisma.botRule.deleteMany({ where: { botId: { in: ids } } }).catch(() => {})
      }
      await prisma.bot.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.defaultPaperPortfolio.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.portfolio.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.brokerConnection.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.brokerAccount.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.subscription.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {})
    }
    await app?.close()
  })

  async function createActiveUser() {
    const user = await prisma.user.create({
      data: {
        email: `p1_domain_${randomUUID()}@example.test`,
        passwordHash: '$test$',
        fullName: 'P1 Domain User',
        subscription: {
          create: {
            status: 'ACTIVE',
            plan: 'BASIC',
            endsAt: new Date(Date.now() + 30 * 86_400_000)
          }
        }
      }
    })
    createdUserIds.push(user.id)
    const token = app.jwt.sign({ sub: user.id })
    return { user, headers: { authorization: `Bearer ${token}` } }
  }

  it('supports multiple independent portfolios per user and enforces immutable environment & broker bindings', async () => {
    const { user, headers } = await createActiveUser()
    const defaultSim = await ensureDefaultPaperPortfolio(user.id)
    expect(defaultSim.environment).toBe(PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM)
    expect(defaultSim.status).toBe(PORTFOLIO_STATUSES.ACTIVE)

    // Create a second independent internal_sim portfolio ($25,000)
    const createSim2 = await app.inject({
      method: 'POST',
      url: '/api/portfolios',
      headers,
      payload: {
        name: 'Aggressive Momentum Sandbox',
        environment: 'internal_sim',
        startingCash: 25000
      }
    })
    expect(createSim2.statusCode).toBe(201)
    const sim2 = createSim2.json().data
    expect(sim2.id).not.toBe(defaultSim.id)
    expect(sim2.environment).toBe('internal_sim')
    expect(Number(sim2.cashBalance)).toBe(25000)

    // Reject creating an alpaca_live portfolio
    const rejectLive = await app.inject({
      method: 'POST',
      url: '/api/portfolios',
      headers,
      payload: { name: 'Live Account', environment: 'alpaca_live' }
    })
    expect(rejectLive.statusCode).toBe(403)
    expect(rejectLive.json().error.code).toBe('LIVE_ENVIRONMENT_DISABLED')

    // Reject mutating environment or brokerConnectionId on PUT /api/portfolios/:id
    const mutateEnv = await app.inject({
      method: 'PUT',
      url: `/api/portfolios/${sim2.id}`,
      headers,
      payload: { name: 'Renamed', environment: 'alpaca_paper' }
    })
    expect(mutateEnv.statusCode).toBe(409)
    expect(mutateEnv.json().error.code).toBe('PORTFOLIO_IDENTITY_IMMUTABLE')
  })

  it('never redirects bots when switching external brokerage accounts and isolates internal_sim bots on disconnect', async () => {
    const { user, headers } = await createActiveUser()
    const simPortfolio = await ensureDefaultPaperPortfolio(user.id)

    // Connect Alpaca Paper Account #PA-1001
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'acc_1001', account_number: 'PA1001', equity: '100000', cash: '100000' })
    })
    const conn1Res = await app.inject({
      method: 'POST',
      url: '/api/account/broker-credentials',
      headers,
      payload: { apiKey: 'PK_1001_A', apiSecret: 'SK_1001_A', paper: true }
    })
    expect(conn1Res.statusCode).toBe(200)
    const conn1Id = conn1Res.json().brokerConnectionId
    expect(conn1Res.json().externalAccountId).toBe('PA1001')

    const portPA1001 = await prisma.portfolio.findFirst({
      where: { userId: user.id, brokerConnectionId: conn1Id }
    })
    expect(portPA1001).toBeTruthy()
    expect(portPA1001.environment).toBe('alpaca_paper')
    expect(portPA1001.status).toBe('active')

    // Create 1 bot on internal_sim and 1 bot on PA1001 brokerage portfolio
    const simBotRes = await app.inject({
      method: 'POST',
      url: '/api/bots/configuration',
      headers,
      payload: {
        portfolioId: simPortfolio.id,
        name: 'Sim AAPL Bot',
        enabled: true,
        config: { tickers: ['AAPL'], direction: 'buy', quantity: 2 },
        rules: [{ type: 'price_threshold', config: { operator: 'below', price: 250 } }]
      }
    })
    expect(simBotRes.statusCode).toBe(201)
    const simBotId = simBotRes.json().data.id

    const brokerBotRes = await app.inject({
      method: 'POST',
      url: '/api/bots/configuration',
      headers,
      payload: {
        portfolioId: portPA1001.id,
        name: 'PA1001 MSFT Bot',
        enabled: true,
        config: { tickers: ['MSFT'], direction: 'buy', quantity: 1 },
        rules: [{ type: 'price_threshold', config: { operator: 'below', price: 450 } }]
      }
    })
    expect(brokerBotRes.statusCode).toBe(201)
    const brokerBotId = brokerBotRes.json().data.id

    // Rotate keys on the SAME external account PA1001 -> portfolio stays active, bot stays on portPA1001
    const rotateSameRes = await app.inject({
      method: 'POST',
      url: '/api/account/broker-credentials',
      headers,
      payload: { apiKey: 'PK_1001_ROTATED', apiSecret: 'SK_1001_ROTATED', paper: true }
    })
    expect(rotateSameRes.statusCode).toBe(200)
    expect(rotateSameRes.json().brokerConnectionId).toBe(conn1Id)
    const botAfterRotate = await prisma.bot.findUnique({ where: { id: brokerBotId } })
    expect(botAfterRotate.portfolioId).toBe(portPA1001.id)
    expect(botAfterRotate.enabled).toBe(true)

    // Switch credentials to a DIFFERENT external Alpaca Paper Account #PA-2002:
    // PA1001 portfolio MUST halt & pause its bot (NEVER redirect brokerBotId to PA2002!),
    // while simBotId on internal_sim stays enabled!
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'acc_2002', account_number: 'PA2002', equity: '50000', cash: '50000' })
    })
    const conn2Res = await app.inject({
      method: 'POST',
      url: '/api/account/broker-credentials',
      headers,
      payload: { apiKey: 'PK_2002_NEW', apiSecret: 'SK_2002_NEW', paper: true }
    })
    expect(conn2Res.statusCode).toBe(200)
    const conn2Id = conn2Res.json().brokerConnectionId
    expect(conn2Id).not.toBe(conn1Id)

    const reloadedPA1001 = await prisma.portfolio.findUnique({ where: { id: portPA1001.id } })
    const portPA2002 = await prisma.portfolio.findFirst({ where: { userId: user.id, brokerConnectionId: conn2Id } })
    const reloadedBrokerBot = await prisma.bot.findUnique({ where: { id: brokerBotId } })
    const reloadedSimBot = await prisma.bot.findUnique({ where: { id: simBotId } })

    expect(reloadedPA1001.status).toBe('halted_credentials')
    expect(portPA2002.id).not.toBe(portPA1001.id)
    expect(portPA2002.status).toBe('active')
    expect(reloadedBrokerBot.portfolioId).toBe(portPA1001.id) // NEVER redirected!
    expect(reloadedBrokerBot.enabled).toBe(false)             // Paused safely!
    expect(reloadedSimBot.enabled).toBe(true)                 // Internal sim untouched!

    // Attempting to re-enable brokerBotId while PA1001 is halted_credentials fails closed with 409
    const resumeHalted = await app.inject({
      method: 'PUT',
      url: `/api/bots/${brokerBotId}`,
      headers,
      payload: { enabled: true }
    })
    expect(resumeHalted.statusCode).toBe(409)
    expect(resumeHalted.json().error.code).toBe('PORTFOLIO_NOT_ACTIVE')

    // Disconnecting all brokerage credentials halts PA2002 while keeping simBotId active
    const discRes = await app.inject({
      method: 'DELETE',
      url: '/api/account/broker-credentials',
      headers
    })
    expect(discRes.statusCode).toBe(200)
    expect((await prisma.portfolio.findUnique({ where: { id: portPA2002.id } })).status).toBe('halted_credentials')
    expect((await prisma.bot.findUnique({ where: { id: simBotId } })).enabled).toBe(true)
  })
})
