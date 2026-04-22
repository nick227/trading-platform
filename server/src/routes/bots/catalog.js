import botsService from '../../services/botsService.js'
import prisma from '../../loaders/prisma.js'

export default async function catalogRoutes(app, opts) {
  // GET /api/bots/catalog
  // Returns all bot templates. Optional ?botType=rule_based|strategy_based filter.
  app.get('/', async (request, reply) => {
    const templates = await botsService.getCatalog(request.query)
    return { data: templates }
  })

  // GET /api/bots/catalog/:id
  app.get('/:id', async (request, reply) => {
    const template = await botsService.getCatalogTemplate(request.params.id)
    if (!template) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Template not found' } })
    }
    return { data: template }
  })

  // POST /api/bots/from-template
  // Instantiate a bot from a template. Rules are copied into BotRule rows.
  // The template itself is never mutated — bots own their rules forever.
  app.post('/from-template', {
    schema: {
      body: {
        type: 'object',
        required: ['templateId', 'portfolioId'],
        properties: {
          templateId:  { type: 'string' },
          portfolioId: { type: 'string' },
          strategyId:  { type: 'string' },   // required for strategy_based bots
          userId:      { type: 'string' },
          name:        { type: 'string' },
          tickers:     { type: 'array', items: { type: 'string' } },
          quantity:    { type: 'number', minimum: 1 },
          enabled:     { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const portfolio = await prisma.portfolio.findUnique({ where: { id: request.body.portfolioId } })
    if (!portfolio || portfolio.userId !== request.user.id) {
      return reply.code(400).send({ error: { code: 'INVALID_PORTFOLIO', message: 'Invalid portfolioId' } })
    }

    const bot = await botsService.createBotFromTemplate({ ...request.body, userId: request.user.id })
    if (!bot) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Template not found' } })
    }
    return reply.code(201).send({ data: bot })
  })
}
