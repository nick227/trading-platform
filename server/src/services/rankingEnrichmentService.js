import { engineClient } from '../clients/engine.js'

const QUOTE_ENRICH_TTL_MS = 30_000
const HISTORY_ENRICH_TTL_MS = 5 * 60_000
const CACHE_MAX_SIZE = 1000
const PRUNE_INTERVAL_MS = 60_000

class QuoteCache {
  constructor({ maxSize = CACHE_MAX_SIZE, ttlMs = QUOTE_ENRICH_TTL_MS } = {}) {
    this.cache = new Map()
    this.maxSize = maxSize
    this.ttlMs = ttlMs
    this.pruneTimer = null
    this.startPruning()
  }

  get(key) {
    const entry = this.cache.get(key)
    const now = Date.now()

    if (!entry) return null
    if (entry.expiresAt <= now) {
      this.cache.delete(key)
      return null
    }

    return entry.quote
  }

  set(key, quote) {
    const now = Date.now()
    this.cache.set(key, { quote, expiresAt: now + this.ttlMs })

    if (this.cache.size > this.maxSize) {
      this.prune()
    }
  }

  prune() {
    const now = Date.now()
    const keysToDelete = []

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key))

    if (this.cache.size > this.maxSize) {
      const entriesArray = Array.from(this.cache.entries())
      entriesArray.sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      const deleteCount = this.cache.size - this.maxSize
      for (let i = 0; i < deleteCount; i++) {
        this.cache.delete(entriesArray[i][0])
      }
    }
  }

  startPruning() {
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS)
    // Don't keep the process alive solely for cache pruning (helps tests/one-off imports).
    if (typeof this.pruneTimer?.unref === 'function') this.pruneTimer.unref()
  }

  stopPruning() {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }
  }

  size() {
    return this.cache.size
  }
}

const quoteCache = new QuoteCache({ ttlMs: QUOTE_ENRICH_TTL_MS })
const historyCache = new QuoteCache({ ttlMs: HISTORY_ENRICH_TTL_MS })

function getRowTicker(row) {
  return String(row?.ticker ?? row?.symbol ?? row?.tkr ?? '').toUpperCase()
}

function coerceNumber(value) {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function normalizeRankingsRows(data) {
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.rankings)) return data.rankings

  const risers = Array.isArray(data.risers) ? data.risers : []
  const fallers = Array.isArray(data.fallers) ? data.fallers : []
  if (risers.length === 0 && fallers.length === 0) return []

  const toRow = (row, direction) => {
    const ticker = getRowTicker(row)
    const currentRank = coerceNumber(row?.currentRank ?? row?.current_rank ?? row?.rank_today ?? row?.rank)
    const priorRank = coerceNumber(row?.priorRank ?? row?.prior_rank ?? row?.rank_yesterday ?? row?.previous_rank)
    const explicitDelta = coerceNumber(row?.rankChange ?? row?.rank_change ?? row?.rank_delta)
    const computedDelta =
      explicitDelta !== null
        ? explicitDelta
        : (currentRank !== null && priorRank !== null ? priorRank - currentRank : null)

    return {
      ...row,
      ticker: row?.ticker ?? (ticker || undefined),
      symbol: row?.symbol ?? (ticker || undefined),
      currentRank,
      priorRank,
      rankChange: computedDelta,
      rank: currentRank,
      movement: row?.movement ?? direction
    }
  }

  const normalizedRisers = risers.map((row) => toRow(row, 'riser'))
  const normalizedFallers = fallers.map((row) => toRow(row, 'faller'))
  return [...normalizedRisers, ...normalizedFallers]
}

async function getCachedQuote(symbol) {
  const key = String(symbol).toUpperCase()
  const cached = quoteCache.get(key)
  if (cached) return cached

  const quote = await engineClient.getQuote(key)
  quoteCache.set(key, quote)
  return quote
}

async function getCachedHistory(symbol) {
  const key = String(symbol).toUpperCase()
  const cached = historyCache.get(key)
  if (cached) return cached

  const history = await engineClient.getHistory(key, '1Y', '1D')
  historyCache.set(key, history)
  return history
}

function computeDailyChangePctFromHistory(history) {
  const points = Array.isArray(history?.points) ? history.points : []
  if (points.length < 2) return null
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  const lastClose = coerceNumber(last?.c ?? last?.close)
  const prevClose = coerceNumber(prev?.c ?? prev?.close)
  if (lastClose === null || prevClose === null || prevClose === 0) return null
  return ((lastClose - prevClose) / prevClose) * 100
}

function derivePeerCount(data, rows) {
  const rowCount = Array.isArray(rows) ? rows.length : 0
  const pipelineExpected = coerceNumber(data?.pipelineSignals?.universeExpected ?? data?.pipelineSignals?.predictionsTotal)
  const declared = coerceNumber(data?.peerCount ?? data?.peer_count)

  if (pipelineExpected !== null && pipelineExpected > rowCount) return pipelineExpected
  if (declared !== null && declared >= rowCount) return declared
  return declared ?? pipelineExpected ?? null
}

function rewriteInvalidators(row, peerCount) {
  const rankContext = row?.rankContext && typeof row.rankContext === 'object' ? row.rankContext : null
  const invalidators = Array.isArray(rankContext?.invalidators) ? rankContext.invalidators : null
  if (!invalidators || invalidators.length === 0) return row

  const cutoff = coerceNumber(rankContext?.scope?.cutoff) ?? coerceNumber(peerCount ?? row?.peerCount) ?? null
  const rank = coerceNumber(row?.rank ?? row?.currentRank ?? row?.current_rank)
  if (cutoff === null || rank === null) return row

  const next = invalidators.map((inv, idx) => {
    if (idx !== 0) return inv
    const txt = String(inv ?? '').trim()
    if (!txt) return inv
    if (/^rank\s+falls\s+below\b/i.test(txt) || /^rank\s+slips\b/i.test(txt) || /^rank\s+drops\b/i.test(txt)) {
      return `Current #${rank} rank falls below top ${cutoff}`
    }
    return inv
  })

  return {
    ...row,
    rankContext: {
      ...rankContext,
      invalidators: next
    }
  }
}

async function enrichRankingsPayload(data, { limitConcurrency = 6 } = {}) {
  if (!data || typeof data !== 'object') return data
  const rows = normalizeRankingsRows(data)
  if (rows.length === 0) return data

  const uniqueTickers = Array.from(new Set(rows.map(getRowTicker).filter(Boolean)))
  const quoteByTicker = new Map()
  const historyByTicker = new Map()

  let cursor = 0
  const workers = Array.from({ length: Math.min(limitConcurrency, uniqueTickers.length) }, async () => {
    while (cursor < uniqueTickers.length) {
      const i = cursor++
      const tkr = uniqueTickers[i]
      try {
        const quote = await getCachedQuote(tkr)
        quoteByTicker.set(tkr, quote)
      } catch (error) {
        quoteByTicker.set(tkr, null)
      }
    }
  })

  await Promise.all(workers)

  // Best-effort momentum enrichment: only when the surface is small (avoid large fan-out).
  const wantsHistory = rows.length <= 15
  if (wantsHistory) {
    let historyCursor = 0
    const historyWorkers = Array.from({ length: Math.min(4, uniqueTickers.length) }, async () => {
      while (historyCursor < uniqueTickers.length) {
        const i = historyCursor++
        const tkr = uniqueTickers[i]
        try {
          const history = await getCachedHistory(tkr)
          historyByTicker.set(tkr, history)
        } catch {
          historyByTicker.set(tkr, null)
        }
      }
    })
    await Promise.all(historyWorkers)
  }

  const enrichedRows = rows.map((row) => {
    const tkr = getRowTicker(row)
    const quote = tkr ? quoteByTicker.get(tkr) : null
    const history = tkr ? historyByTicker.get(tkr) : null

    const price = row?.price ?? quote?.price ?? quote?.last ?? quote?.close
    const dailyChangePct = row?.dailyChangePct ?? quote?.dailyChangePct ?? quote?.changePct ?? quote?.change
    const fallbackDailyChangePct = dailyChangePct == null ? computeDailyChangePctFromHistory(history) : null

    return {
      ...row,
      ticker: row?.ticker ?? (tkr || undefined),
      predictionId: row?.predictionId ?? row?.prediction_id ?? null,
      price: coerceNumber(price),
      dailyChangePct: coerceNumber(dailyChangePct ?? fallbackDailyChangePct)
    }
  })

  const peerCount = derivePeerCount(data, enrichedRows)
  const withPeer = peerCount === null
    ? enrichedRows
    : enrichedRows.map((row) => ({
        ...row,
        peerCount: coerceNumber(row?.peerCount ?? row?.peer_count) ?? peerCount
      }))

  const withInvalidators = withPeer.map((row) => rewriteInvalidators(row, peerCount))

  return {
    ...data,
    peerCount: peerCount ?? data?.peerCount ?? data?.peer_count ?? null,
    rankings: withInvalidators,
    _enrichedAt: new Date().toISOString()
  }
}

export const rankingEnrichmentService = {
  enrich: enrichRankingsPayload,
  getCachedQuote,
  getCacheSize: () => quoteCache.size()
}
