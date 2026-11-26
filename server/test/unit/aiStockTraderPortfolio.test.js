import { describe, expect, it } from 'vitest'
import { loadStockTraderPaperPortfolio } from '../../src/services/ai/stockTraderPortfolio.js'
import { createAiStockTraderConfig } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'

const bot = { id: 'bot', config: createAiStockTraderConfig() }
const screening = {
  asOfSession: '2026-11-25',
  shortlist: [{ symbol: 'AAPL', indicators: { price: 110 } }]
}

describe('flagship paper portfolio', () => {
  it('reconciles cash and marks holdings from real fill-derived accounting', async () => {
    const portfolio = await loadStockTraderPaperPortfolio({
      bot, screening,
      fillLoader: async () => [{ filledQuantity: 2 }],
      accountant: () => ({ realizedPnl: 20, openPositions: { AAPL: { quantity: 2, avgPrice: 100 } } })
    })
    expect(portfolio.cash).toBe(9820)
    expect(portfolio.totalEquity).toBe(10040)
    expect(portfolio.positions[0].unrealizedPnl).toBe(20)
  })

  it('fails closed when a held symbol has no current price', async () => {
    await expect(loadStockTraderPaperPortfolio({
      bot, screening: { ...screening, shortlist: [] },
      fillLoader: async () => [],
      accountant: () => ({ realizedPnl: 0, openPositions: { AAPL: { quantity: 1, avgPrice: 100 } } })
    })).rejects.toThrow(/position mark/)
  })

  it('does not invent an empty portfolio after accounting failure', async () => {
    await expect(loadStockTraderPaperPortfolio({
      bot, screening, fillLoader: async () => { throw new Error('database unavailable') }
    })).rejects.toThrow(/database unavailable/)
  })
})
