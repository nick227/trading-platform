/**
 * Isolated platform paper-bot bootstrap for the flagship.
 * Never reassigns or mutates a user-owned bot or the legacy momentum bot.
 */
import prisma from '../../loaders/prisma.js'
import {
  AI_STOCK_TRADER_DEFAULTS,
  AI_STOCK_TRADER_PLATFORM_BOT_ID,
  AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID,
  AI_STOCK_TRADER_PLATFORM_USER_ID,
  AI_STOCK_TRADER_STRATEGY_ID,
  createAiStockTraderAgentConfig,
  AI_STOCK_TRADER_AGENT_VERSION
} from './strategies/aiStockTraderStrategy.js'

export async function getOrCreatePlatformAiStockTrader({
  prismaClient = prisma
} = {}) {
  const user = await prismaClient.user.upsert({
    where: { id: AI_STOCK_TRADER_PLATFORM_USER_ID },
    update: {},
    create: {
      id: AI_STOCK_TRADER_PLATFORM_USER_ID,
      email: 'tradeloom-ai@tradeloom.internal',
      fullName: 'TradeLoom AI System',
      passwordHash: '$platform_system_locked_account$'
    }
  })

  const portfolio = await prismaClient.portfolio.upsert({
    where: { id: AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID },
    update: {},
    create: {
      id: AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID,
      userId: user.id,
      name: 'AI Stock Trader (Platform Paper)',
      cashBalance: AI_STOCK_TRADER_DEFAULTS.allocatedAmount,
      totalValue: AI_STOCK_TRADER_DEFAULTS.allocatedAmount
    }
  })
  if (portfolio.userId !== user.id) {
    throw new Error('Flagship paper portfolio has unexpected ownership')
  }

  // Bot.templateId is a real foreign key: create the template before the bot.
  await prismaClient.botTemplate.upsert({
    where: { id: AI_STOCK_TRADER_STRATEGY_ID },
    update: {},
    create: {
      id: AI_STOCK_TRADER_STRATEGY_ID,
      name: 'AI Stock Trader',
      description: 'AI-powered stock discovery and autonomous simulated portfolio decisions.',
      botType: 'strategy_based',
      config: createAiStockTraderAgentConfig(),
      rules: [],
      tags: ['ai', 'stock-trader', 'paper']
    }
  })

  const bot = await prismaClient.bot.upsert({
    where: { id: AI_STOCK_TRADER_PLATFORM_BOT_ID },
    update: {},
    create: {
      id: AI_STOCK_TRADER_PLATFORM_BOT_ID,
      userId: user.id,
      portfolioId: portfolio.id,
      templateId: AI_STOCK_TRADER_STRATEGY_ID,
      botType: 'strategy_based',
      name: 'AI Stock Trader (Platform Paper)',
      enabled: false, // No live AI calls or scheduled trading until subsequent MRs.
      config: createAiStockTraderAgentConfig()
    }
  })

  if (bot.userId !== user.id ||
      bot.portfolioId !== portfolio.id ||
      bot.templateId !== AI_STOCK_TRADER_STRATEGY_ID) {
    throw new Error('Flagship paper bot has unexpected ownership or strategy')
  }

  return { bot, user, portfolio }
}

/**
 * Explicit disabled-only operator migration. Never modifies a live bot,
 * changes its risk caps, or rewrites a bot that has simulated fills.
 */
export async function upgradeDisabledPlatformStockTraderToAgent({ prismaClient = prisma } = {}) {
  const bot = await prismaClient.bot.findUnique({
    where: { id: AI_STOCK_TRADER_PLATFORM_BOT_ID }
  })
  if (!bot || bot.enabled || bot.deletedAt || bot.templateId !== AI_STOCK_TRADER_STRATEGY_ID ||
      bot.userId !== AI_STOCK_TRADER_PLATFORM_USER_ID ||
      bot.portfolioId !== AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID ||
      bot.config?.mode !== 'paper') {
    throw new Error('Only the disabled, platform-owned paper flagship can be migrated')
  }
  if (bot.config.strategyVersion === AI_STOCK_TRADER_AGENT_VERSION) {
    return { botId: bot.id, upgraded: false, version: AI_STOCK_TRADER_AGENT_VERSION }
  }
  if (bot.config.strategyVersion !== '1.0.0') {
    throw new Error('Unknown legacy AI bot version; manual review required')
  }
  const executions = await prismaClient.execution.count({ where: { botId: bot.id } })
  if (executions !== 0) {
    throw new Error('Existing paper orders or fills require operator reconciliation before migration')
  }
  const config = createAiStockTraderAgentConfig({
    objective: bot.config.objective,
    universe: bot.config.universe,
    research: { cadence: bot.config.research?.cadence }
  })
  const changed = await prismaClient.bot.updateMany({
    where: { id: bot.id, enabled: false },
    data: { config }
  })
  if (changed.count !== 1) throw new Error('Bot activation changed during explicit migration')
  return { botId: bot.id, upgraded: true, version: config.strategyVersion }
}
