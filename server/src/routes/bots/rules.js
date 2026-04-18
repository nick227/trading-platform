import prisma from '../../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../../utils/idGenerator.js'

export default async function botRulesRoutes(app, opts) {
  // GET /api/bots/rules
  app.get('/', async (request, reply) => {
    const { botId, type, enabled, offset = 0, limit = 50 } = request.query
    const take = Math.min(parseInt(limit), 100)
    const skip = Math.max(parseInt(offset), 0)

    const where = {}
    if (botId) where.botId = botId
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

  // GET /api/bots/rules/:id
  app.get('/:id', async (request, reply) => {
    const { id } = request.params
    const rule = await prisma.botRule.findUnique({
      where: { id },
      include: {
        bot: true
      }
    })
    if (!rule) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot rule not found' } })
    }
    return { data: rule }
  })

  // POST /api/bots/rules
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['botId', 'name', 'type'],
        properties: {
          botId: { type: 'string' },
          name: { type: 'string', minLength: 1 },
          type: { 
            type: 'string', 
            enum: ['price_threshold', 'position_limit', 'daily_loss', 'market_hours'] 
          },
          config: { type: 'object' },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const rule = await prisma.botRule.create({
      data: {
        id: generateId(ID_PREFIXES.RULE),
        ...request.body,
        enabled: request.body.enabled ?? true
      }
    })
    return reply.code(201).send({ data: rule })
  })

  // PUT /api/bots/rules/:id
  app.put('/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          type: { 
            type: 'string', 
            enum: ['price_threshold', 'position_limit', 'daily_loss', 'market_hours'] 
          },
          config: { type: 'object' },
          enabled: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    try {
      const rule = await prisma.botRule.update({
        where: { id },
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

  // DELETE /api/bots/rules/:id
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params
    try {
      await prisma.botRule.delete({
        where: { id }
      })
      return reply.code(204).send()
    } catch (error) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Bot rule not found' } })
      }
      throw error
    }
  })
}
