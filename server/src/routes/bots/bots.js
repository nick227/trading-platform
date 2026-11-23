import botsService from '../../services/botsService.js'
import { getEmergencyStop } from '../../services/emergencyStopService.js'
import prisma from '../../loaders/prisma.js'
import { getUserAlpacaCredentialsOrThrow } from '../../services/alpacaClockService.js'
import { simulationConfig } from '../../services/simulationService.js'
import { BotSaveError, saveBot } from '../../services/botConfigService.js'

async function ensureBrokerConnectedOrReply(userId, reply) {
  // Simulator mode needs no broker: orders are filled by the internal replay simulator.
  if (simulationConfig().enabled) return true
  try {
    await getUserAlpacaCredentialsOrThrow(userId)
    return true
  } catch (error) {
    if (error?.code === 'BROKER_NOT_CONFIGURED' || error?.code === 'BROKER_CREDENTIALS_INVALID') {
      reply.code(403).send({ error: { code: error.code, message: error.message } })
      return false
    }
    if (error?.code === 'LIVE_TRADING_DISABLED') {
      reply.code(403).send({ error: { code: error.code, message: error.message } })
      return false
    }
    throw error
  }
}

/** Throwing form of the broker check, for the unified save. */
async function ensureBroker(userId) {
  if (simulationConfig().enabled) return
  try {
    await getUserAlpacaCredentialsOrThrow(userId)
  } catch (error) {
    if (['BROKER_NOT_CONFIGURED', 'BROKER_CREDENTIALS_INVALID', 'LIVE_TRADING_DISABLED'].includes(error?.code)) throw new BotSaveError(403, error.code, error.message)
    throw error
  }
}

async function handleSave(request, reply, input) {
  try {
    const { bot, changes, created } = await saveBot(request.user.id, input, { ensureBroker })
    return reply.code(created ? 201 : 200).send({ data: bot, changes })
  } catch (error) {
    if (error instanceof BotSaveError) return reply.code(error.status).send({ error: { code: error.code, message: error.message, ...error.extra } })
    throw error
  }
}

const SAVE_BODY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    templateId:        { type: 'string' },
    portfolioId:       { type: 'string' },
    name:              { type: 'string' },
    enabled:           { type: 'boolean' },
    config:            { type: 'object' },
    rules:             { type: 'array', items: { type: 'object' } },
    expectedUpdatedAt: { type: 'string' }
  }
}

export default async function botsRoutes(app, opts) {
  // Unified, transactional save of a bot and its rules (see services/botConfigService.js).
  // POST creates; PUT updates. `config` is a deep-merge patch; `rules`, when sent, is the full set.
  app.post('/configuration', { schema: { body: { ...SAVE_BODY, required: ['portfolioId'] } } }, async (request, reply) =>
    handleSave(request, reply, request.body))
  app.put('/:id/configuration', { schema: { body: SAVE_BODY } }, async (request, reply) =>
    handleSave(request, reply, { ...request.body, id: request.params.id }))

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
    const connected = await ensureBrokerConnectedOrReply(request.user.id, reply)
    if (!connected) return

    const portfolio = await prisma.portfolio.findUnique({ where: { id: request.body.portfolioId } })
    if (!portfolio || portfolio.userId !== request.user.id) {
      return reply.code(400).send({ error: { code: 'INVALID_PORTFOLIO', message: 'Invalid portfolioId' } })
    }

    try {
      const bot = await botsService.createBot({ ...request.body, userId: request.user.id })
      return reply.code(201).send({ data: bot })
    } catch (error) {
      if (error.statusCode === 400) {
        return reply.code(400).send({ error: { code: 'INVALID_CONFIG', message: error.message } })
      }
      throw error
    }
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

      if (request.body?.enabled === true) {
        const stop = await getEmergencyStop(request.user.id)
        if (stop.active) {
          return reply.code(403).send({ error: { code: 'EMERGENCY_STOP_ACTIVE', message: 'Emergency stop is active. Clear it before resuming bots.' } })
        }
        const connected = await ensureBrokerConnectedOrReply(request.user.id, reply)
        if (!connected) return
      }

      const bot = await botsService.updateBot(id, request.body)
      return { data: bot }
    } catch (error) {
      if (error.statusCode === 400) {
        return reply.code(400).send({ error: { code: 'INVALID_CONFIG', message: error.message } })
      }
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
