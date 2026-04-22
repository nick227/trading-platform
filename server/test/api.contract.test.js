import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/loaders/prisma.js', () => ({
  default: {
    strategy: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    execution: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      findFirst: vi.fn()
    },
    botEvent: {
      create: vi.fn()
    },
    executionAudit: {
      create: vi.fn(),
      findMany: vi.fn()
    },
    workerStatus: {
      findMany: vi.fn()
    },
    prediction: {
      count: vi.fn()
    },
    bot: {
      count: vi.fn()
    },
    user: {
      findUnique: vi.fn()
    },
    brokerAccount: {
      findUnique: vi.fn()
    }
  }
}))

import prisma from '../src/loaders/prisma.js'
import createApp from '../src/loaders/fastify.js'
import registerRoutes from '../src/loaders/routes.js'

let app

describe('API contract tests', () => {
  beforeEach(async () => {
    prisma.strategy.create.mockReset()
    prisma.strategy.findMany.mockReset()
    prisma.strategy.count.mockReset()
    prisma.strategy.findUnique.mockReset()
    prisma.execution.create.mockReset()
    prisma.execution.findMany.mockReset()
    prisma.execution.findUnique.mockReset()
    prisma.botEvent.create.mockReset()
    prisma.executionAudit.create.mockReset()
    prisma.executionAudit.findMany.mockReset()
    prisma.workerStatus.findMany.mockReset()
    prisma.user.findUnique.mockReset()
    prisma.brokerAccount.findUnique.mockReset()

    process.env.ALPACA_API_KEY = 'test_key'
    process.env.ALPACA_API_SECRET = 'test_secret'
    process.env.ALPACA_PAPER = 'true'

    prisma.brokerAccount.findUnique.mockResolvedValue(null)

    global.fetch = vi.fn(async (url, options) => {
      if (String(url).includes('/v2/clock')) {
        return {
          ok: true,
          json: async () => ({
            is_open: true,
            next_open: '2026-04-21T13:30:00Z',
            next_close: '2026-04-21T20:00:00Z',
            timestamp: '2026-04-21T16:00:00Z'
          })
        }
      }

      throw new Error(`Unexpected fetch in test: ${url}`)
    })

    app = await createApp()
    await registerRoutes(app)
    await app.ready()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await app.close()
  })

  it('creates a new strategy and returns a 201 response', async () => {
    const strategy = { id: 'str_1', name: 'Momentum', description: 'Test', type: 'momentum' }
    prisma.strategy.create.mockResolvedValue(strategy)

    const response = await request(app.server)
      .post('/api/strategies')
      .send({ name: 'Momentum', type: 'momentum' })
      .expect(201)

    expect(response.body).toEqual({ data: strategy })
    expect(prisma.strategy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Momentum',
        type: 'momentum'
      })
    })
  })

  it('returns an empty strategy list with pagination metadata', async () => {
    prisma.strategy.findMany.mockResolvedValue([])
    prisma.strategy.count.mockResolvedValue(0)

    const response = await request(app.server)
      .get('/api/strategies')
      .expect(200)

    expect(response.body).toEqual({
      data: [],
      pagination: {
        total: 0,
        hasMore: false,
        nextOffset: null
      }
    })
  })

  it('returns 404 for a missing execution', async () => {
    prisma.execution.findUnique.mockResolvedValue(null)

    const response = await request(app.server)
      .get('/api/executions/missing-id')
      .expect(404)

    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Execution not found'
      }
    })
  })

  it('creates an execution and returns 201', async () => {
    const user = { id: 'usr_1', email: 't@example.com', fullName: 'Test User', subscription: { status: 'ACTIVE' } }
    prisma.user.findUnique.mockResolvedValue(user)

    const execution = {
      id: 'exec_1',
      userId: 'usr_1',
      ticker: 'NVDA',
      direction: 'buy',
      quantity: 1,
      price: 500,
      portfolioId: 'port_1',
      strategyId: 'str_1',
      status: 'queued',
      clientOrderId: 'tp_exec_1'
    }

    prisma.execution.create.mockResolvedValue(execution)

    const token = app.jwt.sign({ sub: user.id })

    const response = await request(app.server)
      .post('/api/executions')
      .send({
        ticker: 'NVDA',
        direction: 'buy',
        quantity: 1,
        price: 500,
        portfolioId: 'port_1',
        strategyId: 'str_1'
      })
      .set('Cookie', [`access_token=${token}`])
      .expect(201)

    expect(response.body).toEqual({ data: execution })
    expect(prisma.execution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ticker: 'NVDA',
        direction: 'buy',
        quantity: 1,
        price: 500,
        portfolioId: 'port_1',
        strategyId: 'str_1',
        status: 'queued',
        clientOrderId: expect.stringMatching(/^tp_exe_/)
      })
    }))
  })

  it('rejects creating an execution when market is closed', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/v2/clock')) {
        return {
          ok: true,
          json: async () => ({
            is_open: false,
            next_open: '2026-04-22T13:30:00Z',
            next_close: '2026-04-22T20:00:00Z',
            timestamp: '2026-04-21T23:00:00Z'
          })
        }
      }
      throw new Error(`Unexpected fetch in test: ${url}`)
    })

    const user = { id: 'usr_1', email: 't@example.com', fullName: 'Test User', subscription: { status: 'ACTIVE' } }
    prisma.user.findUnique.mockResolvedValue(user)

    const token = app.jwt.sign({ sub: user.id })

    const response = await request(app.server)
      .post('/api/executions')
      .send({
        ticker: 'NVDA',
        direction: 'buy',
        quantity: 1,
        price: 500,
        portfolioId: 'port_1',
        strategyId: 'str_1'
      })
      .set('Cookie', [`access_token=${token}`])
      .expect(409)

    expect(response.body).toEqual({
      error: {
        code: 'MARKET_CLOSED',
        message: 'Market is closed',
        clock: {
          isOpen: false,
          nextOpen: '2026-04-22T13:30:00Z',
          nextClose: '2026-04-22T20:00:00Z',
          timestamp: '2026-04-21T23:00:00Z'
        }
      }
    })
    expect(prisma.execution.create).not.toHaveBeenCalled()
  })

  it('rejects direct Alpaca order submission when market is closed', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/v2/clock')) {
        return {
          ok: true,
          json: async () => ({
            is_open: false,
            next_open: '2026-04-22T13:30:00Z',
            next_close: '2026-04-22T20:00:00Z',
            timestamp: '2026-04-21T23:00:00Z'
          })
        }
      }
      throw new Error(`Unexpected fetch in test: ${url}`)
    })

    const user = { id: 'usr_1', email: 't@example.com', fullName: 'Test User', subscription: { status: 'ACTIVE' } }
    prisma.user.findUnique.mockResolvedValue(user)

    const token = app.jwt.sign({ sub: user.id })

    const response = await request(app.server)
      .post('/api/alpaca/order')
      .send({ symbol: 'AAPL', side: 'buy', quantity: 1, type: 'market' })
      .set('Cookie', [`access_token=${token}`])
      .expect(409)

    expect(response.body).toEqual({
      error: 'Market is closed',
      code: 'MARKET_CLOSED',
      clock: {
        isOpen: false,
        nextOpen: '2026-04-22T13:30:00Z',
        nextClose: '2026-04-22T20:00:00Z',
        timestamp: '2026-04-21T23:00:00Z'
      }
    })
  })
})
