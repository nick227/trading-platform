import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('../../src/middleware/authenticate.js', () => ({
  authenticate: vi.fn(async (request) => {
    request.user = { id: 'usr_p0_test' }
  })
}))

const mockPrisma = vi.hoisted(() => ({
  brokerAccount: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn()
  },
  portfolio: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn()
  },
  execution: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([])
  },
  executionAudit: {
    create: vi.fn()
  },
  tradeMetricFact: {
    findMany: vi.fn().mockResolvedValue([])
  },
  $queryRaw: vi.fn().mockResolvedValue([{ total_executions: 0, executions_with_facts: 0, missing_facts: 0 }]),
  $disconnect: vi.fn()
}))

vi.mock('../../src/loaders/prisma.js', () => ({
  default: mockPrisma
}))

import alpacaRoutes from '../../src/routes/alpaca.js'
import brokerRoutes from '../../src/routes/broker.js'
import accountRoutes from '../../src/routes/account.js'
import tradeRoutes from '../../src/routes/trade.js'
import executionsRoutes from '../../src/routes/executions.js'
import { encrypt } from '../../src/utils/encryption.js'
import { runBackfillReconciler } from '../../src/jobs/backfillReconcilerJob.js'

describe('P0 — Execution Containment & Disabled Live-Trading Invariants', () => {
  let app
  const origFetch = global.fetch
  const origAllowLive = process.env.ALLOW_LIVE_TRADING

  beforeAll(async () => {
    app = Fastify()
    await app.register(alpacaRoutes, { prefix: '/api/alpaca' })
    await app.register(brokerRoutes, { prefix: '/api/broker' })
    await app.register(accountRoutes, { prefix: '/api/account' })
    await app.register(tradeRoutes, { prefix: '/api/trade' })
    await app.register(executionsRoutes, { prefix: '/api/executions' })
    await app.ready()
  })

  afterAll(async () => {
    global.fetch = origFetch
    if (origAllowLive === undefined) delete process.env.ALLOW_LIVE_TRADING
    else process.env.ALLOW_LIVE_TRADING = origAllowLive
    await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ALLOW_LIVE_TRADING
    global.fetch = vi.fn()
  })

  it('blocks direct unaudited POST /api/alpaca/order and DELETE /api/alpaca/order/:id without network calls', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/alpaca/order',
      payload: { symbol: 'AAPL', side: 'buy', quantity: 5, type: 'market' }
    })
    expect(postRes.statusCode).toBe(410)
    expect(postRes.json().code).toBe('DIRECT_BROKER_EXECUTION_RETIRED')

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/alpaca/order/ord_direct_1'
    })
    expect(delRes.statusCode).toBe(410)
    expect(delRes.json().code).toBe('DIRECT_BROKER_EXECUTION_RETIRED')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects saving live brokerage credentials (paper=false) on both /api/broker and /api/account/broker-credentials', async () => {
    const brokerRes = await app.inject({
      method: 'POST',
      url: '/api/broker',
      payload: { apiKey: 'AKLIVE123', apiSecret: 'SKLIVE456', paper: false }
    })
    expect(brokerRes.statusCode).toBe(403)
    expect(brokerRes.json().error.code).toBe('LIVE_TRADING_DISABLED')

    const accountRes = await app.inject({
      method: 'POST',
      url: '/api/account/broker-credentials',
      payload: { apiKey: 'AKLIVE123', apiSecret: 'SKLIVE456', paper: false }
    })
    expect(accountRes.statusCode).toBe(403)
    expect(accountRes.json().code).toBe('LIVE_TRADING_DISABLED')

    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockPrisma.brokerAccount.upsert).not.toHaveBeenCalled()
  })

  it('prevents manual external brokerage trades from attaching to default_simulated_paper portfolios', async () => {
    mockPrisma.brokerAccount.findUnique.mockResolvedValue({
      id: 'brk_p0',
      userId: 'usr_p0_test',
      apiKey: encrypt('PKPAPER123'),
      apiSecret: encrypt('SKPAPER456'),
      paper: true,
      status: 'active'
    })
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        is_open: true,
        next_open: '2026-11-30T14:30:00Z',
        next_close: '2026-11-30T21:00:00Z',
        timestamp: '2026-11-30T15:00:00Z'
      })
    })

    // Explicit simulated paper portfolio is rejected with 409 PORTFOLIO_ENVIRONMENT_MISMATCH
    mockPrisma.portfolio.findUnique.mockResolvedValueOnce({
      id: 'prt_paper_usr_p0_test',
      userId: 'usr_p0_test',
      accountKind: 'default_simulated_paper'
    })
    const mismatchTrade = await app.inject({
      method: 'POST',
      url: '/api/trade',
      payload: {
        symbol: 'MSFT',
        direction: 'BUY',
        quantity: 2,
        price: 410,
        portfolioId: 'prt_paper_usr_p0_test'
      }
    })
    expect(mismatchTrade.statusCode).toBe(409)
    expect(mismatchTrade.json().code).toBe('PORTFOLIO_ENVIRONMENT_MISMATCH')

    mockPrisma.portfolio.findFirst.mockResolvedValueOnce({
      id: 'prt_paper_usr_p0_test',
      userId: 'usr_p0_test',
      accountKind: 'default_simulated_paper'
    })
    const mismatchExec = await app.inject({
      method: 'POST',
      url: '/api/executions',
      payload: {
        ticker: 'MSFT',
        direction: 'buy',
        quantity: 2,
        price: 410,
        portfolioId: 'prt_paper_usr_p0_test'
      }
    })
    expect(mismatchExec.statusCode).toBe(409)
    expect(mismatchExec.json().error.code).toBe('PORTFOLIO_ENVIRONMENT_MISMATCH')
    expect(mockPrisma.execution.create).not.toHaveBeenCalled()
  })

  it('never disconnects the shared Prisma client during backfillReconcilerJob', async () => {
    await runBackfillReconciler()
    expect(mockPrisma.$disconnect).not.toHaveBeenCalled()
  })
})
