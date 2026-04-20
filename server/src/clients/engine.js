const ENGINE_URL = process.env.ENGINE_URL ?? 'http://localhost:8090'
const INTERNAL_READ_KEY = process.env.INTERNAL_READ_KEY

async function engineFetch(endpoint, options = {}) {
  const url = `${ENGINE_URL}${endpoint}`
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  }

  // Add internal API key for authentication (skip for health checks)
  if (INTERNAL_READ_KEY && !endpoint.includes('/health')) {
    headers['X-Internal-Key'] = INTERNAL_READ_KEY
  }

  const response = await fetch(url, {
    ...options,
    headers
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Alpha Engine ${response.status}: ${errorText}`)
  }

  return response.json()
}

export const engineClient = {
  // Alpha Engine health check
  async checkHealth() {
    try {
      return await engineFetch('/health')
    } catch (error) {
      return { status: 'unreachable', error: error.message }
    }
  },

  // Rankings endpoints
  async getTopRankings(limit = 20) {
    return engineFetch(`/ranking/top?limit=${limit}`)
  },

  async getRankingMovers(limit = 50) {
    return engineFetch(`/ranking/movers?limit=${limit}`)
  },

  // Ticker-specific endpoints
  async getTickerExplainability(symbol) {
    return engineFetch(`/ticker/${encodeURIComponent(symbol)}/why`)
  },

  async getTickerPerformance(symbol, window = '30d') {
    return engineFetch(`/ticker/${encodeURIComponent(symbol)}/performance?window=${window}`)
  },

  // Admission monitoring
  async getAdmissionChanges(hours = 24) {
    return engineFetch(`/admission/changes?hours=${hours}`)
  },

  // Market data endpoints for Orders.jsx
  async getTickers(search = '') {
    const query = search ? `?q=${encodeURIComponent(search)}&tenant_id=default` : '?tenant_id=default'
    return engineFetch(`/api/tickers${query}`)
  },

  async getQuote(symbol) {
    return engineFetch(`/api/quote/${encodeURIComponent(symbol)}?tenant_id=default`)
  },

  async getHistory(symbol, range = '1Y', interval = '1D') {
    return engineFetch(`/api/history/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&tenant_id=default`)
  },

  async getCandles(symbol, range = '1Y', interval = '1D') {
    return engineFetch(`/api/candles/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&tenant_id=default`)
  },

  async getStats(symbol) {
    return engineFetch(`/api/stats/${encodeURIComponent(symbol)}?tenant_id=default`)
  },

  async getCompany(symbol) {
    return engineFetch(`/api/company/${encodeURIComponent(symbol)}?tenant_id=default`)
  },

  // Bootstrap data for Orders page - combines multiple alpha-engine calls
  async getBootstrapData(symbol, range = '1Y', interval = '1D') {
    try {
      const [quote, stats, company, history, explainability, recommendation] = await Promise.all([
        this.getQuote(symbol).catch(() => null),
        this.getStats(symbol).catch(() => null),
        this.getCompany(symbol).catch(() => null),
        this.getHistory(symbol, range, interval).catch(() => null),
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
      console.error(`Failed to load bootstrap data for ${symbol}:`, error)
      return null
    }
  },

  // Combined dashboard data
  async getDashboardData() {
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
  },

  // Recommendations endpoints
  async getRecommendationsLatest(limit = 10, mode = 'balanced', preference = 'absolute') {
    const query = `?limit=${limit}&mode=${mode}&preference=${preference}&tenant_id=default`
    return engineFetch(`/api/recommendations/latest${query}`)
  },

  async getBestRecommendation(mode = 'balanced', preference = 'absolute') {
    const query = `?mode=${mode}&preference=${preference}&tenant_id=default`
    return engineFetch(`/api/recommendations/best${query}`)
  },

  async getTickerRecommendation(symbol, mode = 'balanced') {
    return engineFetch(`/api/recommendations/${encodeURIComponent(symbol)}?mode=${mode}&tenant_id=default`)
  },

  async getBatchRecommendations(tickers, mode = 'balanced') {
    if (!tickers || tickers.length === 0) return {}
    
    const tickerList = Array.isArray(tickers) ? tickers.join(',') : tickers
    return engineFetch(`/api/recommendations/batch?tickers=${encodeURIComponent(tickerList)}&mode=${mode}&tenant_id=default`)
  },

  // Active signals for trading
  async getActiveSignals() {
    const [topRankings, movers] = await Promise.all([
      this.getTopRankings(5),
      this.getRankingMovers(15)
    ])

    // Transform into signal format with safe array handling
    const topSignals = (topRankings?.rankings || []).slice(0, 3).map(r => ({
      type: 'ENTRY',
      symbol: r.symbol,
      confidence: r.confidence,
      score: r.score,
      reasons: r.reasons || [],
      source: 'top_ranked'
    }))
    
    const moverSignals = (movers?.rankings || []).slice(0, 5).map(r => ({
      type: r.rank > 0 ? 'ENTRY' : 'EXIT',
      symbol: r.symbol,
      confidence: r.confidence,
      score: r.score,
      reasons: r.reasons || [],
      source: 'mover',
      rankChange: r.rank
    }))

    return [...topSignals, ...moverSignals].sort((a, b) => b.confidence - a.confidence)
  }
}
