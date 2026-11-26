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
  createAiStockTraderConfig
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
      config: createAiStockTraderConfig(),
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
      config: createAiStockTraderConfig()
    }
  })

  if (bot.userId !== user.id ||
      bot.portfolioId !== portfolio.id ||
      bot.templateId !== AI_STOCK_TRADER_STRATEGY_ID) {
    throw new Error('Flagship paper bot has unexpected ownership or strategy')
  }

  return { bot, user, portfolio }
}
