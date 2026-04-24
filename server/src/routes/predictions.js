import predictionsService from '../services/predictionsService.js'
import { engineClient } from '../clients/engine.js'
import { route } from './helpers/routeWrapper.js'
import { ID_PREFIXES } from '../utils/idGenerator.js'

function looksLikeLocalGeneratedPredictionId(id) {
  const pid = String(id ?? '').trim()
  if (!pid) return false
  const parts = pid.split('_')
  // prd_<epochMs>_<TICKER>_<strategyId>_<hash>
  if (parts.length < 5) return false
  if (parts[0] !== ID_PREFIXES.PREDICTION) return false
  if (!/^\d{10,}$/.test(parts[1])) return false
  if (!/^[A-Z0-9.]{1,15}$/.test(parts[2])) return false
  return true
}

export default async function predictionsRoutes(app, opts) {
  app.get('/', route(async (request, reply) => {
    const result = await predictionsService.getPredictions(request.query)
    return reply.send(result)
  }))

  app.get('/:id', route(async (request, reply) => {
    const item = await predictionsService.getPredictionById(request.params.id)
    if (!item) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Prediction not found' } })
    }
    return { data: item }
  }))

  // Unified row-level prediction context payload for UI surfaces.
  app.get('/:id/context', route(async (request, reply) => {
    const predictionId = String(request.params.id ?? '').trim()
    const prediction = await predictionsService.getPredictionById(predictionId)

    try {
      const enginePredictionId = String(prediction?.predictionId ?? '').trim()
      const canProxyToEngine = Boolean(enginePredictionId) || (!looksLikeLocalGeneratedPredictionId(predictionId) && !prediction)

      if (canProxyToEngine) {
        const idForEngine = enginePredictionId || predictionId
        const data = await engineClient.getPredictionContext(idForEngine)
        return { data }
      }
    } catch (error) {
      // Fallback: build a best-effort context from our prediction row (when engine context is unavailable).
    }

    if (!prediction) {
      reply.code(404)
      return { error: { code: 'NOT_FOUND', message: 'Prediction not found' } }
    }

    const ticker = String(prediction.ticker ?? '').toUpperCase().trim()
    let rankScore = null
    let rankingContext = null
    try {
      const rankingsPayload = await engineClient.getTopRankings(100)
      const rows = Array.isArray(rankingsPayload?.rankings) ? rankingsPayload.rankings : []
      const row = rows.find((r) => String(r?.symbol ?? r?.ticker ?? '').toUpperCase() === ticker) ?? null
      const scoreCandidate = row?.score ?? row?.subDrivers?.rankScoreRaw ?? row?.sub_drivers?.rankScoreRaw
      const scoreNum = typeof scoreCandidate === 'number' ? scoreCandidate : Number(scoreCandidate)
      rankScore = Number.isFinite(scoreNum) ? scoreNum : null

      const rankContext = row?.rankContext ?? row?.rank_context ?? row?.subDrivers?.rankContext ?? null
      const basis = Array.isArray(rankContext?.basis) ? rankContext.basis : null
      const timing = Array.isArray(rankContext?.timing) ? rankContext.timing : null
      const risks = Array.isArray(rankContext?.risks) ? rankContext.risks : null
      rankingContext = [basis?.[0], timing?.[0], risks?.[0]].filter(Boolean)
    } catch {
      // ignore
    }

    const coreTimestamp = prediction.predictedAt ? new Date(prediction.predictedAt).toISOString() : null
    const corePrediction = prediction.direction === 'buy' ? 'UP' : prediction.direction === 'sell' ? 'DOWN' : prediction.direction

    return {
      data: {
        ticker,
        timestamp: coreTimestamp,
        prediction: corePrediction,
        confidence: prediction.confidence ?? null,
        horizon: null,
        mode: 'fallback',
        strategyId: prediction.strategyId ?? null,
        rankScore,
        rankingContext,
        featureSnapshot: {
          regime: prediction.regime ?? null,
          entryPrice: prediction.entryPrice ?? null,
          stopPrice: prediction.stopPrice ?? null,
          targetPrice: prediction.targetPrice ?? null
        },
        id: predictionId,
        predictionId: prediction.predictionId ?? predictionId,
        tenant_id: 'default'
      }
    }
  }))
}
