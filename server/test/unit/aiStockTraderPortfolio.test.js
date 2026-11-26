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
      fillLoader: async () => [{ id: 'filled-buy', ticker: 'AAPL', direction: 'buy', filledQuantity: 2, filledPrice: 100, fees: 0, commission: 0, simSession: '2026-11-24' }]
    })
    expect(portfolio.cash).toBe(9800)
    expect(portfolio.totalEquity).toBe(10020)
    expect(portfolio.positions[0].unrealizedPnl).toBe(20)
  })

  it('fails closed when a held symbol has no current price', async () => {
    await expect(loadStockTraderPaperPortfolio({
      bot, screening: { ...screening, shortlist: [] },
      fillLoader: async () => [{ id: 'buy', ticker: 'AAPL', direction: 'buy', filledQuantity: 1, filledPrice: 100, simSession: '2026-11-24' }]
    })).rejects.toThrow(/position mark/)
  })

  it('does not invent an empty portfolio after accounting failure', async () => {
    await expect(loadStockTraderPaperPortfolio({
      bot, screening, fillLoader: async () => { throw new Error('database unavailable') }
    })).rejects.toThrow(/database unavailable/)
  })
})
