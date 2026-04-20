// Ranking Service - Domain-specific service for rankings and movers
// Extracted from alphaEngineService.js for better separation of concerns

import { alphaFetch, cachedFetch, getCacheKey, transformRankingData } from './alphaEngineService.js'

const RANKING_CACHE_TTL = 5 * 60_000 // 5 minutes

export default {
  // Health check
  async checkHealth() {
    try {
      return await alphaFetch('/health')
    } catch (error) {
      console.warn('Ranking service health check failed:', error.message)
      return { status: 'unreachable', error: error.message }
    }
  },

  // Top rankings
  async getTopRankings(limit = 20) {
    return cachedFetch(
      'RANKING',
      () => getCacheKey('RANKING', `top:${limit}`),
      () => alphaFetch(`/rankings/top?limit=${limit}`).then(transformRankingData),
      RANKING_CACHE_TTL
    )
  },

  // Market movers
  async getRankingMovers(limit = 50) {
    return cachedFetch(
      'RANKING',
      () => getCacheKey('RANKING', `movers:${limit}`),
      () => alphaFetch(`/rankings/movers?limit=${limit}`).then(transformRankingData),
      RANKING_CACHE_TTL
    )
  },

  // Admission monitoring
  async getAdmissionChanges(hours = 24) {
    return cachedFetch(
      'ADMISSION',
      () => getCacheKey('ADMISSION', `${hours}h`),
      () => alphaFetch(`/admission/changes?hours=${hours}`).then(data => ({
        changes: data.changes?.map(c => ({
          symbol: c.symbol,
          action: c.action, // 'admitted', 'removed', 'queued'
          reason: c.reason || '',
          timestamp: c.timestamp || new Date().toISOString(),
          confidence: c.confidence || 0
        })) || [],
        summary: {
          admitted: data.summary?.admitted || 0,
          removed: data.summary?.removed || 0,
          queued: data.summary?.queued || 0
        },
        period: data.period || '24h'
      })),
      RANKING_CACHE_TTL
    )
  },

  // Real-time signals for active trading
  async getActiveSignals() {
    try {
      const [topRankings, movers] = await Promise.all([
        this.getTopRankings(5),
        this.getRankingMovers(15)
      ])

      // Combine and prioritize signals
      const signals = [
        ...topRankings.rankings.slice(0, 3).map(r => ({
          type: 'ENTRY',
          symbol: r.symbol,
          confidence: r.confidence,
          score: r.score,
          reasons: r.reasons,
          source: 'top_ranked'
        })),
        ...movers.rankings.slice(0, 5).map(r => ({
          type: r.rank > 0 ? 'ENTRY' : 'EXIT',
          symbol: r.symbol,
          confidence: r.confidence,
          score: r.score,
          reasons: r.reasons,
          source: 'mover',
          rankChange: r.rank
        }))
      ].sort((a, b) => b.confidence - a.confidence)

      return signals
    } catch (error) {
      console.error('Failed to fetch active signals:', error)
      return []
    }
  }
}
