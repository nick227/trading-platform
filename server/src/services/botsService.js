import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { validateEventMetadata } from '../utils/validation.js'

export default {
  async createBot(data) {
    if (!data.userId) {
      throw new Error('userId is required to create a bot')
    }
    const bot = await prisma.bot.create({
      data: {
        id:          generateId(ID_PREFIXES.BOT),
        userId:      data.userId,
        portfolioId: data.portfolioId,
        strategyId:  data.strategyId ?? null,
        templateId:  data.templateId ?? null,
        botType:     data.botType ?? 'rule_based',
        name:        data.name,
        enabled:     data.enabled ?? true,
        config:      data.config ?? {}
      }
    })
    return bot
  },

  // Create a bot + its rules atomically from a BotTemplate.
  // Callers supply overrides (tickers, quantity) to customise the template defaults.
  async createBotFromTemplate(data) {
    if (!data.userId) {
      throw new Error('userId is required to create a bot from template')
    }
    const template = await prisma.botTemplate.findUnique({ where: { id: data.templateId } })
    if (!template) return null

    const config = {
      ...template.config,
      ...(data.tickers  ? { tickers:  data.tickers }  : {}),
      ...(data.quantity ? { quantity: data.quantity }  : {})
    }

    return prisma.$transaction(async (tx) => {
      const bot = await tx.bot.create({
        data: {
          id:          generateId(ID_PREFIXES.BOT),
          userId:      data.userId,
          portfolioId: data.portfolioId,
          strategyId:  data.strategyId ?? null,
          templateId:  template.id,
          botType:     template.botType,
          name:        data.name ?? template.name,
          config
        }
      })

      const rules = (template.rules ?? []).map((rule) => ({
        id:      generateId(ID_PREFIXES.RULE),
        botId:   bot.id,
        name:    rule.name,
        type:    rule.type,
        config:  rule.config ?? {},
        enabled: rule.enabled ?? true
      }))

      if (rules.length > 0) {
        await tx.botRule.createMany({ data: rules })
      }

      return {
        ...bot,
        rules
      }
    })
  },

  async getBots(query = {}) {
    const { userId, portfolioId, enabled, offset = 0, limit = 50 } = query
    if (!userId) {
      return {
        data: [],
        pagination: { total: 0, hasMore: false, nextOffset: null }
      }
    }

    const take = Math.min(parseInt(limit), 100)
    const skip = Math.max(parseInt(offset), 0)

    const where = { userId, deletedAt: null }
    if (portfolioId) where.portfolioId = portfolioId
    if (enabled !== undefined) where.enabled = enabled === 'true'

    const bots = await prisma.bot.findMany({
      where,
      include: {
        portfolio: { select: { id: true, name: true } },
        strategy:  { select: { id: true, name: true, type: true } },
        _count:    { select: { executions: true, events: true, rules: true } }
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
    return prisma.bot.findUnique({
      where: { id },
      include: {
        portfolio: true,
        strategy:  true,
        rules:     true
      }
    })
  },

  async updateBot(id, data) {
    return prisma.bot.update({
      where: { id },
      data: {
        ...(data.name       !== undefined ? { name:       data.name }       : {}),
        ...(data.enabled    !== undefined ? { enabled:    data.enabled }    : {}),
        ...(data.config     !== undefined ? { config:     data.config }     : {}),
        ...(data.strategyId !== undefined ? { strategyId: data.strategyId } : {})
      }
    })
  },

  async deleteBot(id) {
    return prisma.bot.update({
      where: { id },
      data:  { deletedAt: new Date() }
    })
  },

  async getCatalog(query = {}) {
    const { botType } = query
    const where = {}
    if (botType) where.botType = botType

    return prisma.botTemplate.findMany({
      where,
      orderBy: { createdAt: 'asc' }
    })
  },

  async getCatalogTemplate(id) {
    return prisma.botTemplate.findUnique({
      where: { id }
    })
  },

  async getBotEvents(botId, query = {}) {
    const { type, offset = 0, limit = 50 } = query
    const take = Math.min(parseInt(limit), 100)
    const skip = Math.max(parseInt(offset), 0)

    const where = { botId }
    if (type) where.type = type

    const events = await prisma.botEvent.findMany({
      where,
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
  },

  async createBotEvent(data) {
    validateEventMetadata(data.metadata)
    return prisma.botEvent.create({
      data: {
        id:          generateId(ID_PREFIXES.EVENT),
        botId:       data.botId,
        portfolioId: data.portfolioId,
        ruleId:      data.ruleId      ?? null,
        executionId: data.executionId ?? null,
        type:        data.type,
        detail:      data.detail,
        metadata:    data.metadata    ?? {}
      }
    })
  }
}
