import prisma from '../loaders/prisma.js'
import executionsService from '../services/executionsService.js'
import { getExecutionResearch } from '../services/executionResearchService.js'
import { authenticate } from '../middleware/authenticate.js'
import { fetchAlpacaMarketClock, getUserAlpacaCredentialsOrThrow } from '../services/alpacaClockService.js'

export default async function executionsRoutes(app) {
  // GET /api/executions/summary — must precede /:id, authenticated and user-scoped
  app.get('/summary', { preHandler: [authenticate] }, async (request, reply) => {
    const summary = await executionsService.getExecutionSummary({
      ...request.query,
      userId: request.user.id
    })
    return reply.send({ data: summary })
  })

  // GET /api/executions — authenticated and strictly user-scoped
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const result = await executionsService.getExecutions({
      ...request.query,
      userId: request.user.id
    })
    return reply.send(result)
  })

  // GET /api/executions/:id — authenticated and strictly user-scoped
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const execution = await executionsService.getExecution(request.params.id)
    if (!execution || execution.userId !== request.user.id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Execution not found' } })
    }
    return { data: execution }
  })

  // GET /api/executions/:id/research — archived, verified decision evidence.
  app.get('/:id/research', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      return { data: await getExecutionResearch({ userId: request.user.id, executionId: request.params.id }) }
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Execution not found' } })
      }
      throw err
    }
  })

  // POST /api/executions — requires auth; userId is taken from JWT, not body
  app.post('/', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['ticker', 'direction', 'quantity', 'price', 'portfolioId'],
        properties: {
          ticker: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9.\\-]{0,19}
          portfolioId: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    let creds
    try {
      creds = await getUserAlpacaCredentialsOrThrow(request.user.id)
    } catch (err) {
      if (err?.code === 'LIVE_TRADING_DISABLED') {
        return reply.code(403).send({ error: { code: 'LIVE_TRADING_DISABLED', message: err.message } })
      }
      if (err?.code === 'BROKER_NOT_CONFIGURED' || err?.code === 'BROKER_CREDENTIALS_INVALID') {
        return reply.code(403).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }

    if (creds.paper !== true) {
      return reply.code(403).send({ error: { code: 'PAPER_ONLY', message: 'Paper trading account required' } })
    }

    const clock = await fetchAlpacaMarketClock(creds)
    if (!clock.isOpen) {
      return reply.code(409).send({ error: { code: 'MARKET_CLOSED', message: 'Market is closed', clock } })
    }

    // A manual API request cannot impersonate an automated bot decision.
    // Check ownership before creating any execution intent.
    const portfolio = await prisma.portfolio.findFirst({
      where: { id: request.body.portfolioId, userId: request.user.id },
      select: { id: true }
    })
    if (!portfolio) {
      return reply.code(404).send({ error: { code: 'PORTFOLIO_NOT_FOUND', message: 'Portfolio not found' } })
    }

    // A paper broker account is mandatory for the personal pilot. Never
    // enqueue orders against an account configured for live execution.
    const execution = await executionsService.createExecution({
      userId: request.user.id,
      portfolioId: portfolio.id,
      ticker: request.body.ticker.toUpperCase(),
      direction: request.body.direction,
      quantity: request.body.quantity,
      price: request.body.price,
      commission: 0,
      fees: 0
    })
    return reply.code(201).send({ data: execution })
  })

  // POST /api/executions/:id/cancel — requires auth; only owner may cancel queued/processing executions
  app.post('/:id/cancel', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const updated = await executionsService.cancelExecution(request.params.id, request.user.id)
      if (!updated) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Execution not found' } })
      }
      return reply.send({ data: updated })
    } catch (err) {
      if (err?.code === 'FORBIDDEN') {
        return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Not allowed to cancel this execution' } })
      }
      if (err?.code === 'NOT_CANCELLABLE') {
        return reply.code(409).send({ error: { code: 'NOT_CANCELLABLE', message: err.message } })
      }
      return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Failed to cancel execution' } })
    }
  })
}
 },
          direction: { type: 'string', enum: ['buy', 'sell'] },
          quantity: { type: 'number', exclusiveMinimum: 0 },
          price: { type: 'number', exclusiveMinimum: 0 },
          portfolioId: { type: 'string' },
          strategyId: { type: 'string' },
          predictionId: { type: 'string' },
          botId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    let creds
    try {
      creds = await getUserAlpacaCredentialsOrThrow(request.user.id)
    } catch (err) {
      if (err?.code === 'LIVE_TRADING_DISABLED') {
        return reply.code(403).send({ error: { code: 'LIVE_TRADING_DISABLED', message: err.message } })
      }
      if (err?.code === 'BROKER_NOT_CONFIGURED' || err?.code === 'BROKER_CREDENTIALS_INVALID') {
        return reply.code(403).send({ error: { code: err.code, message: err.message } })
      }
      throw err
    }

    const clock = await fetchAlpacaMarketClock(creds)
    if (!clock.isOpen) {
      return reply.code(409).send({ error: { code: 'MARKET_CLOSED', message: 'Market is closed', clock } })
    }

    const execution = await executionsService.createExecution({
      ...request.body,
      userId: request.user.id
    })
    return reply.code(201).send({ data: execution })
  })

  // POST /api/executions/:id/cancel — requires auth; only owner may cancel queued/processing executions
  app.post('/:id/cancel', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const updated = await executionsService.cancelExecution(request.params.id, request.user.id)
      if (!updated) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Execution not found' } })
      }
      return reply.send({ data: updated })
    } catch (err) {
      if (err?.code === 'FORBIDDEN') {
        return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Not allowed to cancel this execution' } })
      }
      if (err?.code === 'NOT_CANCELLABLE') {
        return reply.code(409).send({ error: { code: 'NOT_CANCELLABLE', message: err.message } })
      }
      return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Failed to cancel execution' } })
    }
  })
}
