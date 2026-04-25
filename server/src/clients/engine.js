import prisma from '../loaders/prisma.js'

const ENGINE_URL = process.env.ENGINE_URL ?? 'http://localhost:8090'
const INTERNAL_READ_KEY = process.env.INTERNAL_READ_KEY
const MIN_PRICE_CAP_RECOMMENDATIONS = 10

const ENGINE_SYMBOL_ALIASES = {
  // Yahoo-style aliases commonly used by the UI.
  'BRK.B': ['BRK-B'],
  'BF.B': ['BF-B'],
  VIX: ['^VIX'],
  DXY: ['DX-Y.NYB', '^DXY']
}

// Crypto pair normalization - convert to Alpha Engine compatible format
function normalizeCryptoSymbol(symbol) {
  const normalized = String(symbol ?? '').toUpperCase().trim()
  // Convert BTC-USD -> BTC, ETH-USD -> ETH, etc. (strip currency suffix entirely)
  if (/-USD$/.test(normalized)) {
    return normalized.replace('-USD', '')
  }
  if (/-USDT$/.test(normalized)) {
    return normalized.replace('-USDT', '')
  }
  if (/-USDC$/.test(normalized)) {
    return normalized.replace('-USDC', '')
  }
  return normalized
}

const SYMBOL_RETRY_STATUS = new Set([400, 404, 422, 500])

function normalizeSymbol(symbol) {
  return normalizeCryptoSymbol(symbol)
}

function symbolCandidates(symbol) {
  const base = normalizeSymbol(symbol)
  if (!base) return []
  const aliases = ENGINE_SYMBOL_ALIASES[base] ?? []
  return [base, ...aliases].filter((value, idx, arr) => arr.indexOf(value) === idx)
}

// Shared rankings cache to prevent duplicate upstream calls
// Strategy: Always fetch limit=50 from upstream (cost is same as limit=5)
// Cache the full result and slice for smaller requests
const rankingsCache = new Map()
const RANKINGS_CACHE_TTL_MS = 30_000
const RANKINGS_CACHE_FETCH_LIMIT = 50

function getRankingsCacheKey(maxFragility) {
  return `rankings:${maxFragility ?? 'null'}`
}

function getCachedRankings(maxFragility) {
  const key = getRankingsCacheKey(maxFragility)
  const entry = rankingsCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    rankingsCache.delete(key)
    return null
  }
  return entry.data
}

function setCachedRankings(maxFragility, data) {
  const key = getRankingsCacheKey(maxFragility)
  rankingsCache.set(key, {
    data,
    expiresAt: Date.now() + RANKINGS_CACHE_TTL_MS
  })
  if (rankingsCache.size > 10) {
    const keys = Array.from(rankingsCache.keys())
    keys.slice(0, 3).forEach(k => rankingsCache.delete(k))
  }
}

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

  let response
  const t0 = Date.now()
  try {
    response = await fetch(url, {
      ...options,
      headers
    })
  } catch (error) {
    const err = new Error('Alpha Engine unreachable')
    err.statusCode = 502
    err.cause = error
    throw err
  }

  const t1 = Date.now()
  const networkTime = t1 - t0

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    const snippet = errorText && errorText.length > 500 ? `${errorText.slice(0, 500)}…` : errorText
    const err = new Error(`Alpha Engine ${response.status}: ${snippet}`)
    err.statusCode = response.status
    throw err
  }

  const json = await response.json()
  const t2 = Date.now()
  const parseTime = t2 - t1

  // Log timing for ranking endpoints
  if (endpoint.includes('/ranking/')) {
    console.log(`[engine_fetch] endpoint=${endpoint} network=${networkTime}ms parse=${parseTime}ms total=${t2 - t0}ms`)
  }

  return json
}

async function engineFetchWithSymbolFallback(makeEndpoint, symbol, options) {
  const candidates = symbolCandidates(symbol)
  if (candidates.length === 0) {
    const err = new Error('Symbol is required')
    err.statusCode = 400
    throw err
  }

  let lastError = null
  for (let idx = 0; idx < candidates.length; idx += 1) {
    const candidate = candidates[idx]
    try {
      const data = await engineFetch(makeEndpoint(candidate), options)
      return { data, requested: candidates[0], resolved: candidate }
    } catch (error) {
      lastError = error
      const canRetry = idx < candidates.length - 1 && SYMBOL_RETRY_STATUS.has(error?.statusCode)
      if (!canRetry) throw error
    }
  }

  throw lastError
}

function normalizeRecommendationsPayload(data) {
  if (Array.isArray(data)) {
    return { recommendations: data }
  }
  if (!data || typeof data !== 'object') {
    return { recommendations: [] }
  }
  if (Array.isArray(data.recommendations)) {
    return data
  }

  const fromItems = Array.isArray(data.items) ? data.items : null
  const fromResults = Array.isArray(data.results) ? data.results : null
  const fromCandidates = Array.isArray(data.candidates) ? data.candidates : null
  const fromSingle = data.recommendation && typeof data.recommendation === 'object' ? [data.recommendation] : null

  const recommendations = fromItems ?? fromResults ?? fromCandidates ?? fromSingle ?? []
  return { ...data, recommendations }
}

function toNumber(value) {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function recommendationSymbol(rec) {
  return String(rec?.ticker ?? rec?.symbol ?? '').toUpperCase()
}

function extractTickerValue(row) {
  return String(row?.ticker ?? row?.symbol ?? row?.tkr ?? '').toUpperCase()
}

async function getDiscoveryFallbackRows({ capNum, mode, targetCount, seen }) {
  if (!Number.isFinite(capNum) || targetCount <= 0) return []

  let rows = []
  try {
    rows = await prisma.$queryRaw`
      SELECT
        ds.symbol,
        ds.name,
        ds.marketCap,
        ds.avgVolume,
        ds.isTradable,
        ds.untradableReason,
        lq.last AS livePrice,
        lq.changePct AS liveChangePct,
        lq.updatedAt AS quoteUpdatedAt
      FROM DiscoverySymbol ds
      INNER JOIN LiveQuote lq ON lq.ticker COLLATE utf8mb4_unicode_ci = ds.symbol COLLATE utf8mb4_unicode_ci
      WHERE lq.last IS NOT NULL
        AND lq.last <= ${capNum}
      ORDER BY ds.isTradable DESC, ds.avgVolume DESC, ds.marketCap DESC, lq.updatedAt DESC
      LIMIT ${targetCount * 4}
    `
  } catch {
    return []
  }

  const fallbackRows = []
  for (const row of rows) {
    if (fallbackRows.length >= targetCount) break
    const ticker = String(row.symbol ?? '').toUpperCase()
    if (!ticker || seen.has(ticker)) continue
    const price = toNumber(row.livePrice)
    if (price === null || price > capNum) continue

    fallbackRows.push({
      ticker,
      symbol: ticker,
      action: 'WATCH',
      confidence: null,
      score: null,
      entryZone: [price, price],
      priceCap: capNum,
      mode,
      asOf: row.quoteUpdatedAt ? new Date(row.quoteUpdatedAt).toISOString() : new Date().toISOString(),
      source: 'discovery_universe',
      isTradable: Boolean(row.isTradable),
      untradableReason: row.untradableReason ?? null,
      name: row.name ?? null,
      marketCap: row.marketCap ?? null,
      avgVolume: row.avgVolume ?? null,
      dailyChangePct: toNumber(row.liveChangePct)
    })
    seen.add(ticker)
  }

  return fallbackRows
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
  async getTopRankings(limit = 20, maxFragility = null) {
    // Check shared cache first (cache key based on maxFragility only, not limit)
    const cached = getCachedRankings(maxFragility)
    if (cached) {
      // Slice cached result to requested limit
      const sliced = {
        ...cached,
        rankings: Array.isArray(cached.rankings) ? cached.rankings.slice(0, limit) : []
      }
      console.log(`[getTopRankings] CACHE HIT limit=${limit} maxFragility=${maxFragility}`)
      return sliced
    }

    // Not cached - fetch with larger limit (upstream cost is same regardless of limit)
    const t0 = Date.now()
    const params = new URLSearchParams()
    params.set('limit', String(RANKINGS_CACHE_FETCH_LIMIT))
    if (maxFragility !== null && maxFragility !== undefined && Number.isFinite(Number(maxFragility))) {
      params.set('maxFragility', String(maxFragility))
    }
    const result = await engineFetch(`/ranking/top?${params.toString()}`)
    const t1 = Date.now()
    console.log(`[getTopRankings] CACHE MISS limit=${limit} maxFragility=${maxFragility} total=${t1 - t0}ms responseSize=${JSON.stringify(result).length}bytes`)

    // Cache the full result for 30 seconds
    setCachedRankings(maxFragility, result)

    // Slice to requested limit
    const sliced = {
      ...result,
      rankings: Array.isArray(result.rankings) ? result.rankings.slice(0, limit) : []
    }
    return sliced
  },

  async getRankingMovers(limit = 50) {
    return engineFetch(`/ranking/movers?limit=${limit}`)
  },

  // Regime endpoint — returns null when alpha-engine reports insufficient_history (422)
  async getRegime(symbol) {
    try {
      const { data, requested, resolved } = await engineFetchWithSymbolFallback(
        (s) => `/api/regime/${encodeURIComponent(s)}?tenant_id=default`,
        symbol
      )
      if (data && typeof data === 'object') {
        if ('symbol' in data) data.symbol = requested
        if ('ticker' in data) data.ticker = requested
        if (resolved !== requested && !('_engineSymbol' in data)) data._engineSymbol = resolved
      }
      return data
    } catch (err) {
      if (err.statusCode === 422) return null
      throw err
    }
  },

  // Ticker-specific endpoints
  async getTickerExplainability(symbol) {
    const { data, requested, resolved } = await engineFetchWithSymbolFallback(
      (s) => `/ticker/${encodeURIComponent(s)}/why`,
      symbol
    )
    if (data && typeof data === 'object') {
      if ('symbol' in data) data.symbol = requested
      if ('ticker' in data) data.ticker = requested
      if (resolved !== requested && !('_engineSymbol' in data)) data._engineSymbol = resolved
    }
    return data
  },

  async getTickerPerformance(symbol, window = '30d') {
    const { data, requested, resolved } = await engineFetchWithSymbolFallback(
      (s) => `/ticker/${encodeURIComponent(s)}/performance?window=${window}`,
      symbol
    )
    if (data && typeof data === 'object') {
      if ('symbol' in data) data.symbol = requested
      if ('ticker' in data) data.ticker = requested
      if (resolved !== requested && !('_engineSymbol' in data)) data._engineSymbol = resolved
    }
    return data
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
    const { data, requested, resolved } = await engineFetchWithSymbolFallback(
      (s) => `/api/quote/${encodeURIComponent(s)}?tenant_id=default`,
      symbol
    )
    if (data && typeof data === 'object') {
      if ('symbol' in data) data.symbol = requested
      if ('ticker' in data) data.ticker = requested
      if (resolved !== requested && !('_engineSymbol' in data)) data._engineSymbol = resolved
    }
    return data
  },

  async getHistory(symbol, range = '1Y', interval = '1D') {
    const { data, requested, resolved } = await engineFetchWithSymbolFallback(
      (s) => `/api/history/${encodeURIComponent(s)}?range=${range}&interval=${interval}&tenant_id=default`,
      symbol
    )
    if (data && typeof data === 'object' && resolved !== requested && !('_engineSymbol' in data)) data._engineSymbol = resolved
    return data
  },

  async getCandles(symbol, range = '1Y', interval = '1D') {
    const { data, requested, resolved } = await engineFetchWithSymbolFallback(
      (s) => `/api/candles/${encodeURIComponent(s)}?range=${range}&interval=${interval}&tenant_id=default`,
      symbol
    )
    if (data && typeof data === 'object' && resolved !== requested && !('_engineSymbol' in data)) data._engineSymbol = resolved
    return data
  },

  async getStats(symbol) {
    const { data, requested, resolved } = await engineFetchWithSymbolFallback(
      (s) => `/api/stats/${encodeURIComponent(s)}?tenant_id=default`,
      symbol
    )
    if (data && typeof data === 'object') {
      if ('symbol' in data) data.symbol = requested
      if ('ticker' in data) data.ticker = requested
      if (resolved !== requested && !('_engineSymbol' in data)) data._engineSymbol = resolved
    }
    return data
  },

  async getCompany(symbol) {
    const { data, requested, resolved } = await engineFetchWithSymbolFallback(
      (s) => `/api/company/${encodeURIComponent(s)}?tenant_id=default`,
      symbol
    )
    if (data && typeof data === 'object') {
      if ('symbol' in data) data.symbol = requested
      if ('ticker' in data) data.ticker = requested
      if (resolved !== requested && !('_engineSymbol' in data)) data._engineSymbol = resolved
    }
    return data
  },

  // Research endpoints (direct proxy to engine)
  async getTickerAccuracy(symbol) {
    const { data, requested, resolved } = await engineFetchWithSymbolFallback(
      (s) => `/api/ticker/${encodeURIComponent(s)}/accuracy?tenant_id=default`,
      symbol
    )
    if (data && typeof data === 'object') {
      if ('symbol' in data) data.symbol = requested
      if ('ticker' in data) data.ticker = requested
      if (resolved !== requested && !('_engineSymbol' in data)) data._engineSymbol = resolved
    }
    return data
  },

  async getTickerAttribution(symbol) {
    const { data, requested, resolved } = await engineFetchWithSymbolFallback(
      (s) => `/api/ticker/${encodeURIComponent(s)}/attribution?tenant_id=default`,
      symbol
    )
    if (data && typeof data === 'object') {
      if ('symbol' in data) data.symbol = requested
      if ('ticker' in data) data.ticker = requested
      if (resolved !== requested && !('_engineSymbol' in data)) data._engineSymbol = resolved
    }
    return data
  },

  async getConsensusSignals(symbol) {
    const { data, requested, resolved } = await engineFetchWithSymbolFallback(
      (s) => `/api/consensus/signals?ticker=${encodeURIComponent(s)}&tenant_id=default`,
      symbol
    )
    if (data && typeof data === 'object' && resolved !== requested && !('_engineSymbol' in data)) data._engineSymbol = resolved
    return data
  },

  async getPredictionContext(predictionId) {
    const id = String(predictionId ?? '').trim()
    if (!id) {
      const err = new Error('prediction_id is required')
      err.statusCode = 400
      throw err
    }
    return engineFetch(`/api/predictions/${encodeURIComponent(id)}/context?tenant_id=default`)
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
    const data = await engineFetch(`/api/recommendations/latest${query}`)
    return normalizeRecommendationsPayload(data)
  },

  async getBestRecommendation(mode = 'balanced', preference = 'absolute') {
    const query = `?mode=${mode}&preference=${preference}&tenant_id=default`
    const data = await engineFetch(`/api/recommendations/best${query}`)
    return normalizeRecommendationsPayload(data)
  },

  async getTickerRecommendation(symbol, mode = 'balanced') {
    return engineFetch(`/api/recommendations/${encodeURIComponent(symbol)}?mode=${mode}&tenant_id=default`)
  },

  async getBatchRecommendations(tickers, mode = 'balanced') {
    if (!tickers || tickers.length === 0) return {}
    
    const tickerList = Array.isArray(tickers) ? tickers.join(',') : tickers
    return engineFetch(`/api/recommendations/batch?tickers=${encodeURIComponent(tickerList)}&mode=${mode}&tenant_id=default`)
  },

  // Price-capped recommendations (direct proxy to engine)
  async getRecommendationsUnder(priceCap, mode = 'balanced', limit = 25, preference = null) {
    const capNum = toNumber(priceCap)
    const params = new URLSearchParams()
    params.set('mode', mode)
    params.set('limit', String(limit))
    if (preference) params.set('preference', preference)
    params.set('tenant_id', 'default')

    let normalized = { recommendations: [] }
    try {
      const data = await engineFetch(`/api/recommendations/under/${encodeURIComponent(String(priceCap))}?${params.toString()}`)
      normalized = normalizeRecommendationsPayload(data)
    } catch {
      // Keep discovery cards available even if alpha-engine is offline.
      normalized = { recommendations: [] }
    }
    const existing = Array.isArray(normalized.recommendations) ? normalized.recommendations : []
    const targetCount = Math.min(limit, MIN_PRICE_CAP_RECOMMENDATIONS)
    const withMeta = (recommendations) => {
      const returnedCount = Array.isArray(recommendations) ? recommendations.length : 0
      const shortfall = Math.max(0, targetCount - returnedCount)
      return {
        ...normalized,
        recommendations,
        meta: {
          targetCount,
          returnedCount,
          liveOnly: true,
          complete: shortfall === 0,
          reason: shortfall > 0 ? 'insufficient_live_quotes' : null
        }
      }
    }

    if (!Number.isFinite(capNum) || existing.length >= targetCount) {
      return withMeta(existing)
    }

    const seen = new Set(existing.map(recommendationSymbol).filter(Boolean))
    let rankingRows = []
    try {
      // Use smaller limit for fallback - we only need targetCount items
      const rankingsPayload = await this.getTopRankings(Math.min(targetCount * 2, 50))
      rankingRows = Array.isArray(rankingsPayload?.rankings) ? rankingsPayload.rankings : []
    } catch {
      rankingRows = []
    }
    const rankedTickers = rankingRows
      .map((row) => String(row?.ticker ?? row?.symbol ?? '').toUpperCase())
      .filter(Boolean)
      .filter((ticker) => !seen.has(ticker))

    const fallbackRows = []
    for (const ticker of rankedTickers) {
      if (existing.length + fallbackRows.length >= targetCount) break
      try {
        const quote = await this.getQuote(ticker)
        const price = toNumber(quote?.price ?? quote?.last)
        if (price === null || price > capNum) continue

        const ranked = rankingRows.find((row) => String(row?.ticker ?? row?.symbol ?? '').toUpperCase() === ticker)
        fallbackRows.push({
          ticker,
          symbol: ticker,
          action: 'WATCH',
          confidence: ranked?.confidence ?? null,
          score: ranked?.score ?? null,
          entryZone: [price, price],
          priceCap: capNum,
          mode,
          asOf: new Date().toISOString(),
          source: 'ranking_fallback'
        })
        seen.add(ticker)
      } catch {
        // Keep fallback best-effort when quote lookup fails.
      }
    }

    if (existing.length + fallbackRows.length < targetCount) {
      let universeTickers = []
      try {
        const tickersPayload = await this.getTickers('')
        const tickersData = tickersPayload?.data ?? tickersPayload
        universeTickers = Array.isArray(tickersData?.tickers)
          ? tickersData.tickers
          : (Array.isArray(tickersData) ? tickersData : [])
      } catch {
        universeTickers = []
      }
      const universeSymbols = universeTickers
        .map(extractTickerValue)
        .filter(Boolean)
        .filter((ticker) => !seen.has(ticker))

      for (const ticker of universeSymbols) {
        if (existing.length + fallbackRows.length >= targetCount) break
        try {
          const quote = await this.getQuote(ticker)
          const price = toNumber(quote?.price ?? quote?.last)
          if (price === null || price > capNum) continue

          fallbackRows.push({
            ticker,
            symbol: ticker,
            action: 'WATCH',
            confidence: null,
            score: null,
            entryZone: [price, price],
            priceCap: capNum,
            mode,
            asOf: new Date().toISOString(),
            source: 'universe_fallback'
          })
          seen.add(ticker)
        } catch {
          // Keep fallback best-effort when quote lookup fails.
        }
      }
    }

    if (existing.length + fallbackRows.length < targetCount) {
      const needed = targetCount - (existing.length + fallbackRows.length)
      const discoveryRows = await getDiscoveryFallbackRows({
        capNum,
        mode,
        targetCount: needed,
        seen
      })
      fallbackRows.push(...discoveryRows)
    }

    const merged = [...existing, ...fallbackRows].slice(0, limit)
    return withMeta(merged)
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
  },

  // Calendar events with distribution support
  async getCalendarEvents(month = null, limit = 50, distribution = 'uniform', minDays = 12) {
    const params = new URLSearchParams()
    if (month) params.set('month', month)
    params.set('limit', String(limit))
    params.set('distribution', distribution)
    params.set('min_days', String(minDays))
    params.set('tenant_id', 'default')
    
    return engineFetch(`/api/engine/calendar?${params.toString()}`)
  }
}
