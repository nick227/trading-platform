import executionsService from '../api/services/executionsService.js'
import { SIDE } from '../api/constants.js'

export function derivePositions(executions) {
  const positions = {}
  
  // Process executions in chronological order for FIFO
  executions
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach(execution => {
      if (!positions[execution.ticker]) {
        positions[execution.ticker] = {
          ticker: execution.ticker,
          quantity: 0,
          totalCost: 0,
          avgCost: 0,
          buyTrades: []
        }
      }
      
      if (execution.side === SIDE.BUY) {
        positions[execution.ticker].quantity += execution.quantity
        positions[execution.ticker].totalCost += execution.price * execution.quantity
        
        positions[execution.ticker].buyTrades.push({
          quantity: execution.quantity,
          cost: execution.price * execution.quantity,
          price: execution.price
        })
        
      } else if (execution.side === SIDE.SELL) {
        let sharesToSell = execution.quantity
        
        while (sharesToSell > 0 && positions[execution.ticker].buyTrades.length > 0) {
          const oldestBuy = positions[execution.ticker].buyTrades[0]
          const sharesFromOldest = Math.min(sharesToSell, oldestBuy.quantity)
          
          const costToRemove = (oldestBuy.cost / oldestBuy.quantity) * sharesFromOldest
          positions[execution.ticker].totalCost -= costToRemove
          
          oldestBuy.quantity -= sharesFromOldest
          oldestBuy.cost -= costToRemove
          
          if (oldestBuy.quantity === 0) {
            positions[execution.ticker].buyTrades.shift()
          }
          
          sharesToSell -= sharesFromOldest
        }
        
        positions[execution.ticker].quantity -= execution.quantity
      }
      
      if (positions[execution.ticker].quantity > 0) {
        positions[execution.ticker].avgCost = positions[execution.ticker].totalCost / positions[execution.ticker].quantity
      }
    })
  
  return Object.values(positions)
    .filter(position => position.quantity > 0)
    .map(position => ({
      ticker: position.ticker,
      quantity: position.quantity,
      avgCost: position.avgCost,
      totalCost: position.totalCost,
      marketValue: position.quantity * position.avgCost
    }))
}

export async function getPositions(portfolioId = null) {
  try {
    let executions
    if (portfolioId) {
      executions = await executionsService.getByPortfolio(portfolioId)
    } else {
      executions = await executionsService.getAll()
    }
    
    return derivePositions(executions)
  } catch {
    return []
  }
}
