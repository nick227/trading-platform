import { describe, expect, it, vi } from 'vitest'
import { readPublicStockTraderDashboard } from '../../src/services/ai/stockTraderDashboardService.js'
import { AI_STOCK_TRADER_PLATFORM_BOT_ID, AI_STOCK_TRADER_STRATEGY_ID } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'

function makeDb(bot = null) {
  return {
    bot: { findUnique: vi.fn(async () => bot) },
    execution: { findMany: vi.fn(async () => []) },
    botEvent: { findMany: vi.fn(async () => []) }
  }
}
const bot = { id: AI_STOCK_TRADER_PLATFORM_BOT_ID, templateId: AI_STOCK_TRADER_STRATEGY_ID,
  name: 'AI Stock Trader', enabled: false, config: { allocatedAmount: 10000 } }

describe('public flagship dashboard', () => {
  it('does not initialize a bot or invent results for a fresh beta', async () => {
    const db = makeDb()
    const result = await readPublicStockTraderDashboard({ prismaClient: db })
    expect(result.status).toBe('not_initialized')
    expect(result.performance).toBeNull()
    expect(db.bot.findUnique).toHaveBeenCalledTimes(1)
  })

  it('separates research proposals from executions and publishes no private prompt', async () => {
    const db = makeDb(bot)
    db.botEvent.findMany = vi.fn(async () => [{
      id: 'research', createdAt: new Date('2026-11-25T22:00:00Z'), metadata: {
        status: 'completed', model: 'gpt-4o-mini', snapshot: { secret: 'DO_NOT_EXPOSE' },
        decision: {
          asOfSession: '2026-11-25', marketSummary: 'Market mixed',
          decisions: [{ symbol: 'AAPL', action: 'HOLD', confidence: 0.6, thesis: 'Wait', evidence: [], risks: [] }]
        }
      }
    }])
    const result = await readPublicStockTraderDashboard({ prismaClient: db, fillLoader: async () => [], accountant: () => ({ hasFills: false, openPositions: {} }) })
    expect(result.research[0].decisions[0].action).toBe('HOLD')
    expect(result.orders).toEqual([])
    expect(result.performance).toBeNull()
    expect(JSON.stringify(result)).not.toContain('DO_NOT_EXPOSE')
  })

  it('shows missing marks as unavailable instead of zero performance', async () => {
    const db = makeDb(bot)
    const fill = { ticker: 'AAPL', direction: 'buy', filledQuantity: 1, filledPrice: 100, filledAt: new Date() }
    const result = await readPublicStockTraderDashboard({
      prismaClient: db, engine: { getSessionClose: async () => { throw new Error('feed missing') } },
      fillLoader: async () => [fill],
      accountant: (_, { currentPrices = {} } = {}) => ({
        hasFills: true, fillCount: 1,
        performance: { realizedPnl: 0, unrealizedPnl: null, totalPnl: null },
        openPositions: { AAPL: { ticker: 'AAPL', quantity: 1, avgPrice: 100, currentPrice: currentPrices.AAPL ?? null, unrealizedPnl: null } }
      })
    })
    expect(result.positions[0].marketValue).toBeNull()
    expect(result.performance.totalPnl).toBeNull()
    expect(result.performance.totalEquity).toBeNull()
  })
})
