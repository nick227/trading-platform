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
    prediction: {
      count: vi.fn()
    },
    bot: {
      count: vi.fn()
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

    app = await createApp()
    await registerRoutes(app)
    await app.ready()
  })

  afterEach(async () => {
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
    const execution = {
      id: 'exec_1',
      ticker: 'NVDA',
      direction: 'buy',
      quantity: 1,
      price: 500,
      portfolioId: 'port_1',
      strategyId: 'str_1',
      status: 'proposed'
    }

    prisma.execution.create.mockResolvedValue(execution)

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
        status: 'proposed'
      })
    }))
  })
})
