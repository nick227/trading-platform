import prisma from '../../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../../utils/idGenerator.js'

export default async function botRulesRoutes(app, opts) {
  async function assertBotOwned(botId, request, reply) {
    const bot = await prisma.bot.findFirst({ where: { id: botId, deletedAt: null } })
    if (!bot || bot.userId !== request.user.id) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot not found' } })
      return null
    }
    return bot
  }

  // GET /api/bots/:id/rules
  app.get('/', async (request, reply) => {
    const { id: botId } = request.params
    const { type, enabled, offset = 0, limit = 50 } = request.query

    const bot = await assertBotOwned(botId, request, reply)
    if (!bot) return

    const take = Math.min(parseInt(limit), 100)
    const skip = Math.max(parseInt(offset), 0)

    const where = { botId }
    if (type) where.type = type
    if (enabled !== undefined) where.enabled = enabled === 'true'

    const rules = await prisma.botRule.findMany({
      where,
      include: {
        bot: {
          select: { id: true, name: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip
    })

    const total = await prisma.botRule.count({ where })

    return {
      data: rules,
      pagination: {
        total,
        hasMore: skip + take < total,
        nextOffset: skip + take < total ? skip + take : null
      }
    }
  })

  // GET /api/bots/:id/rules/:ruleId
  app.get('/:ruleId', async (request, reply) => {
    const { id: botId, ruleId } = request.params

    const bot = await assertBotOwned(botId, request, reply)
    if (!bot) return

    const rule = await prisma.botRule.findUnique({
      where: { id: ruleId },
      include: { bot: true }
    })

    if (!rule || rule.botId !== botId) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot rule not found' } })
    }

    return { data: rule }
  })

  // POST /api/bots/:id/rules
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', minLength: 1 },
          type: {
            type: 'string',
            enum: ['price_threshold', 'position_limit', 'daily_loss', 'market_hours', 'cooldown', 'trend_filter', 'time_window']
          },
          config: { type: 'object' },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { id: botId } = request.params

    const bot = await assertBotOwned(botId, request, reply)
    if (!bot) return

    const rule = await prisma.botRule.create({
      data: {
        id: generateId(ID_PREFIXES.RULE),
        botId,
        ...request.body,
        enabled: request.body.enabled ?? true
      }
    })
    return reply.code(201).send({ data: rule })
  })

  // PUT /api/bots/:id/rules/:ruleId
  app.put('/:ruleId', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          type: {
            type: 'string',
            enum: ['price_threshold', 'position_limit', 'daily_loss', 'market_hours', 'cooldown', 'trend_filter', 'time_window']
          },
          config: { type: 'object' },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { id: botId, ruleId } = request.params

    const bot = await assertBotOwned(botId, request, reply)
    if (!bot) return

    const existing = await prisma.botRule.findUnique({ where: { id: ruleId } })
    if (!existing || existing.botId !== botId) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot rule not found' } })
    }

    try {
      const rule = await prisma.botRule.update({
        where: { id: ruleId },
        data: {
          ...request.body,
          updatedAt: new Date()
        }
      })
      return { data: rule }
    } catch (error) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot rule not found' } })
      }
      throw error
    }
  })

  // DELETE /api/bots/:id/rules/:ruleId
  app.delete('/:ruleId', async (request, reply) => {
    const { id: botId, ruleId } = request.params

    const bot = await assertBotOwned(botId, request, reply)
    if (!bot) return

    const existing = await prisma.botRule.findUnique({ where: { id: ruleId } })
    if (!existing || existing.botId !== botId) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot rule not found' } })
    }

    try {
      await prisma.botRule.delete({ where: { id: ruleId } })
      return reply.code(204).send()
    } catch (error) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot rule not found' } })
      }
      throw error
    }
  })
}
