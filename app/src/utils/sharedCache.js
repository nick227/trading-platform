// Shared Cache Façade - single import point for all cache functionality

import { globalCache } from './cacheCore.js'
import { metrics, getCacheMetrics, resetMetrics } from './cacheMetrics.js'
import {
  invalidateNamespace,
  invalidateByPattern,
  invalidationRules,
  scheduleRefresh,
  enforceEphemeralLimits
} from './cacheInvalidation.js'
import { setCacheItem, getCacheItem, deleteCacheItem, cachedFetch } from './cacheFetch.js'

// Named re-exports so callers can import from this single module
export {
  globalCache,
  metrics, getCacheMetrics, resetMetrics,
  invalidateNamespace, invalidateByPattern, invalidationRules, scheduleRefresh, enforceEphemeralLimits,
  setCacheItem, getCacheItem, deleteCacheItem, cachedFetch
}

// Cache namespaces for precise invalidation
export const CACHE_NAMESPACES = {
  MARKET: 'market',
  PORTFOLIO: 'portfolio',
  ORDERS: 'orders',
  ENGINE: 'engine',
  UI: 'ui'
}

// Truth-override protection - broker/server confirmed state wins
export const TRUTH_NAMESPACES = {
  [CACHE_NAMESPACES.PORTFOLIO]: true,
  [CACHE_NAMESPACES.ORDERS]: true
}

// Cache configuration
export const CACHE_CONFIG = {
  MAX_KEYS: 500,
  DEFAULT_TTL: 5 * 60_000,
  TTL_BY_TYPE: {
    QUOTE: 30_000,
    BOOTSTRAP: 30_000,
    STATS: 5 * 60_000,
    HISTORY: 5 * 60_000,
    COMPANY: 60 * 60_000,
    HOLDINGS: 60_000,
    POSITIONS: 60_000,
    BALANCE: 30_000,
    ORDERS: 30_000,
    EXECUTIONS: 15_000,
    RECOMMENDATION: 60 * 60_000,
    RANKING: 5 * 60_000,
    ALPHA: 60 * 60_000,
    UI_STATE: 10 * 60_000
  }
}

export function getCacheKey(namespace, type, ...args) {
  return `${namespace}:${type}:${args.join(':')}`
}

export const cacheKeys = {
  market: {
    quote: (symbol) => getCacheKey(CACHE_NAMESPACES.MARKET, 'QUOTE', symbol),
    bootstrap: (symbol, range = '1Y', interval = '1D') =>
      getCacheKey(CACHE_NAMESPACES.MARKET, 'BOOTSTRAP', symbol, range, interval),
    stats: (symbol) => getCacheKey(CACHE_NAMESPACES.MARKET, 'STATS', symbol),
    company: (symbol) => getCacheKey(CACHE_NAMESPACES.MARKET, 'COMPANY', symbol)
  },
  portfolio: {
    holdings: () => getCacheKey(CACHE_NAMESPACES.PORTFOLIO, 'HOLDINGS', 'current'),
    positions: () => getCacheKey(CACHE_NAMESPACES.PORTFOLIO, 'POSITIONS', 'current'),
    balance: () => getCacheKey(CACHE_NAMESPACES.PORTFOLIO, 'BALANCE', 'current'),
    pendingOrders: () => getCacheKey(CACHE_NAMESPACES.PORTFOLIO, 'PENDING_ORDERS', 'current')
  },
  orders: {
    order: (id) => getCacheKey(CACHE_NAMESPACES.ORDERS, 'ORDER', id),
    executions: () => getCacheKey(CACHE_NAMESPACES.ORDERS, 'EXECUTIONS', 'current'),
    userOrders: () => getCacheKey(CACHE_NAMESPACES.ORDERS, 'USER_ORDERS', 'current')
  },
  engine: {
    recommendation: (symbol) => getCacheKey(CACHE_NAMESPACES.ENGINE, 'RECOMMENDATION', symbol),
    ranking: (type, limit) => getCacheKey(CACHE_NAMESPACES.ENGINE, 'RANKING', type, limit),
    alpha: (symbol) => getCacheKey(CACHE_NAMESPACES.ENGINE, 'ALPHA', symbol)
  }
}

export default {
  getCacheKey,
  cacheKeys,
  CACHE_CONFIG,
  CACHE_NAMESPACES,
  TRUTH_NAMESPACES
}
