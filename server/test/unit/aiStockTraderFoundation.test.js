import { describe, expect, it, vi } from 'vitest'
import {
  AI_STOCK_TRADER_PLATFORM_BOT_ID,
  AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID,
  AI_STOCK_TRADER_STRATEGY_ID,
  createAiStockTraderConfig
} from '../../src/services/ai/strategies/aiStockTraderStrategy.js'
import { getOrCreatePlatformAiStockTrader } from '../../src/services/ai/aiStockTraderBotService.js'

describe('AI Stock Trader foundation', () => {
  it('creates independent configuration objects without changing beta risk limits', () => {
    const first = createAiStockTraderConfig({
      universe: { type: 'watchlist', symbols: ['aapl', 'NVDA', 'AAPL'] },
      research: { cadence: 'weekly' }
    })
    const second = createAiStockTraderConfig()
    expect(first.universe.symbols).toEqual(['AAPL', 'NVDA'])
    expect(first.research.cadence).toBe('weekly')
    expect(second.research.cadence).toBe('daily')
    first.universe.symbols.push('TSLA')
    expect(second.universe.symbols).not.toContain('TSLA')
    expect(first.execution.maxPositionPct).toBe(0.20)
    expect(first.research.maxCallsPerCycle).toBe(1)
  })

  it('rejects attempts to override provider or hard execution limits', () => {
    expect(() => createAiStockTraderConfig({ execution: { maxOrdersPerCycle: 100 } })).toThrow()
    expect(() => createAiStockTraderConfig({ provider: 'untrusted' })).toThrow()
    expect(() => createAiStockTraderConfig({ universe: { type: 'curated', symbols: ['INVALID SYMBOL'] } })).toThrow()
  })

  it('initializes a separate disabled platform bot and template without resetting state', async () => {
    const user = { id: 'usr_platform_canonical' }
    const portfolio = { id: AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID, userId: user.id }
    const bot = {
      id: AI_STOCK_TRADER_PLATFORM_BOT_ID,
      templateId: AI_STOCK_TRADER_STRATEGY_ID,
      userId: user.id,
      portfolioId: portfolio.id,
      enabled: false
    }
    const prismaClient = {
      user: { upsert: vi.fn().mockResolvedValue(user) },
      portfolio: { upsert: vi.fn().mockResolvedValue(portfolio) },
      botTemplate: { upsert: vi.fn().mockResolvedValue({ id: AI_STOCK_TRADER_STRATEGY_ID }) },
      bot: { upsert: vi.fn().mockResolvedValue(bot) }
    }

    await getOrCreatePlatformAiStockTrader({ prismaClient })
    await getOrCreatePlatformAiStockTrader({ prismaClient })

    expect(prismaClient.bot.upsert).toHaveBeenCalledTimes(2)
    const creation = prismaClient.bot.upsert.mock.calls[0][0]
    expect(creation.create.enabled).toBe(false)
    expect(creation.update).toEqual({})
    expect(creation.create.portfolioId).toBe(AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID)
    expect(prismaClient.botTemplate.upsert).toHaveBeenCalledBefore(prismaClient.bot.upsert)
  })

  it('rejects unexpected ownership rather than moving an existing bot', async () => {
    const prismaClient = {
      user: { upsert: vi.fn().mockResolvedValue({ id: 'usr_platform_canonical' }) },
      portfolio: { upsert: vi.fn().mockResolvedValue({ id: AI_STOCK_TRADER_PLATFORM_PORTFOLIO_ID, userId: 'other' }) },
      botTemplate: { upsert: vi.fn() },
      bot: { upsert: vi.fn() }
    }
    await expect(getOrCreatePlatformAiStockTrader({ prismaClient })).rejects.toThrow(/unexpected ownership/)
    expect(prismaClient.bot.upsert).not.toHaveBeenCalled()
  })
})
