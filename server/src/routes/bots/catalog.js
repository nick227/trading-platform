import botsService from '../../services/botsService.js'
import { getEmergencyStop } from '../../services/emergencyStopService.js'
import prisma from '../../loaders/prisma.js'
import { getUserAlpacaCredentialsOrThrow } from '../../services/alpacaClockService.js'
import { simulationConfig } from '../../services/simulationService.js'

export default async function catalogRoutes(app, opts) {
  // GET /api/bots/catalog
  // Returns all bot templates grouped by type. Optional ?botType=rule_based|strategy_based filter.
  app.get('/', async (request, reply) => {
    const templates = await botsService.getCatalog(request.query)
    
    // Group templates by botType as expected by frontend
    const grouped = {
      ruleBased: templates.filter(t => t.botType === 'rule_based'),
      strategyBased: templates.filter(t => t.botType === 'strategy_based')
    }
    
    return { data: grouped }
  })

  // GET /api/bots/catalog/:id
  app.get('/:id', async (request, reply) => {
    const template = await botsService.getCatalogTemplate(request.params.id)
    if (!template) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Template not found' } })
    }
    return { data: template }
  })

  // POST /api/bots/catalog/from-template
  // Instantiate a bot from a template atomically. Rules are copied into BotRule rows.
  // The template itself is never mutated — bots own their rules forever.
  app.post('/from-template', {
    schema: {
      body: {
        type: 'object',
        required: ['templateId', 'portfolioId'],
        properties: {
          templateId:       { type: 'string' },
          portfolioId:      { type: 'string' },
          strategyId:       { type: 'string' },
          userId:           { type: 'string' },
          name:             { type: 'string' },
          tickers:          { type: 'array', items: { type: 'string' } },
          quantity:         { type: 'number', minimum: 1 },
          capital:          { type: 'number', minimum: 0.01 },
          allocatedAmount:  { type: 'number', minimum: 0.01 },
          maxPerOrder:      { type: 'number', minimum: 0.01 },
          maxOrderNotional: { type: 'number', minimum: 0.01 },
          capitalMode:      { type: 'string', enum: ['allocated', 'legacy'] },
          direction:        { type: 'string', enum: ['buy', 'sell'] },
          riskOnExposure:   { type: 'number', minimum: 0 },
          enabled:          { type: 'boolean' },
          config:           { type: 'object' },
          rules:            { type: 'array' }
        }
      }
    }
  }, async (request, reply) => {
    if (request.body?.enabled === true && (await getEmergencyStop(request.user.id)).active) {
      return reply.code(403).send({ error: { code: 'EMERGENCY_STOP_ACTIVE', message: 'Emergency stop is active. Create the bot paused or clear the stop first.' } })
    }

    try {
      if (!simulationConfig().enabled) await getUserAlpacaCredentialsOrThrow(request.user.id)
    } catch (error) {
      if (error?.code === 'BROKER_NOT_CONFIGURED' || error?.code === 'BROKER_CREDENTIALS_INVALID') {
        return reply.code(403).send({ error: { code: error.code, message: error.message } })
      }
      if (error?.code === 'LIVE_TRADING_DISABLED') {
        return reply.code(403).send({ error: { code: error.code, message: error.message } })
      }
      throw error
    }

    const portfolio = await prisma.portfolio.findUnique({ where: { id: request.body.portfolioId } })
    if (!portfolio || portfolio.userId !== request.user.id) {
      return reply.code(400).send({ error: { code: 'INVALID_PORTFOLIO', message: 'Invalid portfolioId' } })
    }

    try {
      const bot = await botsService.createBotFromTemplate({ ...request.body, userId: request.user.id })
      if (!bot) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Template not found' } })
      }
      return reply.code(201).send({ data: bot })
    } catch (error) {
      if (error.statusCode === 400) {
        return reply.code(400).send({ error: { code: 'INVALID_CONFIG', message: error.message } })
      }
      throw error
    }
  })
}
