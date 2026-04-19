// Backend Alpha Engine API Client Service
// Handles communication with our backend which proxies to alpha-engine
// This keeps the internal API key secure on the server side

class BackendEngineError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'BackendEngineError'
    this.status = status
  }
}

async function backendFetch(endpoint, options = {}) {
  const url = `/api/engine${endpoint}`
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new BackendEngineError(
        errorData.error || `HTTP ${response.status}: ${response.statusText}`,
        response.status
      )
    }

    const result = await response.json()
    
    // Our backend wraps responses in { success: true, data: ... }
    if (!result.success) {
      throw new BackendEngineError(result.error || 'Backend request failed', 500)
    }
    
    return result.data
  } catch (error) {
    if (error instanceof BackendEngineError) {
      throw error
    }
    throw new BackendEngineError(`Network error: ${error.message}`, 0)
  }
}

// Data transformation utilities (same as before)
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

// Backend Engine API Service
export default {
  // Health check
  async checkHealth() {
    try {
      return await backendFetch('/health')
    } catch (error) {
      console.warn('Backend Engine health check failed:', error.message)
      return { status: 'unreachable', error: error.message }
    }
  },

  // Rankings endpoints
  async getTopRankings(limit = 20) {
    const data = await backendFetch(`/rankings/top?limit=${limit}`)
    return transformRankingData(data)
  },

  async getRankingMovers(limit = 50) {
    const data = await backendFetch(`/rankings/movers?limit=${limit}`)
    return transformRankingData(data)
  },

  // Ticker-specific endpoints
  async getTickerExplainability(symbol) {
    const data = await backendFetch(`/ticker/${encodeURIComponent(symbol)}/explainability`)
    return transformExplainability(data)
  },

  async getTickerPerformance(symbol, window = '30d') {
    const data = await backendFetch(`/ticker/${encodeURIComponent(symbol)}/performance?window=${window}`)
    return transformPerformance(data)
  },

  // Admission monitoring
  async getAdmissionChanges(hours = 24) {
    const data = await backendFetch(`/admission/changes?hours=${hours}`)
    return transformAdmissionChanges(data)
  },

  // Combined data for dashboard
  async getDashboardData() {
    try {
      const data = await backendFetch('/dashboard')
      return data
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
      throw error
    }
  },

  // Real-time signals for active trading
  async getActiveSignals() {
    try {
      const signals = await backendFetch('/signals/active')
      return signals
    } catch (error) {
      console.error('Failed to fetch active signals:', error)
      return []
    }
  }
}
