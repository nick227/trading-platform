import { engineClient } from '../clients/engine.js'
import { ID_PREFIXES, simpleHash } from '../utils/idGenerator.js'

// NOTE: Prediction table exists but is not currently used.
// Predictions are read directly from alpha-engine via engineClient.
// This allows for future prediction storage/ingestion if needed.

function mapPrediction(raw) {
  // Stable, collision-safe ID using hash of stable input
  const stable = {
    timestamp: raw.timestamp,
    ticker: raw.ticker,
    strategyId: raw.strategyId,
    prediction: raw.prediction
  }
  const hash = simpleHash(JSON.stringify(stable))
  const id = raw.id ?? `${ID_PREFIXES.PREDICTION}_${raw.timestamp}_${raw.ticker}_${raw.strategyId}_${hash}`
  
  return {
    id,
    strategyId: raw.strategyId,
    ticker: raw.ticker,
    direction: raw.prediction === 'UP' ? 'buy' : 'sell',
    confidence: raw.confidence,
    entryPrice: raw.entryPrice,
    stopPrice: raw.stopPrice ?? null,
    targetPrice: raw.targetPrice ?? null,
    predictedAt: (() => {
      const ts = Number(raw.timestamp)
      return Number.isFinite(ts) ? ts : new Date(raw.timestamp).getTime()
    })(),
    regime: raw.regime ?? 'unknown',
    reasoning: raw.reasoning ?? ''
  }
}

export default {
  async getPredictions(query) {
    const raw = await engineClient.getPredictions(query)
    
    // Dedupe predictions by ID to prevent duplicates
    const seen = new Set()
    const data = raw
      .map(mapPrediction)
      .filter(p => {
        if (seen.has(p.id)) return false
        seen.add(p.id)
        return true
      })
    
    return {
      data,
      pagination: {
        hasMore: false,
        nextCursor: null
      }
    }
  },

  async getPredictionById(id) {
    // TODO: replace with direct engine lookup when GET /internal/predictions/:id is available
    // Current implementation fetches all predictions and filters in memory - fine for POC but inefficient at scale
    const { data } = await this.getPredictions({})
    return data.find(p => p.id === id) || null
  }
}
