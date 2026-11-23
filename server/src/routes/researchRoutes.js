import { engineClient } from '../clients/engine.js'
import { route } from './helpers/routeWrapper.js'
import { simulationConfig } from '../services/simulationService.js'

/**
 * Latest verified Alpha Engine research for one symbol — the same lookup the bot engine uses
 * (historical-replay session in simulator mode). Research is descriptive input, never advice:
 * status is 'available' | 'none' (nothing published) | 'unavailable' (engine unreachable).
 */
export async function symbolResearch(symbol, { engine = engineClient, config = simulationConfig() } = {}) {
  // Replay looks up the replayed session's publication; paper_daily and live use the latest.
  const replay = config.enabled && config.mode === 'historical_replay'
  const mode = replay ? 'historical_replay' : 'live'
  const session = replay ? config.session : null
  let found
  try {
    found = await engine.locateResearchPrediction(symbol, 'default', { mode, session })
  } catch {
    return { symbol, status: 'unavailable', mode, session }
  }
  if (!found) return { symbol, status: 'none', mode, session }
  let ev = null
  try {
    const trace = await engine.getPredictionTrace(found.predictionId)
    ev = trace?.evidence?.snapshot ?? trace?.evidence ?? null
  } catch { /* detail is optional; quality below is from the publication index */ }
  const q = found.quality ?? {}
  return {
    symbol,
    status: 'available',
    mode,
    session,
    publicationId: found.publicationId,
    marketDate: found.marketDate,
    publishedAt: found.rankedAt,
    direction: ev?.direction ?? null,
    horizon: ev?.horizon ?? null,
    score: ev?.confidence ?? ev?.rankScore ?? null,
    model: ev?.strategyId ?? null,
    holdout: { hitRate: q.holdoutPrecision ?? null, baselineRate: q.baselineRate ?? null },
    edgeOverBaseline: q.edgeOverBaseline ?? null,
    genuineOutOfSample: q.genuineOutOfSample ?? null,
    run: found.run,
  }
}

export default async function researchRoutes(fastify, opts) {
  fastify.get('/research/:symbol', route(async (request) => {
    return { success: true, data: await symbolResearch(String(request.params.symbol).toUpperCase()) }
  }))

  fastify.get('/api/ticker/:symbol/accuracy', route(async (request, reply) => {
    const { symbol } = request.params
    const data = await engineClient.getTickerAccuracy(symbol)
    return { success: true, data }
  }))

  fastify.get('/api/ticker/:symbol/attribution', route(async (request, reply) => {
    const { symbol } = request.params
    const data = await engineClient.getTickerAttribution(symbol)
    return { success: true, data }
  }))

  fastify.get('/api/consensus/signals', route(async (request, reply) => {
    const { ticker } = request.query
    if (!ticker) {
      reply.code(400)
      return { success: false, error: 'ticker query param is required' }
    }
    const data = await engineClient.getConsensusSignals(String(ticker))
    return { success: true, data }
  }))
}
