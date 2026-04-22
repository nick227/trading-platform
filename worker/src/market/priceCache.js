// In-memory price cache. Populated by the Alpaca WebSocket stream.
// All reads go through isStale() before being trusted by rule evaluators.

const cache = new Map() // ticker → { bid, ask, last, updatedAt }

const STALE_AFTER_MS = 5_000 // 5 seconds

export const priceCache = {
  set(ticker, quote) {
    cache.set(ticker, {
      bid:       quote.bid  ?? quote.bp ?? null,
      ask:       quote.ask  ?? quote.ap ?? null,
      last:      quote.last ?? quote.ap ?? null, // use ask as proxy when no last
      updatedAt: Date.now()
    })
  },

  get(ticker) {
    return cache.get(ticker) ?? null
  },

  isStale(ticker, maxAgeMs = STALE_AFTER_MS) {
    const entry = cache.get(ticker)
    if (!entry) return true
    return Date.now() - entry.updatedAt > maxAgeMs
  },

  // Returns the cached quote if fresh, null if stale or missing.
  // Avoids the double Map.get() of calling isStale() then get() separately.
  getIfFresh(ticker, maxAgeMs = STALE_AFTER_MS) {
    const entry = cache.get(ticker)
    if (!entry || Date.now() - entry.updatedAt > maxAgeMs) return null
    return entry
  },

  // Mutate last price in-place (used by bar handler — avoids spread allocation)
  updateLast(ticker, last) {
    const entry = cache.get(ticker)
    if (!entry) return
    entry.last = last
    entry.updatedAt = Date.now()
  },

  // All currently cached tickers — used to validate subscriptions
  tickers() {
    return [...cache.keys()]
  }
}
