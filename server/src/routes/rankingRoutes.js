import { engineClient } from '../clients/engine.js'
import { rankingEnrichmentService } from '../services/rankingEnrichmentService.js'
import { route } from './helpers/routeWrapper.js'
import { clampInt, clampNumber } from './helpers/validation.js'

const RANKING_CACHE_TTL_MS = 30_000
const rankingCache = new Map()

function getCacheKey(endpoint, params) {
  return `${endpoint}:${JSON.stringify(params)}`
}

function getCachedRanking(key) {
  const entry = rankingCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    rankingCache.delete(key)
    return null
  }
  return entry.data
}

function setCachedRanking(key, data) {
  rankingCache.set(key, {
    data,
    expiresAt: Date.now() + RANKING_CACHE_TTL_MS
  })
  if (rankingCache.size > 50) {
    const keys = Array.from(rankingCache.keys())
    keys.slice(0, 10).forEach(k => rankingCache.delete(k))
  }
}

export default async function rankingRoutes(fastify, opts) {
  fastify.get('/rankings/top', route(async (request, reply) => {
    const { limit = 20, maxFragility = null } = request.query
    const limitClamped = clampInt(limit, 1, 100, 20)
    const maxFragilityNum = clampNumber(maxFragility, 0, 100, null)

    const cacheKey = getCacheKey('top', { limit: limitClamped, maxFragility: maxFragilityNum })
    const cached = getCachedRanking(cacheKey)
    if (cached) return { success: true, data: cached }

    const t0 = Date.now()
    const raw = await engineClient.getTopRankings(limitClamped, maxFragilityNum)
    const t1 = Date.now()
    request.log.info({ stage: 'fetch_raw', durationMs: t1 - t0 }, 'rankings_timing')

    const data = await rankingEnrichmentService.enrich(raw, { logger: request.log })
    const t2 = Date.now()
    request.log.info({ stage: 'enrich', durationMs: t2 - t1 }, 'rankings_timing')

    setCachedRanking(cacheKey, data)
    const t3 = Date.now()
    request.log.info({ stage: 'total', durationMs: t3 - t0 }, 'rankings_timing')

    return { success: true, data }
  }))

  fastify.get('/rankings/movers', route(async (request, reply) => {
    const { limit = 50 } = request.query
    const limitClamped = clampInt(limit, 1, 100, 50)

    const cacheKey = getCacheKey('movers', { limit: limitClamped })
    const cached = getCachedRanking(cacheKey)
    if (cached) return { success: true, data: cached }

    const raw = await engineClient.getRankingMovers(limitClamped)
    const data = await rankingEnrichmentService.enrich(raw)
    setCachedRanking(cacheKey, data)
    return { success: true, data }
  }))
}
