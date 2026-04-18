import botsService from '../../services/botsService.js'

export default async function botEventsRoutes(app, opts) {
  // GET /api/bots/:id/events
  app.get('/', async (request, reply) => {
    const { id } = request.params
    const result = await botsService.getBotEvents({ ...request.query, botId: id })
    return reply.send(result)
  })

  // POST /api/bots/events
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['botId', 'portfolioId', 'type', 'detail'],
        properties: {
          botId: { type: 'string' },
          portfolioId: { type: 'string' },
          ruleId: { type: 'string' },
          executionId: { type: 'string' },
          type: { 
            type: 'string', 
            enum: ['rule_triggered', 'decision_made', 'execution_created', 'execution_skipped', 'error_occurred'] 
          },
          detail: { type: 'string' },
          metadata: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    const event = await botsService.createBotEvent(request.body)
    return reply.code(201).send({ data: event })
  })
}
