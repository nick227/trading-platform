import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { validateEventMetadata } from '../utils/validation.js'
import { computeBotAccounting } from './botAccountingService.js'
import { simulationConfig } from './simulationService.js'
import { loadPriceMarks } from './portfolioValuationService.js'

/**
 * Simulator only: value open positions with the portfolio valuation marks (Alpha Engine's
 * latest known daily close), so bot P/L and the portfolio always agree.
 */
async function simulatorValuation(openPositions) {
  if (!simulationConfig().enabled) return null
  const marks = await loadPriceMarks(Object.keys(openPositions ?? {}))
  return Object.keys(marks.prices).length ? marks : null
}

async function computeBotPerformance(botId) {
  try {
    let accounting = await computeBotAccounting(botId)
    const valuation = await simulatorValuation(accounting.openPositions)
    if (valuation) {
      accounting = await computeBotAccounting(botId, { currentPrices: valuation.prices })
      accounting.performance = accounting.performance && {
        ...accounting.performance,
        valuation: { source: 'alpha-engine daily close (latest known)', sessions: valuation.sessions, simulated: true }
      }
    }
    return {
      performance: accounting.performance,
      capitalInUse: accounting.capitalInUse,
      openPositions: accounting.openPositions
    }
  } catch {
    return {
      performance: null,
      capitalInUse: null,
      openPositions: {}
    }
  }
}

export default {
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
        rules:     { where: { enabled: true }, orderBy: { createdAt: 'asc' } },
        _count:    { select: { executions: true, events: true, rules: true } }
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip
    })

    const total = await prisma.bot.count({ where })

    const data = await Promise.all(bots.map(async (bot) => {
      const { performance, capitalInUse, openPositions } = await computeBotPerformance(bot.id)
      return {
        ...bot,
        performance,
        capitalInUse,
        openPositions
      }
    }))

    return {
      data,
      pagination: {
        total,
        hasMore: skip + take < total,
        nextOffset: skip + take < total ? skip + take : null
      }
    }
  },

  async getBot(id) {
    const bot = await prisma.bot.findUnique({
      where: { id },
      include: {
        portfolio: true,
        strategy:  true,
        rules:     true
      }
    })
    if (!bot) return null

    const { performance, capitalInUse, openPositions } = await computeBotPerformance(id)
    return {
      ...bot,
      performance,
      capitalInUse,
      openPositions
    }
  },

  // Pause/resume only. Name, config and rules are saved by botConfigService.saveBot.
  async updateBot(id, data) {
    const existing = await prisma.bot.findUnique({ where: { id } })
    const updated = await prisma.bot.update({
      where: { id },
      data: { ...(data.enabled !== undefined ? { enabled: data.enabled } : {}) }
    })

    // Persist pause/resume event
    if (data.enabled !== undefined && existing && existing.enabled !== data.enabled) {
      const eventType = data.enabled ? 'bot_resumed' : 'bot_paused'
      const detail = data.enabled ? 'Bot resumed' : 'Bot paused'
      try {
        await prisma.botEvent.create({
          data: {
            id:          generateId(ID_PREFIXES.EVENT),
            botId:       id,
            portfolioId: updated.portfolioId,
            type:        eventType,
            detail,
            metadata:    { enabled: data.enabled, userId: updated.userId }
          }
        })
      } catch (err) {
        console.error('Failed to persist bot lifecycle event:', err)
        throw err
      }
    }

    const { performance, capitalInUse } = await computeBotPerformance(id)
    return {
      ...updated,
      performance,
      capitalInUse
    }
  },

  async deleteBot(id) {
    const bot = await prisma.bot.findUnique({ where: { id } })
    const deleted = await prisma.bot.update({
      where: { id },
      data:  { deletedAt: new Date() }
    })

    if (bot) {
      try {
        await prisma.botEvent.create({
          data: {
            id:          generateId(ID_PREFIXES.EVENT),
            botId:       id,
            portfolioId: bot.portfolioId,
            type:        'bot_stopped',
            detail:      'Bot stopped',
            metadata:    { stopped: true, userId: bot.userId }
          }
        })
      } catch (err) {
        console.error('Failed to persist bot_stopped event:', err)
        throw err
      }
    }

    return deleted
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

  async getBotEvents(arg1, arg2 = {}) {
    const botId = typeof arg1 === 'string' ? arg1 : (arg1?.botId ?? null)
    const query = typeof arg1 === 'object' && (!arg2 || Object.keys(arg2).length === 0) ? arg1 : (arg2 ?? {})
    const { type, exclude, offset = 0, limit = 50 } = query
    const take = Math.min(parseInt(limit), 100)
    const skip = Math.max(parseInt(offset), 0)

    const where = { botId }
    if (type) where.type = type
    // ?exclude=execution_skipped,… — lets clients page meaningful events past routine checks
    else if (exclude) where.type = { notIn: String(exclude).split(',').map((t) => t.trim()).filter(Boolean) }

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
