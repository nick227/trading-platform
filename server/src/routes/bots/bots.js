import botsService from '../../services/botsService.js'
import prisma from '../../loaders/prisma.js'

export default async function botsRoutes(app, opts) {
  // GET /api/bots
  app.get('/', async (request, reply) => {
    const result = await botsService.getBots({ ...request.query, userId: request.user.id })
    return reply.send(result)
  })

  // GET /api/bots/:id
  app.get('/:id', async (request, reply) => {
    const { id } = request.params
    const bot = await botsService.getBot(id)
    if (!bot || bot.userId !== request.user.id) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
    }
    return { data: bot }
  })

  // POST /api/bots
  // strategyId is required for strategy_based bots, optional for rule_based.
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'portfolioId'],
        properties: {
          name:        { type: 'string', minLength: 1 },
          portfolioId: { type: 'string' },
          strategyId:  { type: 'string' },
          botType:     { type: 'string', enum: ['rule_based', 'strategy_based'] },
          enabled:     { type: 'boolean' },
          config:      { type: 'object' },
          userId:      { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const portfolio = await prisma.portfolio.findUnique({ where: { id: request.body.portfolioId } })
    if (!portfolio || portfolio.userId !== request.user.id) {
      return reply.code(400).send({ error: { code: 'INVALID_PORTFOLIO', message: 'Invalid portfolioId' } })
    }

    const bot = await botsService.createBot({ ...request.body, userId: request.user.id })
    return reply.code(201).send({ data: bot })
  })

  app.put('/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' },
          config: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    try {
      const existing = await botsService.getBot(id)
      if (!existing || existing.userId !== request.user.id) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
      }

      const bot = await botsService.updateBot(id, request.body)
      return { data: bot }
    } catch (error) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
      }
      throw error
    }
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params
    try {
      const existing = await botsService.getBot(id)
      if (!existing || existing.userId !== request.user.id) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
      }
      await botsService.deleteBot(id)
      return reply.code(204).send()
    } catch (error) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
      }
      throw error
    }
  })
}
