import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { STUB_USER_ID } from '../utils/auth.js'
import { validateEventMetadata } from '../utils/validation.js'

export default {
  async createBot(data) {
    const bot = await prisma.bot.create({
      data: {
        id:          generateId(ID_PREFIXES.BOT),
        userId:      data.userId || STUB_USER_ID,
        portfolioId: data.portfolioId,
        strategyId:  data.strategyId ?? null,
        templateId:  data.templateId ?? null,
        type:        data.type ?? 'RULE_BASED',
        name:        data.name,
        enabled:     data.enabled ?? true,
        status:      data.status ?? 'draft',
        config:      data.config ?? {}
      }
    })
    return bot
  },

  // Create a bot from template with proper type handling
  async createBotFromTemplate(data) {
    const template = await prisma.botTemplate.findUnique({ where: { id: data.templateId } })
    if (!template) return null

    const config = {
      ...template.config,               // direction, default quantity/tickers
      ...(data.tickers   ? { tickers: data.tickers }  : {}),
      ...(data.quantity  ? { quantity: data.quantity }  : {}),
      ...(data.minConfidence ? { minConfidence: data.minConfidence } : {})
    }

    return prisma.$transaction(async (tx) => {
      const bot = await tx.bot.create({
        data: {
          id:          generateId(ID_PREFIXES.BOT),
          userId:      data.userId || STUB_USER_ID,
          portfolioId: data.portfolioId,
          strategyId:  template.type === 'STRATEGY_BASED' ? template.id : null,
          templateId: template.type === 'RULE_BASED' ? template.id : null,
          type:        template.type,
          name:        data.name ?? template.name,
          enabled:     data.enabled ?? true,
          status:      'draft',
          config
        }
      })

      // Create initial bot event
      await tx.botEvent.create({
        data: {
          id: generateId(ID_PREFIXES.BOT_EVENT),
          botId: bot.id,
          type: 'bot_created',
          detail: `Bot created from template: ${template.name}`,
          metadata: {
            templateId: template.id,
            templateName: template.name,
            config
          }
        }
      })

      return bot
    })
  },

  async getBots(filters = {}) {
    const where = {
      userId: filters.userId || STUB_USER_ID
    }

    if (filters.portfolioId) {
      where.portfolioId = filters.portfolioId
    }

    if (filters.enabled !== undefined) {
      where.enabled = filters.enabled
    }

    if (filters.type) {
      where.type = filters.type
    }

    if (filters.status) {
      where.status = filters.status
    }

    const orderBy = [
      { createdAt: 'desc' }
    ]

    const skip = filters.offset || 0
    const take = filters.limit || 25

    const [bots, total] = await Promise.all([
      prisma.bot.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          portfolio: true,
          template: true,
          strategy: true,
          rules: {
            orderBy: { order: 'asc' }
          }
        }
      }),
      prisma.bot.count({ where })
    ])

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
    return prisma.bot.findUnique({
      where: { id },
      include: {
        portfolio: true,
        template: true,
        strategy: true,
        rules: {
          orderBy: { order: 'asc' }
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        executions: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    })
  },

  async updateBot(id, data) {
    const updateData = {}
    
    if (data.name !== undefined) {
      updateData.name = data.name
    }

    if (data.enabled !== undefined) {
      updateData.enabled = data.enabled
    }

    if (data.status !== undefined) {
      updateData.status = data.status
    }

    if (data.config !== undefined) {
      updateData.config = data.config
    }

    const bot = await prisma.bot.update({
      where: { id },
      data: updateData
    })

    // Create status change event if status changed
    if (data.status) {
      await prisma.botEvent.create({
        data: {
          id: generateId(ID_PREFIXES.BOT_EVENT),
          botId: id,
          type: 'config_updated',
          detail: `Bot status changed to ${data.status}`,
          metadata: {
            oldStatus: bot.status,
            newStatus: data.status
          }
        }
      })
    }

    return bot
  },

  async enableBot(id) {
    const bot = await prisma.bot.update({
      where: { id },
      data: { 
        enabled: true,
        status: 'running'
      }
    })

    await prisma.botEvent.create({
      data: {
        id: generateId(ID_PREFIXES.BOT_EVENT),
        botId: id,
        type: 'bot_enabled',
        detail: 'Bot enabled for execution',
        metadata: {
          enabled: true,
          status: 'running'
        }
      }
    })

    return bot
  },

  async disableBot(id) {
    const bot = await prisma.bot.update({
      where: { id },
      data: { 
        enabled: false,
        status: 'paused'
      }
    })

    await prisma.botEvent.create({
      data: {
        id: generateId(ID_PREFIXES.BOT_EVENT),
        botId: id,
        type: 'bot_disabled',
        detail: 'Bot disabled by user',
        metadata: {
          enabled: false,
          status: 'paused'
        }
      }
    })

    return bot
  },

  async deleteBot(id) {
    // Soft delete - update status to disabled
    const bot = await prisma.bot.update({
      where: { id },
      data: { 
        enabled: false,
        status: 'offline'
      }
    })

    await prisma.botEvent.create({
      data: {
        id: generateId(ID_PREFIXES.BOT_EVENT),
        botId: id,
        type: 'bot_disabled',
        detail: 'Bot deleted (soft delete)',
        metadata: {
          enabled: false,
          status: 'offline'
        }
      }
    })

    return bot
  },

  async getBotCatalog() {
    const [ruleBased, strategyBased] = await Promise.all([
      prisma.botTemplate.findMany({
        where: { type: 'RULE_BASED' },
        orderBy: { name: 'asc' }
      }),
      prisma.botTemplate.findMany({
        where: { type: 'STRATEGY_BASED' },
        orderBy: { name: 'asc' }
      })
    ])

    return {
      ruleBased: ruleBased.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        type: t.type
      })),
      strategyBased: strategyBased.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        type: s.type
      }))
    }
  },

  async updateBotActivity(id, activityData) {
    const updateData = {}

    if (activityData.lastRunAt) {
      updateData.lastRunAt = activityData.lastRunAt
    }

    if (activityData.lastEventAt) {
      updateData.lastEventAt = activityData.lastEventAt
    }

    if (activityData.lastExecutionAt) {
      updateData.lastExecutionAt = activityData.lastExecutionAt
    }

    if (activityData.status) {
      updateData.status = activityData.status
    }

    return prisma.bot.update({
      where: { id },
      data: updateData
    })
  }
}
