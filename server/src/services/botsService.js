import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { STUB_USER_ID } from '../utils/auth.js'
import { validateEventMetadata } from '../utils/validation.js'

export default {
  async createBot(data) {
    const bot = await prisma.bot.create({
      data: {
        id: generateId(ID_PREFIXES.BOT),
        userId: data.userId || STUB_USER_ID,
        portfolioId: data.portfolioId,
        strategyId: data.strategyId,
        name: data.name,
        enabled: data.enabled ?? true,
        config: data.config ?? {}
      }
    })
    return bot
  },

  async getBots(query) {
    const { userId = STUB_USER_ID, portfolioId, enabled, offset = 0, limit = 50 } = query
    const take = Math.min(parseInt(limit), 100)
    const skip = Math.max(parseInt(offset), 0)

    const where = { userId, deletedAt: null }
    if (portfolioId) where.portfolioId = portfolioId
    if (enabled !== undefined) where.enabled = enabled === 'true'

    const bots = await prisma.bot.findMany({
      where,
      include: {
        portfolio: {
          select: { id: true, name: true }
        },
        strategy: {
          select: { id: true, name: true, type: true }
        },
        _count: {
          select: {
            executions: true,
            events: true,
            rules: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip
    })

    const total = await prisma.bot.count({ where })

    return {
      data: bots,
      pagination: {
        total,
        hasMore: skip + take < total,
        nextOffset: skip + take < total ? skip + take : null
      }
    }
  },

  async getBot(id) {
    return prisma.bot.findFirst({
      where: { id, deletedAt: null },
      include: {
        portfolio: true,
        strategy: true,
        rules: {
          orderBy: { createdAt: 'desc' }
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 50
        },
        executions: {
          orderBy: { createdAt: 'desc' },
          take: 20
        },
        _count: {
          select: {
            executions: true,
            events: true,
            rules: true
          }
        }
      }
    })
  },

  async updateBot(id, data) {
    return prisma.bot.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date()
      }
    })
  },

  async deleteBot(id) {
    // Soft delete
    return prisma.bot.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        enabled: false
      }
    })
  },

  async createBotEvent(data) {
    validateEventMetadata(data.type, data.metadata)
    
    const event = await prisma.botEvent.create({
      data: {
        id: generateId(ID_PREFIXES.EVENT),
        botId: data.botId,
        portfolioId: data.portfolioId,
        ruleId: data.ruleId,
        executionId: data.executionId,
        type: data.type,
        detail: data.detail,
        metadata: data.metadata
      }
    })
    return event
  },

  async getBotEvents(query) {
    const { botId, portfolioId, type, offset = 0, limit = 50 } = query
    const take = Math.min(parseInt(limit), 100)
    const skip = Math.max(parseInt(offset), 0)

    const where = {}
    if (botId) where.botId = botId
    if (portfolioId) where.portfolioId = portfolioId
    if (type) where.type = type

    const events = await prisma.botEvent.findMany({
      where,
      include: {
        bot: {
          select: { id: true, name: true }
        },
        execution: {
          select: { id: true, ticker, direction, quantity, price }
        }
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip
    })

    const total = await prisma.botEvent.count({ where })

    return {
      data: events,
      pagination: {
        total,
        hasMore: skip + take < total,
        nextOffset: skip + take < total ? skip + take : null
      }
    }
  }
}
