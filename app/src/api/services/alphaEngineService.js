// Alpha Engine API Client Service
// Handles communication with alpha-engine internal read API
// Uses shared cache module for consistency across services

import { getCacheKey, setCacheItem, getCacheItem, deleteCacheItem, invalidateByPattern, invalidationRules, cachedFetch, getCacheMetrics, CACHE_CONFIG, cacheKeys, CACHE_NAMESPACES } from '../../utils/sharedCache.js'

const ALPHA_ENGINE_CONFIG = {
  BASE_URL: '/api/engine',  // Backend proxy
  API_KEY: null,  // Handled by backend
  TIMEOUT: 5000
}

// Enhanced error taxonomy
class AlphaEngineError extends Error {
  constructor(message, status, type = 'network') {
    super(message)
    this.name = 'AlphaEngineError'
    this.status = status
    this.type = type // 'network', 'timeout', 'stale_data', 'partial_data', 'degraded_mode'
  }
}

async function alphaFetch(endpoint, options = {}) {
  const url = `${ALPHA_ENGINE_CONFIG.BASE_URL}${endpoint}`
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  }

  // Backend handles authentication - no API key needed on frontend

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(ALPHA_ENGINE_CONFIG.TIMEOUT)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorType = response.status === 408 ? 'timeout' :
                       response.status >= 500 ? 'degraded_mode' :
                       response.status === 404 ? 'stale_data' : 'network'
      throw new AlphaEngineError(
        errorData.error || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorType
      )
    }

    const json = await response.json()
    // Unwrap server proxy envelope { success: true, data: ... }
    const data = json?.success === true && 'data' in json ? json.data : json
    
    // Add freshness metadata to all responses
    if (data && typeof data === 'object') {
      data._source = 'alpha-engine'
      data._cachedAt = Date.now()
      data._freshness = 'live'
    }
    
    return data
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AlphaEngineError('Request timeout', 408, 'timeout')
    }
    if (error instanceof AlphaEngineError) {
      throw error
    }
    throw new AlphaEngineError(`Network error: ${error.message}`, 0, 'network')
  }
}

// Export fetch + cache utilities for services
export { alphaFetch, getCacheKey, setCacheItem, getCacheItem, deleteCacheItem, invalidateByPattern, invalidationRules, cachedFetch, getCacheMetrics, CACHE_CONFIG }

// Data transformation utilities
function coerceFiniteNumber(value) {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function coerceConfidence(value) {
  const num = coerceFiniteNumber(value)
  if (num === null) return null
  // Support either 0..1 or 0..100 inputs.
  if (num > 1 && num <= 100) return num / 100
  if (num < 0) return 0
  if (num > 1) return 1
  return num
}

function extractSymbol(row) {
  return String(row?.symbol ?? row?.ticker ?? row?.tkr ?? '').toUpperCase()
}

function transformRankingData(data) {
  const rows = Array.isArray(data?.rankings) ? data.rankings : []
  return {
    rankings: rows.map((r, index) => {
      const symbol = extractSymbol(r) || null

      // Keep related-but-distinct measures separate.
      // We still expose a best-effort `confidence` for legacy UI components,
      // but consumers that care about semantics should use the specific fields below.
      const modelConfidence = coerceConfidence(r?.confidence)
      const conviction = coerceConfidence(r?.conviction)
      const attributionConfidence = coerceConfidence(r?.attribution?.confidence)
      const confidence = modelConfidence ?? conviction ?? attributionConfidence

      const score = coerceFiniteNumber(
        r?.score ?? r?.edgeScore ?? r?.score_today ?? r?.multiplier_score
      )

      const edgeScore = coerceFiniteNumber(r?.edgeScore)
      const fragilityScore = coerceFiniteNumber(r?.fragilityScore)
      const regime = typeof r?.regime === 'string' ? r.regime : null
      const price = coerceFiniteNumber(r?.price)
      const dailyChangePct = coerceFiniteNumber(r?.dailyChangePct)

      const currentRank = coerceFiniteNumber(
        r?.currentRank ?? r?.rank_today ?? r?.rank
      )

      const priorRank = coerceFiniteNumber(
        r?.priorRank ?? r?.rank_yesterday ?? r?.previousRank ?? r?.previous_rank
      )

      const explicitRankChange = coerceFiniteNumber(
        r?.rankChange ?? r?.rank_delta ?? r?.rank_change ?? r?.rankDelta
      )

      const rankChange = explicitRankChange !== null
        ? explicitRankChange
        : (currentRank !== null && priorRank !== null ? priorRank - currentRank : null)

      const rank = currentRank !== null ? currentRank : index + 1

      const reasons = Array.isArray(r?.reasons)
        ? r.reasons
        : (Array.isArray(r?.why) ? r.why : [])

      return {
        symbol: symbol || '—',
        rank,
        currentRank,
        priorRank,
        rankChange,
        score,
        edgeScore,
        fragilityScore,
        regime,
        price,
        dailyChangePct,
        confidence,
        modelConfidence,
        conviction,
        attributionConfidence,
        reasons,
        timestamp: r?.timestamp || data?.snapshot_ts_latest || new Date().toISOString()
      }
    }),
    asOf: data.as_of || new Date().toISOString(),
    total: data.total || 0
  }
}

function transformExplainability(data) {
  return {
    symbol: data.symbol,
    explanation: data.explanation || '',
    factors: data.factors || [],
    confidence: data.confidence || 0,
    signals: data.signals || [],
    timestamp: data.timestamp || new Date().toISOString()
  }
}

function transformPerformance(data) {
  return {
    symbol: data.symbol,
    window: data.window,
    returns: data.returns || [],
    benchmark: data.benchmark || [],
    alpha: data.alpha || 0,
    sharpe: data.sharpe || 0,
    maxDrawdown: data.max_drawdown || 0,
    winRate: data.win_rate || 0,
    timestamp: data.timestamp || new Date().toISOString()
  }
}

function transformAdmissionChanges(data) {
  return {
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
  }
}

// Market data transformations for Orders.jsx
function transformTickers(data) {
  if (!data?.tickers || !Array.isArray(data.tickers)) return []

  return data.tickers.map(ticker => {
    // Engine returns either plain symbol strings or enriched ticker objects
    const symbol = typeof ticker === 'string' ? ticker : ticker.symbol
    const name   = typeof ticker === 'string' ? ticker : (ticker.name || ticker.symbol)
    return {
      symbol,
      name,
      price:     ticker.price      || ticker.c           || 0,
      change:    ticker.change     || ticker.dayChangePct || 0,
      volume:    ticker.volume     || 'N/A',
      sector:    ticker.sector     || 'Unknown',
      marketCap: ticker.marketCap  || 'N/A',
      pe:        ticker.pe         || 'N/A',
    }
  })
}

function transformQuote(data) {
  return {
    symbol: data.symbol,
    price: data.c || data.price || 0,
    change: data.dayChangePct || 0,
    volume: data.volume || 0,
    timestamp: data.timestamp || new Date().toISOString()
  }
}

function transformHistory(data) {
  if (!data?.points || !Array.isArray(data.points)) {
    return []
  }

  return data.points.map(point => {
    const dt = new Date(point.t)
    const close = point.c ?? point.close ?? 0
    const open = point.o ?? point.open ?? close
    const high = point.h ?? point.high ?? close
    const low = point.l ?? point.low ?? close
    const volume = point.v ?? point.volume ?? 0

    return {
      ts: Number.isFinite(dt.getTime()) ? dt.getTime() : null,
      date: Number.isFinite(dt.getTime()) ? dt.toISOString().split('T')[0] : null,
      open,
      high,
      low,
      close,
      volume,
      // Back-compat for earlier UI components that expected `price`.
      price: close,
    }
  })
}

function transformStats(data) {
  if (!data) return {}

  return {
    price: data.price || 0,
    dayChangePct: data.dayChangePct || 0,
    high52: data.high52 || 0,
    low52: data.low52 || 0,
    avgVolume: data.avgVolume || 0,
    marketCap: data.marketCap || 0,
    ath: data.ath || 0,
    ipoDate: data.ipoDate || null,
    yearsListed: data.yearsListed || 0
  }
}

function transformCompany(data) {
  return {
    symbol: data.symbol,
    name: data.name,
    sector: data.sector,
    industry: data.industry,
    description: data.description,
    website: data.website,
    employees: data.employees,
    country: data.country,
    currency: data.currency
  }
}

// Alpha Engine API Service
export default {
  // Health check (no auth required)
  async checkHealth() {
    try {
      return await alphaFetch('/health')
    } catch (error) {
      console.warn('Alpha Engine health check failed:', error.message)
      return { status: 'unreachable', error: error.message }
    }
  },

  // Rankings endpoints
  async getTopRankings(limit = 20) {
    return cachedFetch(
      'RANKING',
      () => cacheKeys.engine.ranking('top', limit),
      () => alphaFetch(`/rankings/top?limit=${limit}`).then(transformRankingData),
      CACHE_CONFIG.RANKING
    )
  },

  async getRankingMovers(limit = 50) {
    return cachedFetch(
      'RANKING',
      () => cacheKeys.engine.ranking('movers', limit),
      () => alphaFetch(`/rankings/movers?limit=${limit}`).then(transformRankingData),
      CACHE_CONFIG.RANKING
    )
  },

  // Ticker-specific endpoints
  async getTickerExplainability(symbol) {
    return cachedFetch(
      'EXPLAINABILITY',
      () => cacheKeys.engine.alpha(symbol),
      () => alphaFetch(`/ticker/${encodeURIComponent(symbol)}/why`).then(transformExplainability),
      CACHE_CONFIG.ALPHA
    )
  },

  async getTickerPerformance(symbol, window = '30d') {
    return cachedFetch(
      'PERFORMANCE',
      () => getCacheKey(CACHE_NAMESPACES.ENGINE, 'PERFORMANCE', `${symbol}:${window}`),
      () => alphaFetch(`/ticker/${encodeURIComponent(symbol)}/performance?window=${window}`).then(transformPerformance),
      CACHE_CONFIG.RECOMMENDATION
    )
  },

  // Admission monitoring
  async getAdmissionChanges(hours = 24) {
    const data = await alphaFetch(`/admission/changes?hours=${hours}`)
    return transformAdmissionChanges(data)
  },

  // Combined data for dashboard
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
          type: (Number(r.rankChange) || 0) >= 0 ? 'ENTRY' : 'EXIT',
          symbol: r.symbol,
          confidence: r.confidence,
          score: r.score,
          reasons: r.reasons,
          source: 'mover',
          rankChange: r.rankChange
        }))
      ].sort((a, b) => b.confidence - a.confidence)

      return signals
    } catch (error) {
      console.error('Failed to fetch active signals:', error)
      return []
    }
  },

  // Market data endpoints for Orders.jsx - DEPRECATED - Use bootstrap instead
  // These are kept as fallback for legacy components
  async getTickers(search = '') {
    return cachedFetch(
      'TICKERS',
      () => getCacheKey(CACHE_NAMESPACES.MARKET, 'TICKERS', search || 'all'),
      async () => {
        const query = search ? `?search=${encodeURIComponent(search)}` : ''
        const response = await fetch(`/api/orders/tickers${query}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        return response.json()
      },
      CACHE_CONFIG.QUOTE
    )
  },

  // Legacy quote endpoint - use bootstrap for live data
  async getQuote(symbol) {
    console.warn('getQuote is deprecated - use getBootstrapData for live quotes')
    return cachedFetch(
      'QUOTE',
      () => cacheKeys.market.quote(symbol),
      async () => {
        const response = await fetch(`/api/orders/bootstrap?ticker=${encodeURIComponent(symbol)}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        const data = await response.json()
        return data?.quote
      },
      CACHE_CONFIG.QUOTE
    )
  },

  // Legacy history endpoint - use bootstrap for chart data
  async getHistory(symbol, range = '1Y', interval = '1D') {
    console.warn('getHistory is deprecated - use getBootstrapData for chart data')
    return cachedFetch(
      'HISTORY',
      () => getCacheKey(CACHE_NAMESPACES.MARKET, 'HISTORY', `${symbol}:${range}:${interval}`),
      async () => {
        const response = await fetch(`/api/orders/bootstrap?ticker=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        const data = await response.json()
        return data?.history || []
      },
      CACHE_CONFIG.HISTORY
    )
  },

  async getCandles(symbol, range = '1Y', interval = '1D') {
    return cachedFetch(
      'CANDLES',
      () => getCacheKey(CACHE_NAMESPACES.MARKET, 'CANDLES', `${symbol}:${range}:${interval}`),
      async () => {
        const response = await fetch(`/api/engine/api/candles/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&tenant_id=default`)
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        return response.json()
      },
      CACHE_CONFIG.HISTORY
    )
  },

  async getStats(symbol) {
    return cachedFetch(
      'STATS',
      () => cacheKeys.market.stats(symbol),
      async () => {
        const response = await fetch(`/api/engine/api/stats/${encodeURIComponent(symbol)}?tenant_id=default`)
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        const data = await response.json()
        return transformStats(data)
      },
      CACHE_CONFIG.STATS
    )
  },

  async getCompany(symbol) {
    return cachedFetch(
      'COMPANY',
      () => cacheKeys.market.company(symbol),
      async () => {
        const response = await fetch(`/api/engine/api/company/${encodeURIComponent(symbol)}?tenant_id=default`)
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        const data = await response.json()
        return transformCompany(data)
      },
      CACHE_CONFIG.COMPANY
    )
  },

  // Bootstrap endpoint - single request for all ticker data
  async getBootstrapData(symbol, range = '1Y', interval = '1D') {
    return cachedFetch(
      'BOOTSTRAP',
      () => cacheKeys.market.bootstrap(symbol, range, interval),
      async () => {
        try {
          // Use new market bootstrap endpoint that blends worker + alpha-engine data
          // Call directly without BASE_URL prefix since it's a different route
          const response = await fetch(`/api/market/bootstrap/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`)
          if (!response.ok) throw new AlphaEngineError(`HTTP ${response.status}: ${response.statusText}`, response.status, 'stale_data')
          const data = await response.json()
          
          // Add freshness metadata
          const enhancedData = {
            ...data,
            _source: 'market-bootstrap',
            _cachedAt: Date.now(),
            _freshness: 'live'
          }
          
          return {
            ...enhancedData,
            // history arrives as { points: [{t, c}] } — normalize to [{date, price, volume}]
            history: transformHistory(data.history),
          }
        } catch (error) {
          console.error(`Failed to load bootstrap data for ${symbol}:`, error)
          // Fallback to legacy orders endpoint
          const fallbackData = await alphaFetch(`/orders/bootstrap?ticker=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`)
          if (fallbackData) {
            const enhancedFallback = {
              ...fallbackData,
              _source: 'legacy-bootstrap',
              _cachedAt: Date.now(),
              _freshness: 'degraded'
            }
            return { ...enhancedFallback, history: transformHistory(fallbackData.history) }
          }
          return null
        }
      },
      CACHE_CONFIG.BOOTSTRAP,
      { allowStale: true } // Enable stale-while-revalidate
    )
  },

  // Recommendations endpoints
  async getRecommendationsLatest(limit = 10, mode = 'balanced', preference = 'absolute') {
    return cachedFetch(
      'RECOMMENDATIONS',
      () => getCacheKey(CACHE_NAMESPACES.ENGINE, 'RECOMMENDATIONS', `latest:${limit}:${mode}:${preference}`),
      () => alphaFetch(`/api/recommendations/latest?limit=${limit}&mode=${mode}&preference=${preference}&tenant_id=default`),
      CACHE_CONFIG.RECOMMENDATION
    )
  },

  async getBestRecommendation(mode = 'balanced', preference = 'absolute') {
    return cachedFetch(
      'RECOMMENDATIONS',
      () => getCacheKey(CACHE_NAMESPACES.ENGINE, 'RECOMMENDATIONS', `best:${mode}:${preference}`),
      () => alphaFetch(`/api/recommendations/best?mode=${mode}&preference=${preference}&tenant_id=default`),
      CACHE_CONFIG.RECOMMENDATION
    )
  },

  async getTickerRecommendation(symbol, mode = 'balanced') {
    return cachedFetch(
      'RECOMMENDATIONS',
      () => cacheKeys.engine.recommendation(symbol),
      () => alphaFetch(`/api/recommendations/${encodeURIComponent(symbol)}?mode=${mode}&tenant_id=default`),
      CACHE_CONFIG.RECOMMENDATION
    )
  },

  async getBatchRecommendations(tickers, mode = 'balanced') {
    if (!tickers || tickers.length === 0) return {}
    
    const tickerList = Array.isArray(tickers) ? tickers.join(',') : tickers
    return cachedFetch(
      'RECOMMENDATIONS',
      () => getCacheKey(CACHE_NAMESPACES.ENGINE, 'RECOMMENDATIONS', `batch:${tickerList}:${mode}`),
      () => alphaFetch(`/api/recommendations/batch?tickers=${encodeURIComponent(tickerList)}&mode=${mode}&tenant_id=default`),
      CACHE_CONFIG.RECOMMENDATION
    )
  },

  // Batch load all data needed for a ticker (fallback method)
  async getTickerData(symbol) {
    try {
      const [quote, stats, company, history, explainability, recommendation] = await Promise.all([
        this.getQuote(symbol).catch(() => null),
        this.getStats(symbol).catch(() => null),
        this.getCompany(symbol).catch(() => null),
        this.getHistory(symbol).catch(() => null),
        this.getTickerExplainability(symbol).catch(() => null),
        this.getTickerRecommendation(symbol).catch(() => null)
      ])

      return {
        quote,
        stats,
        company,
        history,
        alpha: explainability,
        recommendation
      }
    } catch (error) {
      console.error(`Failed to load ticker data for ${symbol}:`, error)
      return null
    }
  }
}
