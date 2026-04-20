// Market Data Service - Domain-specific service for quotes, tickers, and historical data
// Extracted from alphaEngineService.js for better separation of concerns

import { alphaFetch, cachedFetch, getCacheKey, transformTickers, transformQuote, transformHistory, transformStats, transformCompany } from './alphaEngineService.js'
import { getCacheItem, setCacheItem } from '../../utils/sharedCache.js'

const MARKET_CACHE_TTL = {
  QUOTE: 30_000,      // 30 seconds
  TICKERS: 60_000,   // 1 minute
  HISTORY: 5 * 60_000, // 5 minutes
  STATS: 5 * 60_000,   // 5 minutes
  COMPANY: 60 * 60_000 // 1 hour
}

export default {
  // Health check
  async checkHealth() {
    try {
      return await alphaFetch('/health')
    } catch (error) {
      console.warn('Market service health check failed:', error.message)
      return { status: 'unreachable', error: error.message }
    }
  },

  // Ticker search and listing
  async getTickers(search = '') {
    return cachedFetch(
      'TICKERS',
      () => getCacheKey('TICKERS', search || 'all'),
      () => alphaFetch(`/orders/tickers${search ? '?search=' + encodeURIComponent(search) : ''}`).then(transformTickers),
      MARKET_CACHE_TTL.TICKERS
    )
  },

  // Real-time quotes
  async getQuote(symbol) {
    return cachedFetch(
      'QUOTE',
      () => getCacheKey('QUOTE', symbol),
      () => alphaFetch(`/orders/bootstrap?ticker=${encodeURIComponent(symbol)}`).then(data => data?.quote).then(transformQuote),
      MARKET_CACHE_TTL.QUOTE
    )
  },

  // Historical price data
  async getHistory(symbol, range = '1Y', interval = '1D') {
    return cachedFetch(
      'HISTORY',
      () => getCacheKey('HISTORY', `${symbol}:${range}:${interval}`),
      () => alphaFetch(`/orders/bootstrap?ticker=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`).then(data => data?.history || []).then(transformHistory),
      MARKET_CACHE_TTL.HISTORY
    )
  },

  // Company fundamentals
  async getCompany(symbol) {
    return cachedFetch(
      'COMPANY',
      () => getCacheKey('COMPANY', symbol),
      () => alphaFetch(`/api/company/${encodeURIComponent(symbol)}?tenant_id=default`).then(transformCompany),
      MARKET_CACHE_TTL.COMPANY
    )
  },

  // Market statistics
  async getStats(symbol) {
    return cachedFetch(
      'STATS',
      () => getCacheKey('STATS', symbol),
      () => alphaFetch(`/api/stats/${encodeURIComponent(symbol)}?tenant_id=default`).then(transformStats),
      MARKET_CACHE_TTL.STATS
    )
  },

  // Candlestick data
  async getCandles(symbol, range = '1Y', interval = '1D') {
    return cachedFetch(
      'CANDLES',
      () => getCacheKey('CANDLES', `${symbol}:${range}:${interval}`),
      () => alphaFetch(`/api/candles/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&tenant_id=default`),
      MARKET_CACHE_TTL.HISTORY
    )
  },

  // Bootstrap endpoint - single request for all ticker data
  async getBootstrapData(symbol, range = '1Y', interval = '1D') {
    const cacheKey = getCacheKey('BOOTSTRAP', `${symbol}:${range}:${interval}`)
    
    // Check cache first
    const cached = getCacheItem(cacheKey)
    if (cached) {
      console.debug(`Bootstrap cache hit for ${symbol}`)
      return { ...cached, _cached: true, _source: 'cache' }
    }
    
    try {
      // Use new market bootstrap endpoint that blends worker + alpha-engine data
      // Call directly without BASE_URL prefix since it's a different route
      const response = await fetch(`/api/market/bootstrap/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      const data = await response.json()
      
      // Add freshness metadata
      const enhancedData = {
        ...data,
        _source: 'market-bootstrap',
        _cachedAt: Date.now(),
        _freshness: 'live'
      }
      
      // Cache for shorter TTL since this is real-time data
      setCacheItem(cacheKey, enhancedData, MARKET_CACHE_TTL.QUOTE)
      
      return {
        ...enhancedData,
        // history arrives as { points: [{t, c}] } — normalize to [{date, price, volume}]
        history: transformHistory(data.history),
      }
    } catch (error) {
      console.error(`Failed to load bootstrap data for ${symbol}:`, error)
      // Fallback to legacy orders endpoint
      const fallbackData = await alphaFetch(`/orders/bootstrap?ticker=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`)
      if (fallbackData) {
        const enhancedFallback = {
          ...fallbackData,
          _source: 'legacy-bootstrap',
          _cachedAt: Date.now(),
          _freshness: 'degraded'
        }
        setCacheItem(cacheKey, enhancedFallback, MARKET_CACHE_TTL.HISTORY)
        return { ...enhancedFallback, history: transformHistory(fallbackData.history) }
      }
      return null
    }
  },

  // Market subscription for demand-driven warmup
  async subscribeToTickers(tickers) {
    if (!Array.isArray(tickers) || tickers.length === 0) {
      throw new Error('Tickers array required')
    }
    
    try {
      const response = await fetch('/api/market/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers })
      })
      
      if (!response.ok) {
        throw new Error(`Subscription failed: ${response.status}`)
      }
      
      return await response.json()
    } catch (error) {
      console.error('Failed to subscribe to tickers:', error)
      throw error
    }
  }
}
