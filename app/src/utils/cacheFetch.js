// Cache Fetch - Request deduplication and cachedFetch implementation
// Separated for better modularity and testing

import { globalCache } from './cacheCore.js'
import { recordHit, recordMiss, recordRequest } from './cacheMetrics.js'

// Performance timing with fallback for server-side/SSR
const getPerformanceNow = () => {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now()
  } else if (typeof Date !== 'undefined' && Date.now) {
    // Fallback for server-side environments
    return Date.now()
  } else {
    // Ultimate fallback
    return 0
  }
}

// Define locally to avoid circular dependency
const TRUTH_NAMESPACES = {
  portfolio: true, // Holdings, balances, positions
  orders: true     // Order status, executions
}

// In-flight request deduplication
const pendingRequests = new Map()

// Truth-override protection - broker/server confirmed state wins
function shouldBypassCache(cacheKey, isTruthSource = false) {
  if (!isTruthSource) return false
  
  // Check if this key belongs to a truth namespace
  const namespace = cacheKey.split(':')[0]
  return TRUTH_NAMESPACES[namespace] === true
}

// Cache utilities
export function setCacheItem(key, data, ttl = 5 * 60_000) {
  const startTime = getPerformanceNow()
  globalCache.set(key, data, ttl)
  const latency = getPerformanceNow() - startTime
  recordRequest(latency)
}

export function getCacheItem(key, allowStale = false) {
  const startTime = getPerformanceNow()
  
  if (allowStale) {
    const result = globalCache.getStale(key)
    if (result) {
      recordHit()
      recordRequest(getPerformanceNow() - startTime)
      return result
    }
  }
  
  const result = globalCache.get(key)
  const latency = getPerformanceNow() - startTime
  
  if (result) {
    recordHit()
  } else {
    recordMiss()
  }
  
  recordRequest(latency)
  
  return result
}

export function deleteCacheItem(key) {
  return globalCache.delete(key)
}

// Request deduplication with cache integration and truth protection
export async function cachedFetch(type, keyFactory, fetchFn, ttl, options = {}) {
  const cacheKey = typeof keyFactory === 'string' ? keyFactory : keyFactory()
  const { allowStale = false, isTruthSource = false } = options
  
  // Bypass cache for truth sources (broker/server confirmed data)
  if (shouldBypassCache(cacheKey, isTruthSource)) {
    console.debug(`Bypassing cache for truth source: ${cacheKey}`)
    const data = await fetchFn()
    // Still cache truth data for performance, but always fetch fresh
    setCacheItem(cacheKey, { ...data, _isTruth: true }, ttl)
    return { ...data, _cached: false, _source: 'truth', _bypassedCache: true }
  }
  
  // Check cache first (or stale cache if allowed)
  const cached = getCacheItem(cacheKey, allowStale)
  if (cached) {
    if (cached.isStale && allowStale) {
      console.debug(`Stale cache hit for ${cacheKey}, revalidating in background`)
      // Trigger background refresh
      fetchFn().then(data => {
        setCacheItem(cacheKey, data, ttl)
      }).catch(() => {
        // Silent fail for background refresh
      })
      return cached.data
    } else {
      console.debug(`Cache hit for ${cacheKey}`)
      return { ...cached, _cached: true, _source: 'cache' }
    }
  }
  
  // Check if request is already in flight
  if (pendingRequests.has(cacheKey)) {
    console.debug(`Request deduplication for ${cacheKey}`)
    return pendingRequests.get(cacheKey)
  }
  
  // Make new request
  const requestPromise = fetchFn().then(data => {
    setCacheItem(cacheKey, data, ttl)
    pendingRequests.delete(cacheKey)
    return { ...data, _cached: false, _source: 'api' }
  }).catch(error => {
    pendingRequests.delete(cacheKey)
    throw error
  })
  
  pendingRequests.set(cacheKey, requestPromise)
  return requestPromise
}
