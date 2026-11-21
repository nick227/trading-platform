import botsService from '../../services/botsService.js'
import prisma from '../../loaders/prisma.js'

export default async function botEventsRoutes(app, opts) {
  // GET /api/bots/:id/events
  app.get('/', async (request, reply) => {
    const { id } = request.params

    const bot = await prisma.bot.findFirst({ where: { id } })
    if (!bot || bot.userId !== request.user.id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    }

    const result = await botsService.getBotEvents(id, request.query)
    return reply.send(result)
  })

  // POST /api/bots/:id/events
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['portfolioId', 'type', 'detail'],
        properties: {
          botId: { type: 'string' },
          portfolioId: { type: 'string' },
          ruleId: { type: 'string' },
          executionId: { type: 'string' },
          type: { 
            type: 'string', 
            enum: [
              'rule_triggered',
              'decision_made',
              'execution_created',
              'execution_skipped',
              'error_occurred',
              'strategy_error',
              'signal_hold',
              'execution_blocked_by_risk',
              'execution_failed',
              'risk_evaluation_failed',
              'bot_paused',
              'bot_resumed',
              'bot_stopped'
            ] 
          },
          detail: { type: 'string' },
          metadata: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    const botId = request.body.botId || request.params.id
    const bot = await prisma.bot.findFirst({ where: { id: botId } })
    if (!bot || bot.userId !== request.user.id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    }

    const event = await botsService.createBotEvent({
      ...request.body,
      botId,
      portfolioId: request.body.portfolioId || bot.portfolioId
    })
    return reply.code(201).send({ data: event })
  })
}
