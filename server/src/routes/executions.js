import executionsService from '../services/executionsService.js'

export default async function executionsRoutes(app, opts) {
  // GET /api/executions/summary - must come before /:id
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
    const { id } = request.params
    const execution = await executionsService.getExecution(id)
    if (!execution) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Execution not found' } })
    }
    return { data: execution }
  })

  // POST /api/executions
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['userId', 'ticker', 'direction', 'quantity', 'price', 'portfolioId', 'strategyId'],
        properties: {
          userId: { type: 'string' },
          ticker: { type: 'string' },
          direction: { enum: ['buy', 'sell'] },
          quantity: { type: 'number', minimum: 0 },
          price: { type: 'number', minimum: 0 },
          portfolioId: { type: 'string' },
          strategyId: { type: 'string' },
          predictionId: { type: 'string' },
          botId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const execution = await executionsService.createExecution(request.body)
    return reply.code(201).send({ data: execution })
  })
}
