import { engineClient } from '../clients/engine.js'

const QUOTE_ENRICH_TTL_MS = 30_000
const CACHE_MAX_SIZE = 1000
const PRUNE_INTERVAL_MS = 60_000

class QuoteCache {
  constructor(maxSize = CACHE_MAX_SIZE) {
    this.cache = new Map()
    this.maxSize = maxSize
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
    this.cache.set(key, { quote, expiresAt: now + QUOTE_ENRICH_TTL_MS })

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

const quoteCache = new QuoteCache()

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

async function enrichRankingsPayload(data, { limitConcurrency = 6 } = {}) {
  if (!data || typeof data !== 'object') return data
  const rows = normalizeRankingsRows(data)
  if (rows.length === 0) return data

  const uniqueTickers = Array.from(new Set(rows.map(getRowTicker).filter(Boolean)))
  const quoteByTicker = new Map()

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

  const enrichedRows = rows.map((row) => {
    const tkr = getRowTicker(row)
    const quote = tkr ? quoteByTicker.get(tkr) : null

    const price = row?.price ?? quote?.price ?? quote?.last ?? quote?.close
    const dailyChangePct = row?.dailyChangePct ?? quote?.dailyChangePct ?? quote?.changePct ?? quote?.change

    return {
      ...row,
      ticker: row?.ticker ?? (tkr || undefined),
      price: coerceNumber(price),
      dailyChangePct: coerceNumber(dailyChangePct)
    }
  })

  return { ...data, rankings: enrichedRows, _enrichedAt: new Date().toISOString() }
}

export const rankingEnrichmentService = {
  enrich: enrichRankingsPayload,
  getCachedQuote,
  getCacheSize: () => quoteCache.size()
}
