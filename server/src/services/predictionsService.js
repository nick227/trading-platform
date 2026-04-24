import { engineClient } from '../clients/engine.js'
import { oldEngineClient } from '../clients/oldEngine.js'
import { ID_PREFIXES, simpleHash } from '../utils/idGenerator.js'

// NOTE: Prediction table exists but is not currently used.
// Predictions are read from the legacy internal engine service.
// Alpha-engine rankings/signals are exposed separately through /api/engine.

function mapPrediction(raw) {
  // Stable, collision-safe ID using hash of stable input
  const stable = {
    timestamp: raw.timestamp,
    ticker: raw.ticker,
    strategyId: raw.strategyId,
    prediction: raw.prediction
  }
  const hash = simpleHash(JSON.stringify(stable))
  const enginePredictionId = raw?.predictionId ?? raw?.prediction_id ?? raw?.id ?? null
  const id = enginePredictionId ?? `${ID_PREFIXES.PREDICTION}_${raw.timestamp}_${raw.ticker}_${raw.strategyId}_${hash}`
  
  return {
    id,
    predictionId: enginePredictionId ?? null,
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

function toEpochMs(value) {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const d = new Date(value)
  const ts = d.getTime()
  return Number.isFinite(ts) ? ts : null
}

function mapAlphaEnginePrediction(raw) {
  const predictionId = String(raw?.predictionId ?? raw?.prediction_id ?? raw?.id ?? '').trim()
  const ticker = String(raw?.ticker ?? raw?.symbol ?? '').toUpperCase().trim()
  if (!predictionId || !ticker) return null

  const p = String(raw?.prediction ?? '').toUpperCase()
  const direction = p.includes('DOWN') || p.includes('SELL') || p.includes('SHORT') || p === 'DN'
    ? 'sell'
    : p.includes('UP') || p.includes('BUY') || p.includes('LONG') || p === 'UP'
      ? 'buy'
      : null

  const confidence = raw?.confidence == null ? null : Number(raw.confidence)

  return {
    id: predictionId,
    predictionId,
    strategyId: raw?.strategyId ?? raw?.strategy_id ?? null,
    ticker,
    direction: direction ?? 'buy',
    confidence: Number.isFinite(confidence) ? confidence : null,
    entryPrice: raw?.entryPrice ?? raw?.entry_price ?? null,
    stopPrice: raw?.stopPrice ?? raw?.stop_price ?? null,
    targetPrice: raw?.targetPrice ?? raw?.target_price ?? null,
    predictedAt: toEpochMs(raw?.timestamp ?? raw?.predictedAt ?? raw?.predicted_at) ?? Date.now(),
    regime: raw?.regime ?? 'unknown',
    reasoning: raw?.reasoning ?? ''
  }
}

function coerceConfidence(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  if (num > 1 && num <= 100) return num / 100
  if (num < 0) return 0
  if (num > 1) return 1
  return num
}

function mapRankingToPrediction(raw, source = 'alpha_ranking') {
  const ticker = String(raw?.ticker ?? raw?.symbol ?? '').toUpperCase().trim()
  if (!ticker) return null

  const tsMs = toEpochMs(raw?.timestamp) ?? Date.now()
  const stable = {
    timestamp: tsMs,
    ticker,
    strategyId: source,
    prediction: 'UP'
  }
  const hash = simpleHash(JSON.stringify(stable))
  const id = `${ID_PREFIXES.PREDICTION}_${tsMs}_${ticker}_${source}_${hash}`

  const confidence = coerceConfidence(raw?.conviction ?? raw?.confidence ?? raw?.attribution?.confidence)
  const rankContext = raw?.rankContext ?? raw?.rank_context ?? raw?.subDrivers?.rankContext ?? null

  const basis = Array.isArray(rankContext?.basis) ? rankContext.basis : null
  const timing = Array.isArray(rankContext?.timing) ? rankContext.timing : null
  const risks = Array.isArray(rankContext?.risks) ? rankContext.risks : null
  const reasoning = [basis?.[0], timing?.[0], risks?.[0]].filter(Boolean).join(' â€¢ ')

  return {
    id,
    predictionId: null,
    strategyId: source,
    ticker,
    direction: 'buy',
    confidence,
    entryPrice: null,
    stopPrice: null,
    targetPrice: null,
    predictedAt: tsMs,
    regime: raw?.regime ?? 'unknown',
    reasoning
  }
}

function filterPredictions(rows, query) {
  const q = query && typeof query === 'object' ? query : {}
  const ticker = q.ticker ? String(q.ticker).toUpperCase().trim() : null
  const strategyId = q.strategyId ? String(q.strategyId).trim() : null
  const direction = q.direction ? String(q.direction).toLowerCase().trim() : null

  const dateFrom = q.dateFrom != null ? Number(q.dateFrom) : null
  const dateTo = q.dateTo != null ? Number(q.dateTo) : null

  return rows.filter((p) => {
    if (ticker && String(p.ticker).toUpperCase() !== ticker) return false
    if (strategyId && String(p.strategyId) !== strategyId) return false
    if (direction && String(p.direction) !== direction) return false

    if (dateFrom != null && Number.isFinite(dateFrom) && Number(p.predictedAt) < dateFrom) return false
    if (dateTo != null && Number.isFinite(dateTo) && Number(p.predictedAt) > dateTo) return false

    return true
  })
}

export default {
  async getPredictions(query) {
    // Fallback: derive "prediction-like" rows from ranking snapshots (always available in alpha-engine).
    try {
      const limit = Math.max(1, Math.min(100, Number(query?.limit) || 25))
      const rankingsPayload = await engineClient.getTopRankings(limit)
      const rows = Array.isArray(rankingsPayload?.rankings) ? rankingsPayload.rankings : []
      const mapped = rows.map((r) => mapRankingToPrediction(r, 'alpha_ranking')).filter(Boolean)
      const filtered = filterPredictions(mapped, query)
      filtered.sort((a, b) => (Number(b.predictedAt) || 0) - (Number(a.predictedAt) || 0))

      return {
        data: filtered,
        pagination: {
          hasMore: false,
          nextCursor: null
        },
        degraded: true,
        degradedReason: 'PREDICTIONS_FROM_RANKINGS'
      }
    } catch {
      // continue to legacy fallback
    }

    try {
      const raw = await oldEngineClient.getPredictions(query)

      // Dedupe predictions by ID to prevent duplicates
      const seen = new Set()
      const data = raw
        .map(mapPrediction)
        .filter((p) => {
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
    } catch {
      return {
        data: [],
        pagination: {
          hasMore: false,
          nextCursor: null
        },
        degraded: true,
        degradedReason: 'PREDICTIONS_UNAVAILABLE'
      }
    }
  },

  async getPredictionById(id) {
    const pid = String(id ?? '').trim()
    if (!pid) return null

    try {
      const rankingsPayload = await engineClient.getTopRankings(100)
      const rows = Array.isArray(rankingsPayload?.rankings) ? rankingsPayload.rankings : []
      const mapped = rows.map((r) => mapRankingToPrediction(r, 'alpha_ranking')).filter(Boolean)
      const match = mapped.find((p) => p.id === pid) ?? null
      if (match) return match
    } catch {
      // ignore
    }

    try {
      const { data } = await this.getPredictions({})
      return data.find((p) => p.id === pid) || null
    } catch {
      return null
    }
  }
}
