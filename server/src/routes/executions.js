import executionsService from '../services/executionsService.js'
import { authenticate } from '../middleware/authenticate.js'

export default async function executionsRoutes(app) {
  // GET /api/executions/summary — must precede /:id
  app.get('/summary', async (request, reply) => {
    const summary = await executionsService.getExecutionSummary(request.query)
    return reply.send({ data: summary })
  })

  // GET /api/executions
  app.get('/', async (request, reply) => {
    const result = await executionsService.getExecutions(request.query)
    return reply.send(result)
  })

  // GET /api/executions/:id
  app.get('/:id', async (request, reply) => {
    const execution = await executionsService.getExecution(request.params.id)
    if (!execution) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Execution not found' } })
    }
    return { data: execution }
  })

  // POST /api/executions — requires auth; userId is taken from JWT, not body
  app.post('/', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['ticker', 'direction', 'quantity', 'price', 'portfolioId'],
        properties: {
          ticker:      { type: 'string' },
          direction:   { enum: ['buy', 'sell'] },
          quantity:    { type: 'number', minimum: 0 },
          price:       { type: 'number', minimum: 0 },
          portfolioId: { type: 'string' },
          strategyId:  { type: 'string' },
          predictionId: { type: 'string' },
          botId:       { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const execution = await executionsService.createExecution({
      ...request.body,
      userId: request.user.id
    })
    return reply.code(201).send({ data: execution })
  })

  // POST /api/executions/:id/cancel â€” requires auth; only owner may cancel queued/processing executions
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
