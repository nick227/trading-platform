import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { authenticate } from '../middleware/authenticate.js'
import brokerService from '../services/brokerService.js'
import executionsService from '../services/executionsService.js'
import { fetchAlpacaMarketClock, resolveAlpacaCredentials } from '../services/alpacaClockService.js'

const TERMINAL_STATUSES = new Set(['filled', 'cancelled', 'failed'])

async function getOrCreateDefaultPortfolioId(userId) {
  const existing = await prisma.portfolio.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true }
  })
  if (existing) return existing.id

  const created = await prisma.portfolio.create({
    data: {
      id: generateId(ID_PREFIXES.PORTFOLIO),
      userId,
      name: 'Main Portfolio'
    },
    select: { id: true }
  })
  return created.id
}

export default async function tradeRoutes(app, opts) {
  // POST /api/trade - Intent endpoint: enqueue an Execution row only.
  // The worker owns broker submission, retries/reconciliation, and auditing.
  app.post('/', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['symbol', 'direction', 'quantity', 'price'],
        properties: {
          symbol: { type: 'string' },
          direction: { type: 'string', enum: ['BUY', 'SELL'] },
          quantity: { type: 'number', minimum: 1 },
          price: { type: 'number', minimum: 0.01 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { symbol, direction, quantity, price } = request.body
      const userId = request.user.id

      // Validate trade parameters
      if (!symbol || !direction || !quantity || !price) {
        return reply.code(400).send({ error: 'Missing required trade parameters' })
      }

      // Optional fast-fail: if no broker account exists, the worker will cancel the job anyway.
      // Keeping this as a user-facing validation gives clearer UX.
      const brokerAccount = await brokerService.getBrokerAccountInternal(userId)
      if (!brokerAccount) {
        return reply.code(400).send({ error: 'No broker account configured' })
      }

      let creds
      try {
        creds = await resolveAlpacaCredentials(userId)
      } catch (err) {
        if (err?.code === 'LIVE_TRADING_DISABLED') return reply.code(403).send({ error: err.message })
        throw err
      }
      if (!creds) return reply.code(503).send({ error: 'Alpaca credentials not configured' })

      const clock = await fetchAlpacaMarketClock(creds)
      if (!clock.isOpen) {
        return reply.code(409).send({ error: 'Market is closed', code: 'MARKET_CLOSED', clock })
      }

      const portfolioId = await getOrCreateDefaultPortfolioId(userId)

      const normalizedDirection = direction.toLowerCase() === 'buy' ? 'buy' : 'sell'
      const normalizedTicker = symbol.toUpperCase()
      const normalizedQuantity = Number(quantity)
      const normalizedPrice = Number(price)

      const commission = Math.max(normalizedQuantity * normalizedPrice * 0.001, 1.95)
      const fees = normalizedQuantity * normalizedPrice * 0.0005

      const execution = await executionsService.createExecution({
        userId,
        portfolioId,
        ticker: normalizedTicker,
        direction: normalizedDirection,
        quantity: normalizedQuantity,
        price: normalizedPrice,
        commission,
        fees
      })

      // Receipt response: queued intent. Broker submission happens asynchronously in the worker.
      return reply.code(201).send({
        execution: {
          id: execution.id,
          symbol: execution.ticker,
          direction: execution.direction.toUpperCase(),
          quantity: execution.quantity,
          price: execution.price,
          status: execution.status, // queued
          alpacaOrderId: execution.brokerOrderId ?? null,
          submittedAt: execution.submittedAt ?? null
        }
      })
    } catch (error) {
      console.error('Trade execution error:', error)
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/trade/:id - Get execution status
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params

      const execution = await prisma.execution.findUnique({ where: { id } })

      if (!execution) {
        return reply.code(404).send({ error: 'Execution not found' })
      }

      if (execution.userId !== request.user.id) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      return reply.send({
        execution: {
          id: execution.id,
          symbol: execution.ticker,
          direction: execution.direction.toUpperCase(),
          quantity: execution.quantity,
          price: execution.price,
          status: execution.status,
          cancelRequestedAt: execution.cancelRequestedAt ?? null,
          cancelRequestedBy: execution.cancelRequestedBy ?? null,
          cancelRequestReason: execution.cancelRequestReason ?? null,
          filledPrice: execution.filledPrice,
          filledAt: execution.filledAt,
          alpacaOrderId: execution.brokerOrderId,
          submittedAt: execution.submittedAt,
          commission: execution.commission,
          pnl: execution.pnl,
          error: null
        },
        alpacaStatus: null
      })
    } catch (error) {
      console.error('Get execution status error:', error)
      return reply.code(500).send({ error: error.message })
    }
  })

  // DELETE /api/trade/:id - Cancel intent (best-effort without broker calls).
  // This endpoint never talks to the broker. It records a cancel request and returns immediately.
  // The worker owns broker-side cancellation + reconciliation.
  app.delete('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params
      const { reason } = request.query ?? {}
      const userId = request.user.id

      const execution = await prisma.execution.findUnique({
        where: { id }
      })

      if (!execution) {
        return reply.code(404).send({ error: 'Execution not found' })
      }

      if (execution.userId !== userId) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      if (TERMINAL_STATUSES.has(execution.status)) {
        return reply.code(409).send({ error: 'Order is already terminal', status: execution.status })
      }

      const now = new Date()
      await prisma.execution.update({
        where: { id },
        data: {
          cancelRequestedAt: now,
          cancelRequestedBy: userId,
          cancelRequestReason: typeof reason === 'string' && reason.length ? reason : null
        }
      })

      await prisma.executionAudit.create({
        data: {
          id: generateId(ID_PREFIXES.AUDIT),
          executionId: execution.id,
          userId: execution.userId,
          eventType: 'cancel_requested',
          detail: 'User requested cancellation',
          metadata: {
            requestedAt: now.toISOString(),
            requestedBy: userId,
            reason: typeof reason === 'string' && reason.length ? reason : null
          }
        }
      })

      return reply.code(202).send({
        success: true,
        status: 'cancel_requested',
        message: 'Cancel requested. Pending broker confirmation.'
      })
    } catch (error) {
      console.error('Cancel order error:', error)
      return reply.code(500).send({ error: error.message })
    }
  })
}

