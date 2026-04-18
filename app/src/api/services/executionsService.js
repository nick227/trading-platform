import { get, post } from '../client'
import { SIDE } from '../constants.js'

export function mapExecution(e) {
  return {
    ...e,
    side: e.direction === 'buy' ? SIDE.BUY : SIDE.SELL,
    // Note: cost is calculated in display, not stored
  }
}

export default {
  async getAll() {
    try {
      const executions = await get('/executions')
      return executions.map(mapExecution)
    } catch {
      return []
    }
  },
  
  async getById(id) {
    try {
      const executions = await get('/executions')
      return executions.map(mapExecution).find(execution => execution.id === id)
    } catch {
      return null
    }
  },
  
  async getByTicker(ticker) {
    try {
      const executions = await get('/executions', { ticker })
      return executions
        .map(mapExecution)
        .sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  },
  
  async getByStrategy(strategyId) {
    try {
      const executions = await get('/executions', { strategyId })
      return executions
        .map(mapExecution)
        .sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  },
  
  async getByPortfolio(portfolioId) {
    try {
      const executions = await get('/executions', { portfolioId })
      return executions
        .map(mapExecution)
        .sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  },
  
  async create(data) {
    try {
      // Map frontend format to backend format
      const execution = {
        portfolioId: data.portfolioId,
        strategyId: data.strategyId,
        predictionId: data.signalId,
        ticker: data.ticker,
        direction: data.side.toLowerCase(),  // BUY -> buy
        quantity: data.quantity,
        price: data.price,
        commission: 4.95,
        fees: data.quantity * data.price * 0.001
      }
      
      const result = await post('/executions', execution)
      return mapExecution(result)
    } catch {
      return null
    }
  },
  
  async getSummary() {
    try {
      return await get('/executions/summary')
    } catch {
      return null
    }
  }
}
