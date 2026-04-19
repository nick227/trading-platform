// Alpha Engine API Client Service
// Handles communication with alpha-engine internal read API

const ALPHA_ENGINE_CONFIG = {
  BASE_URL: import.meta.env.VITE_ALPHA_ENGINE_URL || 'http://127.0.0.1:8090',
  API_KEY: import.meta.env.VITE_ALPHA_ENGINE_KEY || '',
  TIMEOUT: 5000
}

class AlphaEngineError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'AlphaEngineError'
    this.status = status
  }
}

async function alphaFetch(endpoint, options = {}) {
  const url = `${ALPHA_ENGINE_CONFIG.BASE_URL}${endpoint}`
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  }

  // Add API key if available and required
  if (ALPHA_ENGINE_CONFIG.API_KEY && !endpoint.includes('/health')) {
    headers['X-Internal-Key'] = ALPHA_ENGINE_CONFIG.API_KEY
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(ALPHA_ENGINE_CONFIG.TIMEOUT)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new AlphaEngineError(
        errorData.error || `HTTP ${response.status}: ${response.statusText}`,
        response.status
      )
    }

    return await response.json()
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AlphaEngineError('Request timeout', 408)
    }
    if (error instanceof AlphaEngineError) {
      throw error
    }
    throw new AlphaEngineError(`Network error: ${error.message}`, 0)
  }
}

// Data transformation utilities
function transformRankingData(data) {
  return {
    rankings: data.rankings?.map(r => ({
      symbol: r.symbol,
      rank: r.rank,
      score: r.score,
      confidence: r.confidence,
      reasons: r.reasons || [],
      timestamp: r.timestamp || new Date().toISOString()
    })) || [],
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
    const data = await alphaFetch(`/ranking/top?limit=${limit}`)
    return transformRankingData(data)
  },

  async getRankingMovers(limit = 50) {
    const data = await alphaFetch(`/ranking/movers?limit=${limit}`)
    return transformRankingData(data)
  },

  // Ticker-specific endpoints
  async getTickerExplainability(symbol) {
    const data = await alphaFetch(`/ticker/${encodeURIComponent(symbol)}/why`)
    return transformExplainability(data)
  },

  async getTickerPerformance(symbol, window = '30d') {
    const data = await alphaFetch(`/ticker/${encodeURIComponent(symbol)}/performance?window=${window}`)
    return transformPerformance(data)
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
