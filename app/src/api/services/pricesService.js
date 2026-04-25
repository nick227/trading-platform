import { get } from '../client.js'
import { FALLBACK_STOCKS } from '../../services/marketData.js'

// Single source of truth for current prices.
// Tries the engine API first; falls back to marketData stubs.

let stubMap = null
function getStubMap() {
  if (!stubMap) {
    stubMap = {}
    // Use the synchronous FALLBACK_STOCKS constant — getAvailableStocks() is async
    for (const stock of FALLBACK_STOCKS) {
      stubMap[stock.symbol] = { price: stock.price, change: stock.change }
    }
  }
  return stubMap
}

// In-memory cache to prevent duplicate requests
let cachedPriceMap = null
let cacheExpiry = 0
const CACHE_TTL_MS = 30_000

function normalizeEngineResponse(data) {
  if (!data || typeof data !== 'object') return null

  // Shape: { [ticker]: price }  (number values)
  if (!Array.isArray(data) && Object.values(data).every(v => typeof v === 'number')) {
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { price: v, change: 0 }]))
  }

  // Shape: { [ticker]: { price, change, ... } }
  if (!Array.isArray(data)) return data

  // Shape: [{ symbol, price, change }, ...]
  return Object.fromEntries(data.map(p => [p.symbol ?? p.ticker, { price: p.price, change: p.change ?? 0 }]))
}

export default {
  async getPriceMap() {
    const now = Date.now()
    if (cachedPriceMap && now < cacheExpiry) {
      return cachedPriceMap
    }

    try {
      const raw = await get('/engine/prices/current')
      const normalized = normalizeEngineResponse(raw)
      if (normalized && Object.keys(normalized).length > 0) {
        cachedPriceMap = normalized
        cacheExpiry = now + CACHE_TTL_MS
        return normalized
      }
    } catch {
      // engine unavailable — use stubs
    }
    return getStubMap()
  },

  getPrice(priceMap, ticker) {
    return priceMap?.[ticker]?.price ?? null
  },

  getChange(priceMap, ticker) {
    return priceMap?.[ticker]?.change ?? null
  }
}
