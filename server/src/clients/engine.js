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
const RANKINGS_STALE_TTL_MS = 60_000 // Allow stale data for 60s while revalidating
const RANKINGS_EMERGENCY_STALE_MS = 300_000 // 5 min emergency fallback
const RANKINGS_CACHE_FETCH_LIMIT = 50

// Separate cache for movers with different TTL
const moversCache = new Map()
const MOVERS_CACHE_TTL_MS = 30_000
const MOVERS_STALE_TTL_MS = 60_000

// Separate cache for quotes with shorter TTL (more time-sensitive)
const quotesCache = new Map()
const QUOTES_CACHE_TTL_MS = 5_000
const QUOTES_STALE_TTL_MS = 15_000

// Add jitter to TTL to prevent synchronized expiry
function addJitter(baseTtlMs, jitterPct = 0.16) {
  const jitterMs = baseTtlMs * jitterPct
  const randomJitter = (Math.random() - 0.5) * 2 * jitterMs
  return baseTtlMs + randomJitter
}

// In-flight promise deduplication to prevent cache stampede
const inFlightRankings = new Map()

// Cache metrics tracking
const cacheMetrics = {
  rankings: { hit: 0, stale: 0, miss: 0, dedupe: 0, error: 0 },
  movers: { hit: 0, stale: 0, miss: 0, error: 0 },
  quotes: { hit: 0, stale: 0, miss: 0, error: 0 }
}

function getRankingsCacheKey(maxFragility) {
  return `rankings:${maxFragility ?? 'null'}`
}

function getCachedRankings(maxFragility, allowStale = false, allowEmergency = false) {
  const key = getRankingsCacheKey(maxFragility)
  const entry = rankingsCache.get(key)
  if (!entry) return null

  const now = Date.now()
  const isFresh = now < entry.expiresAt
  const isStale = now < entry.expiresAt + RANKINGS_STALE_TTL_MS
  const isEmergency = now < entry.expiresAt + RANKINGS_EMERGENCY_STALE_MS

  if (isFresh) {
    return { data: entry.data, isStale: false, isEmergency: false }
  }

  if (isStale && allowStale) {
    return { data: entry.data, isStale: true, isEmergency: false }
  }

  if (isEmergency && allowEmergency) {
    return { data: entry.data, isStale: true, isEmergency: true }
  }

  // Expired beyond emergency window
  rankingsCache.delete(key)
  return null
}

function setCachedRankings(maxFragility, data) {
  const key = getRankingsCacheKey(maxFragility)
  rankingsCache.set(key, {
    data,
    expiresAt: Date.now() + addJitter(RANKINGS_CACHE_TTL_MS)
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
    // Use base cache key (null) for all requests - filter locally
    const baseCacheKey = getRankingsCacheKey(null)

    // Check for stale cache first (stale-while-revalidate)
    const cached = getCachedRankings(null, true)
    if (cached) {
      let rankings = Array.isArray(cached.data.rankings) ? cached.data.rankings : []

      // Apply fragility filter locally if specified
      if (maxFragility !== null && maxFragility !== undefined && Number.isFinite(Number(maxFragility))) {
        const fragilityThreshold = Number(maxFragility)
        rankings = rankings.filter(r => {
          const fragility = Number(r?.fragility ?? r?.fragility_score ?? 0)
          return fragility <= fragilityThreshold
        })
        console.log(`[getTopRankings] LOCAL FILTER limit=${limit} maxFragility=${maxFragility} filtered=${rankings.length}/${cached.data.rankings?.length}`)
      }

      // Slice to requested limit
      const sliced = {
        ...cached.data,
        rankings: rankings.slice(0, limit)
      }
      console.log(`[getTopRankings] CACHE ${cached.isStale ? 'STALE' : 'HIT'} limit=${limit} maxFragility=${maxFragility}`)

      // Track metrics
      if (cached.isEmergency) {
        cacheMetrics.rankings.emergency++
      } else if (cached.isStale) {
        cacheMetrics.rankings.stale++
      } else {
        cacheMetrics.rankings.hit++
      }

      // If stale, trigger background refresh without waiting
      if (cached.isStale && !inFlightRankings.has(baseCacheKey)) {
        const refreshPromise = (async () => {
          try {
            const t0 = Date.now()
            // Always fetch base rankings (no fragility filter)
            const result = await engineFetch(`/ranking/top?limit=${RANKINGS_CACHE_FETCH_LIMIT}`)
            const t1 = Date.now()
            console.log(`[getTopRankings] BACKGROUND REFRESH total=${t1 - t0}ms`)
            setCachedRankings(null, result)
          } catch (error) {
            cacheMetrics.rankings.error++
            console.error('[getTopRankings] Background refresh failed:', error.message)
          } finally {
            inFlightRankings.delete(baseCacheKey)
          }
        })()

        inFlightRankings.set(baseCacheKey, refreshPromise)
      }

      return sliced
    }

    // Check if there's already an in-flight request for base cache
    if (inFlightRankings.has(baseCacheKey)) {
      console.log(`[getTopRankings] IN-FLIGHT DEDUPE limit=${limit} maxFragility=${maxFragility}`)
      cacheMetrics.rankings.dedupe++
      const result = await inFlightRankings.get(baseCacheKey)

      // Apply fragility filter locally if specified
      let rankings = Array.isArray(result.rankings) ? result.rankings : []
      if (maxFragility !== null && maxFragility !== undefined && Number.isFinite(Number(maxFragility))) {
        const fragilityThreshold = Number(maxFragility)
        rankings = rankings.filter(r => {
          const fragility = Number(r?.fragility ?? r?.fragility_score ?? 0)
          return fragility <= fragilityThreshold
        })
        console.log(`[getTopRankings] LOCAL FILTER limit=${limit} maxFragility=${maxFragility} filtered=${rankings.length}/${result.rankings?.length}`)
      }

      return {
        ...result,
        rankings: rankings.slice(0, limit)
      }
    }

    // Not cached and no in-flight request - fetch base rankings (no fragility filter)
    const t0 = Date.now()
    const fetchPromise = (async () => {
      try {
        // Always fetch base rankings without fragility filter
        const result = await engineFetch(`/ranking/top?limit=${RANKINGS_CACHE_FETCH_LIMIT}`)
        const t1 = Date.now()
        console.log(`[getTopRankings] CACHE MISS total=${t1 - t0}ms responseSize=${JSON.stringify(result).length}bytes`)
        cacheMetrics.rankings.miss++

        // Cache the base result
        setCachedRankings(null, result)

        // Apply fragility filter locally if specified
        let rankings = Array.isArray(result.rankings) ? result.rankings : []
        if (maxFragility !== null && maxFragility !== undefined && Number.isFinite(Number(maxFragility))) {
          const fragilityThreshold = Number(maxFragility)
          rankings = rankings.filter(r => {
            const fragility = Number(r?.fragility ?? r?.fragility_score ?? 0)
            return fragility <= fragilityThreshold
          })
          console.log(`[getTopRankings] LOCAL FILTER limit=${limit} maxFragility=${maxFragility} filtered=${rankings.length}/${result.rankings?.length}`)
        }

        // Slice to requested limit
        const sliced = {
          ...result,
          rankings: rankings.slice(0, limit)
        }
        return sliced
      } catch (error) {
        cacheMetrics.rankings.error++
        console.error('[getTopRankings] Fetch failed:', error.message)
        throw error
      } finally {
        // Clean up in-flight promise when done
        inFlightRankings.delete(baseCacheKey)
      }
    })()

    inFlightRankings.set(baseCacheKey, fetchPromise)
    return fetchPromise
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
      const [quote, stats, company, history, regime, recommendation] = await Promise.all([
        this.getQuote(symbol).catch(() => null),
        this.getStats(symbol).catch(() => null),
        this.getCompany(symbol).catch(() => null),
        this.getHistory(symbol, range, interval).catch(() => null),
        this.getRegime(symbol).catch(() => null),
        this.getTickerRecommendation(symbol).catch(() => null)
      ])

      return {
        quote,
        stats,
        company,
        history,
        regime,
        alpha: null,
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

  // Price-capped recommendations (derived from canonical rankings cache)
  async getRecommendationsUnder(priceCap, mode = 'balanced', limit = 25, preference = null) {
    const capNum = toNumber(priceCap)
    const targetCount = Math.min(limit, MIN_PRICE_CAP_RECOMMENDATIONS)

    if (!Number.isFinite(capNum)) {
      return { recommendations: [], meta: { targetCount, returnedCount: 0, complete: false, reason: 'invalid_price_cap' } }
    }

    // Try upstream first for engine-native recommendations
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
      // Engine unavailable - fall back to deriving from cached rankings
    }

    const existing = Array.isArray(normalized.recommendations) ? normalized.recommendations : []

    // If upstream returned enough results, return them
    if (existing.length >= targetCount) {
      return {
        ...normalized,
        recommendations: existing.slice(0, limit),
        meta: {
          targetCount,
          returnedCount: existing.length,
          liveOnly: true,
          complete: true,
          source: 'engine_native'
        }
      }
    }

    // Derive from canonical rankings cache (in-flight dedup + stale-while-revalidate)
    const seen = new Set(existing.map(recommendationSymbol).filter(Boolean))
    let rankingRows = []
    try {
      // Fetch from canonical cache - this triggers in-flight dedup if multiple calls happen
      const rankingsPayload = await this.getTopRankings(RANKINGS_CACHE_FETCH_LIMIT)
      rankingRows = Array.isArray(rankingsPayload?.rankings) ? rankingsPayload.rankings : []
    } catch {
      rankingRows = []
    }

    const derivedRows = []
    for (const row of rankingRows) {
      if (derivedRows.length + existing.length >= targetCount) break

      const ticker = String(row?.ticker ?? row?.symbol ?? '').toUpperCase()
      if (!ticker || seen.has(ticker)) continue

      const price = toNumber(row?.price ?? row?.last ?? row?.entry)
      if (price === null || price > capNum) continue

      derivedRows.push({
        ticker,
        symbol: ticker,
        action: 'WATCH',
        confidence: row?.confidence ?? null,
        score: row?.score ?? null,
        entryZone: [price, price],
        priceCap: capNum,
        mode,
        asOf: row?.asOf ?? new Date().toISOString(),
        source: 'canonical_rankings'
      })
      seen.add(ticker)
    }

    const merged = [...existing, ...derivedRows].slice(0, limit)
    const returnedCount = merged.length
    const shortfall = Math.max(0, targetCount - returnedCount)

    return {
      recommendations: merged,
      meta: {
        targetCount,
        returnedCount,
        liveOnly: true,
        complete: shortfall === 0,
        reason: shortfall > 0 ? 'insufficient_under_cap' : null,
        source: existing.length > 0 ? 'hybrid' : 'canonical_rankings'
      }
    }
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

// Cache warming function - call at server boot
export async function warmCache() {
  console.log('[cache_warm] Starting cache warm-up...')
  const startTime = Date.now()

  try {
    // Prime rankings (canonical cache)
    await engineClient.getTopRankings(50)
    console.log('[cache_warm] Rankings cache primed')

    // Prime movers
    await engineClient.getRankingMovers(50)
    console.log('[cache_warm] Movers cache primed')

    // Prime major quotes
    const majors = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META']
    await Promise.all(majors.map(ticker => engineClient.getQuote(ticker).catch(() => null)))
    console.log('[cache_warm] Major quotes cache primed')

    const elapsed = Date.now() - startTime
    console.log(`[cache_warm] Complete in ${elapsed}ms`)
  } catch (error) {
    console.error('[cache_warm] Failed:', error.message)
  }
}

// Get cache metrics for monitoring
export function getCacheMetrics() {
  return { ...cacheMetrics }
}
