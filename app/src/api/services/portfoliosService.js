import { get, post } from '../client'
import executionsService from './executionsService.js'
import { STUB_USER_ID } from '../constants.js'

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
      const portfolios = await get('/portfolios')
      return portfolios.find(portfolio => portfolio.id === id)
    } catch {
      return null
    }
  },
  
  async getHoldings(portfolioId) {
    try {
      // Get executions for this portfolio
      const executions = await executionsService.getByPortfolio(portfolioId)
      
      const holdings = {}
      
      // Process executions in chronological order for FIFO
      executions
        .sort((a, b) => a.createdAt - b.createdAt)
        .forEach(execution => {
          if (!holdings[execution.ticker]) {
            holdings[execution.ticker] = {
              ticker: execution.ticker,
              quantity: 0,
              totalCost: 0,
              avgCost: 0,
              buyTrades: []
            }
          }
          
          if (execution.side === 'BUY') {
            holdings[execution.ticker].quantity += execution.quantity
            holdings[execution.ticker].totalCost += execution.price * execution.quantity
            
            holdings[execution.ticker].buyTrades.push({
              quantity: execution.quantity,
              cost: execution.price * execution.quantity,
              price: execution.price
            })
            
          } else if (execution.side === 'SELL') {
            let sharesToSell = execution.quantity
            
            while (sharesToSell > 0 && holdings[execution.ticker].buyTrades.length > 0) {
              const oldestBuy = holdings[execution.ticker].buyTrades[0]
              const sharesFromOldest = Math.min(sharesToSell, oldestBuy.quantity)
              
              const costToRemove = (oldestBuy.cost / oldestBuy.quantity) * sharesFromOldest
              holdings[execution.ticker].totalCost -= costToRemove
              
              oldestBuy.quantity -= sharesFromOldest
              oldestBuy.cost -= costToRemove
              
              if (oldestBuy.quantity === 0) {
                holdings[execution.ticker].buyTrades.shift()
              }
              
              sharesToSell -= sharesFromOldest
            }
            
            holdings[execution.ticker].quantity -= execution.quantity
          }
          
          if (holdings[execution.ticker].quantity > 0) {
            holdings[execution.ticker].avgCost = holdings[execution.ticker].totalCost / holdings[execution.ticker].quantity
          }
        })
      
      return Object.values(holdings)
        .filter(holding => holding.quantity > 0)
        .map(holding => ({
          ticker: holding.ticker,
          quantity: holding.quantity,
          avgCost: holding.avgCost,
          totalCost: holding.totalCost,
          marketValue: holding.quantity * holding.avgCost // Simplified
        }))
    } catch {
      return []
    }
  },
  
  async getSummary(portfolioId) {
    try {
      const holdings = await this.getHoldings(portfolioId)
      const totalValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0)
      const totalCost = holdings.reduce((sum, holding) => sum + holding.totalCost, 0)
      const totalPnL = totalValue - totalCost
      const topHolding = holdings.length > 0 ? 
        holdings.reduce((top, holding) => holding.marketValue > top.marketValue ? holding : top) : 
        null
      
      return {
        totalValue,
        totalPnL,
        totalPnLPct: totalCost > 0 ? totalPnL / totalCost : 0,
        positions: holdings.length,
        topHolding: topHolding?.ticker || null,
        topHoldingValue: topHolding?.marketValue || 0
      }
    } catch {
      return null
    }
  },
  
  async create(data) {
    try {
      return await post('/portfolios', {
        ...data,
        userId: STUB_USER_ID
      })
    } catch {
      return null
    }
  }
}
