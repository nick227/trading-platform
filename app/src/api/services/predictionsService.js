import { get } from '../client'
import { SIDE } from '../constants.js'

export function mapPrediction(p) {
  return {
    ...p,
    side: p.direction === 'buy' ? SIDE.BUY : SIDE.SELL,
    confidencePct: Math.round(p.confidence * 100)  // 0.85 -> 85
  }
}

export default {
  async getAll() {
    try {
      const predictions = await get('/predictions')
      return predictions.map(mapPrediction)
    } catch {
      return []
    }
  },
  
  async getById(id) {
    try {
      const predictions = await get('/predictions')
      return predictions.map(mapPrediction).find(signal => signal.id === id)
    } catch {
      return null
    }
  },
  
  async getByStrategy(strategyId) {
    try {
      const predictions = await get('/predictions', { strategyId })
      return predictions
        .filter(p => p.strategyId === strategyId)
        .map(mapPrediction)
        .sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  },
  
  async getByTicker(ticker) {
    try {
      const predictions = await get('/predictions', { ticker })
      return predictions
        .filter(p => p.ticker === ticker)
        .map(mapPrediction)
        .sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  }
}
