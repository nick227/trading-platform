/**
 * TradeLoom's own paper bot fleet: one platform-owned instance per rule-based strategy.
 *
 * Each strategy gets its own locked system user and simulated portfolio. Positions, exposure
 * and risk limits are scoped per user throughout the engine and risk checks, so a shared owner
 * would let one strategy's holdings block or skew another's. With one owner per strategy, every
 * fill, position and P&L figure is attributable to exactly one published strategy.
 *
 * Bots run the template's published config and rules unchanged, so their recorded history is
 * evidence for the strategy as listed in the catalog.
 */
import prisma from '../loaders/prisma.js'
import { assertValidConfig } from './botConfigService.js'
import { calculateFifoAccounting, loadBotFills } from './botAccountingService.js'
import { PLATFORM_USER_ID } from './ai/aiBotService.js'
import { ACTIVE_EXECUTION_STATUSES } from '../../../worker/src/queues/executionStatus.js'

export const PLATFORM_FLEET_TEMPLATE_IDS = [
  'tmpl_momentum_buy',
  'tmpl_dca_accumulator',
  'tmpl_momentum_sell',
  'tmpl_loss_guard',
  'tmpl_spy_trend_filter',
  'tmpl_alpha_research'
]

const LOCKED_PASSWORD = '$platform_system_locked_account$'
const DEFAULT_STARTING_CASH = 10_000

const slugOf = (templateId) => String(templateId).replace(/^tmpl_/, '')

/** Deterministic ids, so provisioning is idempotent and the bots are addressable by strategy. */
export function platformFleetIds(templateId) {
  const slug = slugOf(templateId)
  return {
    userId: `usr_platform_${slug}`,
    portfolioId: `port_platform_${slug}`,
    botId: `bot_platform_${slug}`,
    email: `fleet-${slug.replace(/_/g, '-')}@tradeloom.internal`
  }
}

/** True for every TradeLoom-owned account (the AI canonical user and the rule-strategy fleet). */
export function isPlatformUserId(userId) {
  return typeof userId === 'string' && (userId === PLATFORM_USER_ID || userId.startsWith('usr_platform_'))
}

/**
 * Creates any missing fleet member. Never modifies an existing one: a bot an operator paused
 * stays paused, and an existing portfolio's cash is never reset.
 */
export async function ensurePlatformFleet({ prismaClient = prisma, log = console } = {}) {
  const results = []
  for (const templateId of PLATFORM_FLEET_TEMPLATE_IDS) {
    const ids = platformFleetIds(templateId)
    try {
      const template = await prismaClient.botTemplate.findUnique({ where: { id: templateId } })
      if (!template) {
        results.push({ templateId, status: 'template_missing' })
        continue
      }
      if (template.botType !== 'rule_based') {
        results.push({ templateId, status: 'not_rule_based' })
        continue
      }
      const existing = await prismaClient.bot.findUnique({ where: { id: ids.botId } })
      if (existing) {
        results.push({ templateId, botId: ids.botId, status: 'exists', enabled: existing.enabled })
        continue
      }

      const config = { ...(template.config ?? {}) }
      assertValidConfig(config)
      const startingCash = Number(config.allocatedAmount) > 0 ? Number(config.allocatedAmount) : DEFAULT_STARTING_CASH
      const rules = Array.isArray(template.rules) ? template.rules : []

      await prismaClient.$transaction(async (tx) => {
        await tx.user.upsert({
          where: { id: ids.userId },
          update: {},
          create: {
            id: ids.userId,
            email: ids.email,
            fullName: `TradeLoom Strategy · ${template.name}`,
            passwordHash: LOCKED_PASSWORD
          }
        })
        await tx.portfolio.upsert({
          where: { id: ids.portfolioId },
          update: {},
          create: {
            id: ids.portfolioId,
            userId: ids.userId,
            name: `${template.name} · TradeLoom paper`,
            accountKind: 'platform_strategy',
            environment: 'internal_sim',
            status: 'active',
            cashBalance: startingCash,
            totalValue: startingCash
          }
        })
        await tx.bot.create({
          data: {
            id: ids.botId,
            userId: ids.userId,
            portfolioId: ids.portfolioId,
            templateId: template.id,
            botType: 'rule_based',
            name: `${template.name} (TradeLoom paper)`,
            enabled: true,
            config
          }
        })
        for (const [i, r] of rules.entries()) {
          await tx.botRule.create({
            data: {
              id: `rule_platform_${slugOf(templateId)}_${i}`,
              botId: ids.botId,
              name: r.name ?? r.type,
              type: r.type,
              config: r.config ?? {},
              enabled: r.enabled ?? true
            }
          })
        }
        await tx.botEvent.create({
          data: {
            id: `evt_platform_start_${slugOf(templateId)}`,
            botId: ids.botId,
            portfolioId: ids.portfolioId,
            type: 'bot_resumed',
            detail: `TradeLoom paper bot started for ${template.name}`,
            metadata: { platformFleet: true, templateId, startingCash, rules: rules.length }
          }
        })
      })
      results.push({ templateId, botId: ids.botId, status: 'created', startingCash })
    } catch (err) {
      log.error?.(`[platform_fleet] ${templateId} provisioning failed: ${err?.message ?? err}`)
      results.push({ templateId, botId: ids.botId, status: 'error', error: err?.message ?? String(err) })
    }
  }
  return results
}

const ERROR_EVENT_TYPES = ['error_occurred', 'strategy_error']

/**
 * Operational health of every platform paper bot: whether it is enabled, evaluating, filling,
 * and what last went wrong. Positions are shown at cost; marking to market belongs to the
 * public performance read.
 */
export async function getPlatformFleetHealth({ prismaClient = prisma } = {}) {
  const bots = await prismaClient.bot.findMany({
    where: { userId: { startsWith: 'usr_platform_' }, deletedAt: null },
    orderBy: { createdAt: 'asc' }
  })
  return Promise.all(bots.map(async (bot) => {
    const [portfolio, lastEvaluation, lastError, lastFill, pending, statusCounts, fills] = await Promise.all([
      prismaClient.portfolio.findUnique({ where: { id: bot.portfolioId } }),
      prismaClient.botEvent.findFirst({
        where: { botId: bot.id, type: { notIn: ['bot_paused', 'bot_resumed', 'bot_stopped', ...ERROR_EVENT_TYPES] } },
        orderBy: { createdAt: 'desc' },
        select: { type: true, detail: true, createdAt: true }
      }),
      prismaClient.botEvent.findFirst({
        where: { botId: bot.id, type: { in: ERROR_EVENT_TYPES } },
        orderBy: { createdAt: 'desc' },
        select: { type: true, detail: true, createdAt: true }
      }),
      prismaClient.execution.findFirst({
        where: { botId: bot.id, status: 'filled' },
        orderBy: { filledAt: 'desc' },
        select: { id: true, ticker: true, direction: true, filledQuantity: true, filledPrice: true, filledAt: true, simSession: true }
      }),
      prismaClient.execution.count({ where: { botId: bot.id, status: { in: ACTIVE_EXECUTION_STATUSES } } }),
      prismaClient.execution.findMany({ where: { botId: bot.id }, select: { status: true } }),
      loadBotFills(bot.id, { prismaClient })
    ])
    const accounting = calculateFifoAccounting(fills)
    const sessions = new Set(fills.map((f) => f.simSession).filter(Boolean))
    return {
      botId: bot.id,
      templateId: bot.templateId,
      botType: bot.botType,
      name: bot.name,
      userId: bot.userId,
      enabled: bot.enabled,
      startedAt: bot.createdAt,
      portfolio: portfolio && { id: portfolio.id, cash: Number(portfolio.cashBalance), environment: portfolio.environment, status: portfolio.status },
      lastEvaluation,
      lastError,
      lastFill,
      lastMarketSession: lastFill?.simSession ?? null,
      sessionsWithFills: sessions.size,
      pendingOrders: pending,
      executionsByStatus: statusCounts.reduce((acc, { status }) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }), {}),
      fillCount: accounting.fillCount ?? 0,
      realizedPnl: accounting.performance?.realizedPnl ?? 0,
      openPositions: Object.fromEntries(Object.entries(accounting.openPositions ?? {})
        .filter(([, p]) => p?.quantity > 0)
        .map(([t, p]) => [t, { quantity: p.quantity, avgPrice: p.avgPrice }]))
    }
  }))
}
