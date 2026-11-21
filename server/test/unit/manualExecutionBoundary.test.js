import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import createApp from '../../src/loaders/fastify.js'
import executionsRoutes from '../../src/routes/executions.js'

vi.mock('../../src/middleware/authenticate.js', () => ({
  authenticate: vi.fn(async request => { request.user = { id: 'u1' } })
}))
vi.mock('../../src/loaders/prisma.js', () => ({
  default: {
    portfolio: { findFirst: vi.fn() }
  }
}))
vi.mock('../../src/services/alpacaClockService.js', () => ({
  getUserAlpacaCredentialsOrThrow: vi.fn(),
  fetchAlpacaMarketClock: vi.fn()
}))
vi.mock('../../src/services/executionsService.js', () => ({
  default: {
    createExecution: vi.fn(),
    getExecutions: vi.fn(),
    getExecution: vi.fn(),
    getExecutionSummary: vi.fn(),
    cancelExecution: vi.fn()
  }
}))
vi.mock('../../src/services/executionResearchService.js', () => ({
  getExecutionResearch: vi.fn()
}))

import prisma from '../../src/loaders/prisma.js'
import executionsService from '../../src/services/executionsService.js'
import { getUserAlpacaCredentialsOrThrow, fetchAlpacaMarketClock } from '../../src/services/alpacaClockService.js'

let app
beforeAll(async () => {
  app = await createApp()
  await app.register(executionsRoutes, { prefix: '/api/executions' })
  await app.ready()
})
afterAll(async () => app.close())
beforeEach(() => {
  vi.clearAllMocks()
  getUserAlpacaCredentialsOrThrow.mockResolvedValue({ paper: true })
  fetchAlpacaMarketClock.mockResolvedValue({ isOpen: true })
  prisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1' })
  executionsService.createExecution.mockResolvedValue({ id: 'e1', status: 'queued' })
})

const payload = {
  ticker: 'aapl', direction: 'buy', quantity: 1, price: 100, portfolioId: 'pf1'
}
const post = body => app.inject({ method: 'POST', url: '/api/executions', payload: body })

describe('manual execution boundary', () => {
  it('queues only a normalized manual paper intent with server-owned identity', async () => {
    const response = await post(payload)
    expect(response.statusCode).toBe(201)
    expect(executionsService.createExecution).toHaveBeenCalledWith({
      userId: 'u1', portfolioId: 'pf1', ticker: 'AAPL', direction: 'buy',
      quantity: 1, price: 100, commission: 0, fees: 0
    })
    expect(prisma.portfolio.findFirst).toHaveBeenCalledWith({
      where: { id: 'pf1', userId: 'u1' }, select: { id: true }
    })
  })

  it.each(['botId', 'predictionId', 'strategyId', 'origin', 'userId', 'status', 'brokerOrderId'])(
    'refuses client-controlled %s attribution', async key => {
      const response = await post({ ...payload, [key]: 'forged' })
      expect(response.statusCode).toBe(400)
      expect(executionsService.createExecution).not.toHaveBeenCalled()
    }
  )

  it('refuses a portfolio belonging to another account', async () => {
    prisma.portfolio.findFirst.mockResolvedValue(null)
    const response = await post(payload)
    expect(response.statusCode).toBe(404)
    expect(executionsService.createExecution).not.toHaveBeenCalled()
  })

  it('refuses non-paper broker credentials before checking market hours', async () => {
    getUserAlpacaCredentialsOrThrow.mockResolvedValue({ paper: false })
    const response = await post(payload)
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('PAPER_ONLY')
    expect(fetchAlpacaMarketClock).not.toHaveBeenCalled()
    expect(executionsService.createExecution).not.toHaveBeenCalled()
  })

  it.each([0, -1])('rejects invalid quantity %s', async quantity => {
    const response = await post({ ...payload, quantity })
    expect(response.statusCode).toBe(400)
  })

  it('does not queue while market is closed', async () => {
    fetchAlpacaMarketClock.mockResolvedValue({ isOpen: false })
    const response = await post(payload)
    expect(response.statusCode).toBe(409)
    expect(executionsService.createExecution).not.toHaveBeenCalled()
  })
})
