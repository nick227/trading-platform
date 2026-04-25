// Recommendation Service - Domain-specific service for recommendations and explainability
// Extracted from alphaEngineService.js for better separation of concerns

import { alphaFetch, cachedFetch, getCacheKey, transformExplainability, transformPerformance } from './alphaEngineService.js'

const RECOMMENDATION_CACHE_TTL = 60 * 60_000 // 1 hour

export default {
  // Health check
  async checkHealth() {
    try {
      return await alphaFetch('/health')
    } catch (error) {
      console.warn('Recommendation service health check failed:', error.message)
      return { status: 'unreachable', error: error.message }
    }
  },

  // Ticker-specific explainability
  async getTickerExplainability(symbol) {
    // /why endpoint not implemented on backend - returning null
    return cachedFetch(
      'EXPLAINABILITY',
      () => getCacheKey('EXPLAINABILITY', symbol),
      () => Promise.resolve(null),
      RECOMMENDATION_CACHE_TTL
    )
  },

  // Ticker performance analysis
  async getTickerPerformance(symbol, window = '30d') {
    return cachedFetch(
      'PERFORMANCE',
      () => getCacheKey('PERFORMANCE', `${symbol}:${window}`),
      () => alphaFetch(`/ticker/${encodeURIComponent(symbol)}/performance?window=${window}`).then(transformPerformance),
      RECOMMENDATION_CACHE_TTL
    )
  },

  // Latest recommendations
  async getRecommendationsLatest(limit = 10, mode = 'balanced', preference = 'absolute') {
    return cachedFetch(
      'RECOMMENDATIONS',
      () => getCacheKey('RECOMMENDATIONS', `latest:${limit}:${mode}:${preference}`),
      () => alphaFetch(`/recommendations/latest?limit=${limit}&mode=${mode}&preference=${preference}&tenant_id=default`),
      RECOMMENDATION_CACHE_TTL
    )
  },

  // Best recommendation
  async getBestRecommendation(mode = 'balanced', preference = 'absolute') {
    return cachedFetch(
      'RECOMMENDATIONS',
      () => getCacheKey('RECOMMENDATIONS', `best:${mode}:${preference}`),
      () => alphaFetch(`/recommendations/best?mode=${mode}&preference=${preference}&tenant_id=default`),
      RECOMMENDATION_CACHE_TTL
    )
  },

  // Ticker-specific recommendation
  async getTickerRecommendation(symbol, mode = 'balanced') {
    return cachedFetch(
      'RECOMMENDATIONS',
      () => getCacheKey('RECOMMENDATIONS', `${symbol}:${mode}`),
      () => alphaFetch(`/recommendations/${encodeURIComponent(symbol)}?mode=${mode}&tenant_id=default`),
      RECOMMENDATION_CACHE_TTL
    )
  },

  // Batch recommendations for multiple tickers
  async getBatchRecommendations(tickers, mode = 'balanced') {
    if (!tickers || tickers.length === 0) return {}

    const tickerList = Array.isArray(tickers) ? tickers.join(',') : tickers
    return cachedFetch(
      'RECOMMENDATIONS',
      () => getCacheKey('RECOMMENDATIONS', `batch:${tickerList}:${mode}`),
      () => alphaFetch(`/recommendations/batch?tickers=${encodeURIComponent(tickerList)}&mode=${mode}&tenant_id=default`),
      RECOMMENDATION_CACHE_TTL
    )
  },

  // Comprehensive dashboard data
  async getDashboardData() {
    try {
      const [health, topRankings, movers, admission] = await Promise.all([
        this.checkHealth(),
        this.getTopRankings(10),
        this.getRankingMovers(20),
        this.getAdmissionChanges(12)
      ])

      return {
        health,
        topRankings,
        movers,
        admission,
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
      throw error
    }
  }
}
