// Cache Invalidation - Namespace and pattern-based invalidation
// Separated for better modularity and testing

import { globalCache } from './cacheCore.js'
import { recordInvalidation } from './cacheMetrics.js'

// Define locally to avoid circular dependency
const CACHE_NAMESPACES = {
  MARKET: 'market',
  PORTFOLIO: 'portfolio', 
  ORDERS: 'orders',
  ENGINE: 'engine',
  UI: 'ui'
}

// Thundering herd protection
const refreshQueue = new Map()
const REFRESH_DELAY = 100 // 100ms between batches

export function scheduleRefresh(keys, priority = 'normal') {
  const queueKey = `${priority}_refresh`
  
  if (!refreshQueue.has(queueKey)) {
    refreshQueue.set(queueKey, new Set())
  }
  
  const queue = refreshQueue.get(queueKey)
  keys.forEach(key => queue.add(key))
  
  // Process queue with delay to prevent thundering herd
  setTimeout(() => processRefreshQueue(queueKey), REFRESH_DELAY)
}

function processRefreshQueue(queueKey) {
  const queue = refreshQueue.get(queueKey)
  if (!queue || queue.size === 0) return
  
  const keysToRefresh = Array.from(queue)
  refreshQueue.delete(queueKey)
  
  console.debug(`Processing batch refresh for ${keysToRefresh.length} keys`)
  
  // Process in smaller batches to prevent overwhelming the system
  const batchSize = 3
  for (let i = 0; i < keysToRefresh.length; i += batchSize) {
    const batch = keysToRefresh.slice(i, i + batchSize)
    setTimeout(() => {
      batch.forEach(key => {
        globalCache.delete(key) // Force fresh fetch on next request
      })
    }, i * 50) // 50ms between batches
  }
}

// Namespace-based invalidation for mutations
export function invalidateNamespace(namespace) {
  const keys = globalCache.keys()
  const pattern = `^${namespace}:`
  const regex = new RegExp(pattern)
  let invalidated = 0
  
  keys.forEach(key => {
    if (regex.test(key)) {
      globalCache.delete(key)
      invalidated++
      recordInvalidation()
    }
  })
  
  console.debug(`Invalidated ${invalidated} cache entries in namespace: ${namespace}`)
  return invalidated
}

// Pattern-based invalidation (legacy support)
export function invalidateByPattern(pattern) {
  const keys = globalCache.keys()
  const regex = new RegExp(pattern)
  let invalidated = 0
  
  keys.forEach(key => {
    if (regex.test(key)) {
      globalCache.delete(key)
      invalidated++
      recordInvalidation()
    }
  })
  
  console.debug(`Invalidated ${invalidated} cache entries matching pattern: ${pattern}`)
  return invalidated
}

// Mutation-driven invalidation helpers with namespaces
export const invalidationRules = {
  // After trade execution - disciplined approach
  afterTrade: (symbol, side) => {
    // Invalidate market data for the symbol
    invalidateByPattern(`^${CACHE_NAMESPACES.MARKET}:.*:${symbol}:.*`)
    
    // Invalidate portfolio data (but keep optimistic pending state)
    invalidateNamespace(CACHE_NAMESPACES.PORTFOLIO)
    
    // Invalidate orders
    invalidateNamespace(CACHE_NAMESPACES.ORDERS)
    
    // Schedule staged refresh to prevent thundering herd
    const keysToRefresh = [
      `${CACHE_NAMESPACES.PORTFOLIO}:HOLDINGS:current`,
      `${CACHE_NAMESPACES.PORTFOLIO}:BALANCE:current`,
      `${CACHE_NAMESPACES.MARKET}:BOOTSTRAP:${symbol}:1Y:1D`,
      `${CACHE_NAMESPACES.ORDERS}:EXECUTIONS:current`
    ]
    
    scheduleRefresh(keysToRefresh, 'high')
  },

  // After order cancellation
  afterOrderCancel: (orderId) => {
    invalidateNamespace(CACHE_NAMESPACES.ORDERS)
    invalidateNamespace(CACHE_NAMESPACES.PORTFOLIO)
    
    scheduleRefresh([
      `${CACHE_NAMESPACES.PORTFOLIO}:HOLDINGS:current`,
      `${CACHE_NAMESPACES.PORTFOLIO}:BALANCE:current`,
      `${CACHE_NAMESPACES.ORDERS}:USER_ORDERS:current`
    ], 'high')
  },

  // After portfolio rebalance
  afterRebalance: () => {
    invalidateNamespace(CACHE_NAMESPACES.PORTFOLIO)
    
    scheduleRefresh([
      `${CACHE_NAMESPACES.PORTFOLIO}:HOLDINGS:current`,
      `${CACHE_NAMESPACES.PORTFOLIO}:POSITIONS:current`,
      `${CACHE_NAMESPACES.PORTFOLIO}:BALANCE:current`
    ], 'normal')
  },

  // After market data update (from worker)
  afterMarketDataUpdate: (symbol) => {
    // Only invalidate market data, not portfolio
    invalidateByPattern(`^${CACHE_NAMESPACES.MARKET}:.*:${symbol}:.*`)
  }
}

// Ephemeral cache enforcement
export function enforceEphemeralLimits(maxKeys = 500) {
  if (globalCache.size() > maxKeys * 0.9) {
    console.warn('Cache approaching limit, forcing cleanup')
    
    // Prioritize keeping market data, evict UI state first
    const keysByNamespace = {}
    globalCache.keys().forEach(key => {
      const namespace = key.split(':')[0]
      keysByNamespace[namespace] = keysByNamespace[namespace] || []
      keysByNamespace[namespace].push(key)
    })
    
    // Evict UI state first, then portfolio, then engine
    const evictionOrder = [CACHE_NAMESPACES.UI, CACHE_NAMESPACES.PORTFOLIO, CACHE_NAMESPACES.ENGINE]
    
    evictionOrder.forEach(namespace => {
      if (keysByNamespace[namespace]) {
        keysByNamespace[namespace].slice(0, 10).forEach(key => {
          globalCache.delete(key)
          recordInvalidation()
        })
      }
    })
  }
}
