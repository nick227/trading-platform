import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import createApp from '../loaders/fastify.js'
import tradeRoutes from './trade.js'

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: vi.fn(async (request) => {
    request.user = { id: 'usr_test123' }
  })
}))

vi.mock('../services/brokerService.js', () => ({
  default: {
    getBrokerAccountInternal: vi.fn().mockResolvedValue({ id: 'ba_1', paper: true })
  }
}))

vi.mock('../services/alpacaClockService.js', () => ({
  resolveAlpacaCredentials: vi.fn().mockResolvedValue({
    apiKey: 'TESTKEY',
    apiSecret: 'TESTSECRET',
    paper: true,
    baseUrl: 'https://paper-api.alpaca.markets'
  }),
  fetchAlpacaMarketClock: vi.fn().mockResolvedValue({
    isOpen: true,
    nextOpen: null,
    nextClose: null,
    timestamp: new Date().toISOString()
  })
}))

vi.mock('../services/executionsService.js', () => ({
  default: {
    createExecution: vi.fn().mockResolvedValue({
      id: 'exe_test123',
      ticker: 'AAPL',
      direction: 'buy',
      quantity: 1,
      price: 150,
      status: 'queued',
      brokerOrderId: null,
      submittedAt: null
    })
  }
}))

const mockExecution = vi.hoisted(() => ({
  id: 'exe_test123',
  userId: 'usr_test123',
  ticker: 'AAPL',
  direction: 'buy',
  quantity: 1,
  price: 150,
  status: 'queued',
  brokerOrderId: null,
  submittedAt: null,
  filledPrice: null,
  filledAt: null,
  commission: 1.95,
  pnl: null,
  cancelRequestedAt: null,
  cancelRequestedBy: null,
  cancelRequestReason: null
}))

vi.mock('../loaders/prisma.js', () => ({
  default: {
    portfolio: {
      findFirst: vi.fn().mockResolvedValue({ id: 'por_test123' }),
      create: vi.fn().mockResolvedValue({ id: 'por_created' })
    },
    execution: {
      findUnique: vi.fn().mockResolvedValue(mockExecution),
      update: vi.fn().mockResolvedValue({ ...mockExecution, cancelRequestedAt: new Date(), cancelRequestedBy: 'usr_test123' })
    },
    executionAudit: {
      create: vi.fn().mockResolvedValue({})
    }
  }
}))

let app

beforeAll(async () => {
  app = await createApp()
  await app.register(tradeRoutes, { prefix: '/api/trade' })
  await app.ready()
})

afterAll(() => app.close())

describe('POST /api/trade', () => {
  it('queues an execution and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/trade',
      payload: { symbol: 'AAPL', direction: 'BUY', quantity: 1, price: 150 }
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.execution.status).toBe('queued')
    expect(body.execution.symbol).toBe('AAPL')
    expect(body.execution.direction).toBe('BUY')
    expect(body.execution.alpacaOrderId).toBeNull()
  })

  it('returns 409 when market is closed', async () => {
    const { fetchAlpacaMarketClock } = await import('../services/alpacaClockService.js')
    vi.mocked(fetchAlpacaMarketClock).mockResolvedValueOnce({
      isOpen: false,
      nextOpen: '2026-04-23T13:30:00Z',
      nextClose: null,
      timestamp: new Date().toISOString()
    })
    // Temporarily unset the bypass flag to exercise the closed-market branch
    const prev = process.env.SKIP_MARKET_HOURS_CHECK
    delete process.env.SKIP_MARKET_HOURS_CHECK

    const res = await app.inject({
      method: 'POST',
      url: '/api/trade',
      payload: { symbol: 'AAPL', direction: 'BUY', quantity: 1, price: 150 }
    })
    process.env.SKIP_MARKET_HOURS_CHECK = prev ?? 'true'

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('MARKET_CLOSED')
  })

  it('returns 400 when broker account is missing', async () => {
    const brokerService = (await import('../services/brokerService.js')).default
    vi.mocked(brokerService.getBrokerAccountInternal).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/api/trade',
      payload: { symbol: 'AAPL', direction: 'BUY', quantity: 1, price: 150 }
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/broker account/i)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/trade',
      payload: { symbol: 'AAPL' }
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/trade/:id', () => {
  it('returns execution details', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/trade/exe_test123'
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.execution.id).toBe('exe_test123')
    expect(body.execution.status).toBe('queued')
    expect(body.execution.symbol).toBe('AAPL')
  })

  it('returns 404 when execution does not exist', async () => {
    const prisma = (await import('../loaders/prisma.js')).default
    vi.mocked(prisma.execution.findUnique).mockResolvedValueOnce(null)

    const res = await app.inject({ method: 'GET', url: '/api/trade/exe_missing' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 403 when execution belongs to another user', async () => {
    const prisma = (await import('../loaders/prisma.js')).default
    vi.mocked(prisma.execution.findUnique).mockResolvedValueOnce({ ...mockExecution, userId: 'usr_other' })

    const res = await app.inject({ method: 'GET', url: '/api/trade/exe_test123' })
    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /api/trade/:id', () => {
  it('records a cancel request and returns 202', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/trade/exe_test123' })
    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(body.status).toBe('cancel_requested')
    expect(body.success).toBe(true)
  })

  it('returns 409 when execution is already in a terminal state', async () => {
    const prisma = (await import('../loaders/prisma.js')).default
    vi.mocked(prisma.execution.findUnique).mockResolvedValueOnce({ ...mockExecution, status: 'filled' })

    const res = await app.inject({ method: 'DELETE', url: '/api/trade/exe_test123' })
    expect(res.statusCode).toBe(409)
  })

  it('returns 404 when execution does not exist', async () => {
    const prisma = (await import('../loaders/prisma.js')).default
    vi.mocked(prisma.execution.findUnique).mockResolvedValueOnce(null)

    const res = await app.inject({ method: 'DELETE', url: '/api/trade/exe_missing' })
    expect(res.statusCode).toBe(404)
  })
})
