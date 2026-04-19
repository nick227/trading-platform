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

  // Active signals for trading
  async getActiveSignals() {
    const [topRankings, movers] = await Promise.all([
      this.getTopRankings(5),
      this.getRankingMovers(15)
    ])

    // Transform into signal format
    const signals = [
      ...topRankings.rankings.slice(0, 3).map(r => ({
        type: 'ENTRY',
        symbol: r.symbol,
        confidence: r.confidence,
        score: r.score,
        reasons: r.reasons || [],
        source: 'top_ranked'
      })),
      ...movers.rankings.slice(0, 5).map(r => ({
        type: r.rank > 0 ? 'ENTRY' : 'EXIT',
        symbol: r.symbol,
        confidence: r.confidence,
        score: r.score,
        reasons: r.reasons || [],
        source: 'mover',
        rankChange: r.rank
      }))
    ].sort((a, b) => b.confidence - a.confidence)

    return signals
  }
}
