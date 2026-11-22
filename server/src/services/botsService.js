import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { validateEventMetadata } from '../utils/validation.js'
import { computeBotAccounting } from './botAccountingService.js'
import { simulationConfig } from './simulationService.js'
import { loadPriceMarks } from './portfolioValuationService.js'
import { isResearchDriven, resolveResearchPolicy } from '../../../worker/src/engine/researchDecision.js'

/** Research-driven bots must carry a policy the bot engine accepts (it fails closed otherwise). */
function assertValidResearchConfig(config) {
  if (!isResearchDriven({ config })) return
  const resolved = resolveResearchPolicy(config)
  if (!resolved.ok) {
    const err = new Error(`Invalid research settings (${resolved.reason})`)
    err.statusCode = 400
    throw err
  }
}

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
  async createBot(data) {
    assertValidResearchConfig(data.config)
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
        enabled:     data.enabled ?? false,
        config:      data.config ?? {}
      }
    })
    return bot
  },

  // Create a bot + its rules atomically from a BotTemplate.
  // Callers supply overrides to customise the template defaults.
  async createBotFromTemplate(data) {
    if (!data.userId) {
      throw new Error('userId is required to create a bot from template')
    }
    const template = await prisma.botTemplate.findUnique({ where: { id: data.templateId } })
    if (!template) return null

    // Validate capital / max order notional if provided
    const rawCapital = data.capital ?? data.allocatedAmount
    if (rawCapital !== undefined && rawCapital !== null) {
      const cap = Number(rawCapital)
      if (!Number.isFinite(cap) || cap <= 0) {
        const err = new Error('Capital must be greater than 0')
        err.statusCode = 400
        throw err
      }
    }

    const rawMaxOrder = data.maxOrderNotional ?? data.maxPerOrder
    if (rawMaxOrder !== undefined && rawMaxOrder !== null) {
      const maxOrd = Number(rawMaxOrder)
      if (!Number.isFinite(maxOrd) || maxOrd <= 0) {
        const err = new Error('Max order notional must be greater than 0')
        err.statusCode = 400
        throw err
      }
    }

    const allocatedAmount = data.allocatedAmount ?? data.capital ?? template.config?.allocatedAmount ?? null
    const maxOrderNotional = data.maxOrderNotional ?? data.maxPerOrder ?? template.config?.maxOrderNotional ?? null
    const capitalMode = data.capitalMode ?? template.config?.capitalMode ?? (allocatedAmount ? 'allocated' : 'legacy')
    const direction = data.direction ?? template.config?.direction ?? null
    const tickers = data.tickers ?? template.config?.tickers ?? []
    const quantity = data.quantity ?? template.config?.quantity ?? (allocatedAmount ? null : 1)

    const config = {
      ...template.config,
      ...(data.config ?? {}),
      tickers,
      ...(direction ? { direction } : {}),
      ...(quantity != null ? { quantity } : {}),
      ...(allocatedAmount != null ? { allocatedAmount: Number(allocatedAmount) } : {}),
      ...(maxOrderNotional != null ? { maxOrderNotional: Number(maxOrderNotional) } : {}),
      ...(capitalMode ? { capitalMode } : {}),
      riskOnExposure: data.riskOnExposure ?? template.config?.riskOnExposure ?? 1.0,
    }
    assertValidResearchConfig(config)

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
          enabled:     data.enabled ?? false,
          config
        }
      })

      const templateRules = Array.isArray(data.rules) && data.rules.length > 0
        ? data.rules
        : (template.rules ?? [])

      const rules = templateRules.map((rule) => ({
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

    const data = await Promise.all(bots.map(async (bot) => {
      const { performance, capitalInUse } = await computeBotPerformance(bot.id)
      return {
        ...bot,
        performance,
        capitalInUse
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

    const { performance, capitalInUse } = await computeBotPerformance(id)
    return {
      ...bot,
      performance,
      capitalInUse
    }
  },

  async updateBot(id, data) {
    if (data.config !== undefined) assertValidResearchConfig(data.config)
    const existing = await prisma.bot.findUnique({ where: { id } })
    const updated = await prisma.bot.update({
      where: { id },
      data: {
        ...(data.name       !== undefined ? { name:       data.name }       : {}),
        ...(data.enabled    !== undefined ? { enabled:    data.enabled }    : {}),
        ...(data.config     !== undefined ? { config:     data.config }     : {}),
        ...(data.strategyId !== undefined ? { strategyId: data.strategyId } : {})
      }
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
