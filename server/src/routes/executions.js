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
}
