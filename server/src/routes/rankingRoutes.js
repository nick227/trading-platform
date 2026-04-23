import { engineClient } from '../clients/engine.js'
import { rankingEnrichmentService } from '../services/rankingEnrichmentService.js'
import { route } from './helpers/routeWrapper.js'
import { clampInt, clampNumber } from './helpers/validation.js'

export default async function rankingRoutes(fastify, opts) {
  fastify.get('/rankings/top', route(async (request, reply) => {
    const { limit = 20, maxFragility = null } = request.query
    const limitClamped = clampInt(limit, 1, 100, 20)
    const maxFragilityNum = clampNumber(maxFragility, 0, 100, null)

    const raw = await engineClient.getTopRankings(limitClamped, maxFragilityNum)
    const data = await rankingEnrichmentService.enrich(raw)
    return { success: true, data }
  }))

  fastify.get('/rankings/movers', route(async (request, reply) => {
    const { limit = 50 } = request.query
    const limitClamped = clampInt(limit, 1, 100, 50)

    const raw = await engineClient.getRankingMovers(limitClamped)
    const data = await rankingEnrichmentService.enrich(raw)
    return { success: true, data }
  }))
}
