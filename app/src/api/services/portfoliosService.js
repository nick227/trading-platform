import { get, post } from '../client'
import { getPositions } from '../../services/derivePositions.js'
import pricesService from './pricesService.js'

export default {
  async getAll() {
    try {
      return await get('/portfolios')
    } catch {
      return []
    }
  },

  async getById(id) {
    try {
      return await get(`/portfolios/${id}`)
    } catch {
      return null
    }
  },

  // Returns positions enriched with current market prices.
  // Single source of truth: derives from executions via derivePositions.
  async getHoldings(portfolioId) {
    try {
      const [positions, priceMap] = await Promise.all([
        getPositions(portfolioId),
        pricesService.getPriceMap()
      ])
      return positions.map(pos => ({
        ticker: pos.ticker,
        quantity: pos.quantity,
        avgCost: pos.avgCost,
        totalCost: pos.totalCost,
        currentPrice: pricesService.getPrice(priceMap, pos.ticker) ?? pos.avgCost,
        marketValue: pos.quantity * (pricesService.getPrice(priceMap, pos.ticker) ?? pos.avgCost)
      }))
    } catch {
      return []
    }
  },

  async getSummary(portfolioId) {
    try {
      const holdings = await this.getHoldings(portfolioId)
      const totalValue = holdings.reduce((sum, h) => sum + h.marketValue, 0)
      const totalCost = holdings.reduce((sum, h) => sum + h.totalCost, 0)
      const totalPnL = totalValue - totalCost
      const topHolding = holdings.length > 0
        ? holdings.reduce((top, h) => h.marketValue > top.marketValue ? h : top)
        : null
      return {
        totalValue,
        totalPnL,
        totalPnLPct: totalCost > 0 ? totalPnL / totalCost : 0,
        positions: holdings.length,
        topHolding: topHolding?.ticker ?? null,
        topHoldingValue: topHolding?.marketValue ?? 0
      }
    } catch {
      return null
    }
  },

  async create(data) {
    try {
      return await post('/portfolios', data)
    } catch {
      return null
    }
  }
}
