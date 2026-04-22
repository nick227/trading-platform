import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'

export default {
  async createEvent(botId, data) {
    const event = await prisma.botEvent.create({
      data: {
        id: generateId(ID_PREFIXES.EVENT),
        botId,
        type: data.type,
        detail: data.detail,
        metadata: data.metadata ?? {},
        executionId: data.executionId ?? null
      }
    })
    return event
  },

  async getBotEvents(botId, filters = {}) {
    const where = { botId }

    if (filters.type) {
      where.type = filters.type
    }

    if (filters.after) {
      where.createdAt = {
        gt: filters.after
      }
    }

    const orderBy = [
      { createdAt: 'desc' }
    ]

    const take = filters.limit || 50

    const events = await prisma.botEvent.findMany({
      where,
      orderBy,
      take,
      include: {
        execution: {
          select: {
            id: true,
            ticker: true,
            quantity: true,
            price: true,
            status: true,
            createdAt: true
          }
        }
      }
    })

    // Find cursor for next page
    const nextCursor = events.length === take ? events[events.length - 1].id : null

    return {
      items: events,
      nextCursor
    }
  },

  async getEvent(eventId) {
    return prisma.botEvent.findUnique({
      where: { id: eventId },
      include: {
        bot: {
          select: {
            id: true,
            name: true,
            type: true,
            enabled: true,
            status: true
          }
        },
        execution: {
          select: {
            id: true,
            ticker: true,
            quantity: true,
            price: true,
            status: true,
            createdAt: true
          }
        }
      }
    })
  },

  async createRuleTriggeredEvent(botId, ruleId, metadata) {
    return prisma.botEvent.create({
      data: {
        id: generateId(ID_PREFIXES.EVENT),
        botId,
        type: 'rule_triggered',
        detail: `Rule triggered for bot`,
        metadata: {
          ruleId,
          ...metadata
        }
      }
    })
  },

  async createStrategyExecutedEvent(botId, metadata) {
    return prisma.botEvent.create({
      data: {
        id: generateId(ID_PREFIXES.EVENT),
        botId,
        type: 'strategy_executed',
        detail: `Strategy executed for bot`,
        metadata
      }
    })
  },

  async createErrorEvent(botId, error, metadata = {}) {
    return prisma.botEvent.create({
      data: {
        id: generateId(ID_PREFIXES.EVENT),
        botId,
        type: 'error_occurred',
        detail: `Error: ${error.message || error}`,
        metadata: {
          error: error.message || error,
          stack: error.stack,
          ...metadata
        }
      }
    })
  },

  async createConfigUpdatedEvent(botId, oldConfig, newConfig) {
    return prisma.botEvent.create({
      data: {
        id: generateId(ID_PREFIXES.EVENT),
        botId,
        type: 'config_updated',
        detail: 'Bot configuration updated',
        metadata: {
          oldConfig,
          newConfig
        }
      }
    })
  }
}
