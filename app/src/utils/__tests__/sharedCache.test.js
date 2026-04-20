// Unit Tests for Shared Cache Platform
// Tests TTL expiry, LRU eviction, namespace invalidation, dedupe, stale-while-revalidate, refresh batching

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { 
  globalCache, 
  getCacheKey, 
  setCacheItem, 
  getCacheItem, 
  deleteCacheItem,
  invalidateNamespace,
  invalidateByPattern,
  cachedFetch,
  getCacheMetrics,
  resetMetrics,
  scheduleRefresh,
  cacheKeys,
  CACHE_NAMESPACES,
  CACHE_CONFIG
} from '../sharedCache.js'

// Fake timers for deterministic testing
let fakeTimers

beforeEach(() => {
  fakeTimers = vi.useFakeTimers()
  resetMetrics()
  globalCache.clear()
})

afterEach(() => {
  fakeTimers.useRealTimers()
})

describe('Cache Core Functionality', () => {
  it('should store and retrieve items', () => {
    const key = cacheKeys.market.quote('AAPL')
    const data = { price: 150, timestamp: Date.now() }
    
    setCacheItem(key, data, 60000)
    const result = getCacheItem(key)
    
    expect(result).toEqual(data)
  })

  it('should respect TTL expiry', () => {
    const key = cacheKeys.market.quote('AAPL')
    const data = { price: 150 }
    
    setCacheItem(key, data, 1000) // 1 second TTL
    
    // Should be available immediately
    expect(getCacheItem(key)).toEqual(data)
    
    // Should expire after TTL
    fakeTimers.advanceTimeByTime(1100)
    expect(getCacheItem(key)).toBeNull()
  })

  it('should implement LRU eviction when max keys reached', () => {
    // Fill cache beyond max size
    for (let i = 0; i < CACHE_CONFIG.MAX_KEYS + 10; i++) {
      const key = getCacheKey(CACHE_NAMESPACES.MARKET, 'TEST', i)
      setCacheItem(key, { value: i }, 60000)
    }
    
    const metrics = getCacheMetrics()
    expect(metrics.cacheSize).toBeLessThanOrEqual(CACHE_CONFIG.MAX_KEYS)
    expect(metrics.evictions).toBeGreaterThan(0)
    
    // Least recently used items should be evicted
    const oldestKey = getCacheKey(CACHE_NAMESPACES.MARKET, 'TEST', 0)
    expect(getCacheItem(oldestKey)).toBeNull()
    
    // Most recent items should still be available
    const newestKey = getCacheKey(CACHE_NAMESPACES.MARKET, 'TEST', CACHE_CONFIG.MAX_KEYS + 9)
    expect(getCacheItem(newestKey)).toEqual({ value: CACHE_CONFIG.MAX_KEYS + 9 })
  })

  it('should update LRU order on access', () => {
    // Fill cache
    for (let i = 0; i < CACHE_CONFIG.MAX_KEYS; i++) {
      const key = getCacheKey(CACHE_NAMESPACES.MARKET, 'LRU', i)
      setCacheItem(key, { value: i }, 60000)
    }
    
    // Access oldest item to make it most recently used
    const oldestKey = getCacheKey(CACHE_NAMESPACES.MARKET, 'LRU', 0)
    getCacheItem(oldestKey)
    
    // Add one more item to trigger eviction
    const extraKey = getCacheKey(CACHE_NAMESPACES.MARKET, 'LRU', 'extra')
    setCacheItem(extraKey, { value: 'extra' }, 60000)
    
    // The accessed item should still be available
    expect(getCacheItem(oldestKey)).toEqual({ value: 0 })
    
    // Some other item should be evicted
    const metrics = getCacheMetrics()
    expect(metrics.cacheSize).toBe(CACHE_CONFIG.MAX_KEYS)
  })
})

describe('Namespace Invalidation', () => {
  beforeEach(() => {
    // Populate cache with items from different namespaces
    setCacheItem(cacheKeys.market.quote('AAPL'), { price: 150 }, 60000)
    setCacheItem(cacheKeys.portfolio.holdings(), { positions: [] }, 60000)
    setCacheItem(cacheKeys.orders.order('123'), { status: 'filled' }, 60000)
    setCacheItem(cacheKeys.engine.recommendation('AAPL'), { action: 'buy' }, 60000)
  })

  it('should invalidate entire namespace', () => {
    const beforeMetrics = getCacheMetrics()
    
    const invalidated = invalidateNamespace(CACHE_NAMESPACES.PORTFOLIO)
    
    expect(invalidated).toBe(1)
    expect(getCacheItem(cacheKeys.portfolio.holdings())).toBeNull()
    expect(getCacheItem(cacheKeys.market.quote('AAPL'))).not.toBeNull()
    expect(getCacheItem(cacheKeys.orders.order('123'))).not.toBeNull()
    
    const afterMetrics = getCacheMetrics()
    expect(afterMetrics.invalidations).toBe(beforeMetrics.invalidations + 1)
  })

  it('should handle pattern-based invalidation', () => {
    // Add more items for pattern testing
    setCacheItem(cacheKeys.market.stats('AAPL'), { pe: 25 }, 60000)
    setCacheItem(cacheKeys.market.company('AAPL'), { name: 'Apple' }, 60000)
    
    const invalidated = invalidateByPattern(`^${CACHE_NAMESPACES.MARKET}:.*:AAPL.*`)
    
    expect(invalidated).toBe(3) // quote, stats, company for AAPL
    expect(getCacheItem(cacheKeys.market.quote('AAPL'))).toBeNull()
    expect(getCacheItem(cacheKeys.market.stats('AAPL'))).toBeNull()
    expect(getCacheItem(cacheKeys.market.company('AAPL'))).toBeNull()
  })
})

describe('Request Deduplication', () => {
  it('should deduplicate identical in-flight requests', async () => {
    let callCount = 0
    const fetchFn = async () => {
      callCount++
      await new Promise(resolve => setTimeout(resolve, 100))
      return { data: 'test', timestamp: Date.now() }
    }
    
    const key = cacheKeys.market.quote('AAPL')
    
    // Start multiple requests simultaneously
    const promises = [
      cachedFetch('TEST', key, fetchFn, 60000),
      cachedFetch('TEST', key, fetchFn, 60000),
      cachedFetch('TEST', key, fetchFn, 60000)
    ]
    
    fakeTimers.advanceTimeByTime(150)
    
    const results = await Promise.all(promises)
    
    // Only one actual fetch should have occurred
    expect(callCount).toBe(1)
    
    // All promises should resolve with the same result
    results.forEach(result => {
      expect(result).toEqual({ data: 'test', timestamp: expect.any(Number), _cached: false, _source: 'api' })
    })
  })

  it('should handle request failures properly', async () => {
    const error = new Error('Network error')
    const fetchFn = async () => {
      throw error
    }
    
    const key = cacheKeys.market.quote('AAPL')
    
    // Multiple requests should all fail with the same error
    const promises = [
      cachedFetch('TEST', key, fetchFn, 60000).catch(e => e),
      cachedFetch('TEST', key, fetchFn, 60000).catch(e => e),
      cachedFetch('TEST', key, fetchFn, 60000).catch(e => e)
    ]
    
    const results = await Promise.all(promises)
    
    // All should fail with the same error
    results.forEach(result => {
      expect(result).toBe(error)
    })
  })
})

describe('Stale-While-Revalidate', () => {
  it('should serve stale data while revalidating', async () => {
    let callCount = 0
    const fetchFn = async () => {
      callCount++
      await new Promise(resolve => setTimeout(resolve, 50))
      return { data: `fresh-${callCount}`, timestamp: Date.now() }
    }
    
    const key = cacheKeys.market.quote('AAPL')
    
    // Initial fetch
    const result1 = await cachedFetch('TEST', key, fetchFn, 1000, { allowStale: true })
    expect(result1.data).toBe('fresh-1')
    
    // Wait for expiry
    fakeTimers.advanceTimeByTime(1100)
    
    // Should serve stale data while revalidating
    const result2 = await cachedFetch('TEST', key, fetchFn, 1000, { allowStale: true })
    expect(result2.data).toBe('fresh-1') // Stale data
    expect(result2._cached).toBe(true)
    expect(result2._source).toBe('cache')
    
    // Wait for background refresh
    fakeTimers.advanceTimeByTime(100)
    
    // Next request should get fresh data
    const result3 = await cachedFetch('TEST', key, fetchFn, 1000, { allowStale: true })
    expect(result3.data).toBe('fresh-2') // Fresh data
    expect(result3._cached).toBe(false)
  })

  it('should not serve stale data when not allowed', async () => {
    const fetchFn = async () => {
      return { data: 'fresh', timestamp: Date.now() }
    }
    
    const key = cacheKeys.market.quote('AAPL')
    
    // Initial fetch
    await cachedFetch('TEST', key, fetchFn, 1000)
    
    // Wait for expiry
    fakeTimers.advanceTimeByTime(1100)
    
    // Should not serve stale data when allowStale is false
    const result = await cachedFetch('TEST', key, fetchFn, 1000, { allowStale: false })
    expect(result.data).toBe('fresh')
    expect(result._cached).toBe(false)
  })
})

describe('Refresh Batching', () => {
  it('should batch refresh requests to prevent thundering herd', async () => {
    const keys = [
      cacheKeys.portfolio.holdings(),
      cacheKeys.portfolio.balance(),
      cacheKeys.market.bootstrap('AAPL'),
      cacheKeys.orders.executions()
    ]
    
    // Schedule refresh for all keys
    keys.forEach(key => scheduleRefresh([key], 'high'))
    
    // Advance time to trigger first batch
    fakeTimers.advanceTimeByTime(150)
    
    // Should have processed first batch of 3 keys
    expect(getCacheItem(keys[0])).toBeNull() // Should be invalidated
    expect(getCacheItem(keys[1])).toBeNull()
    expect(getCacheItem(keys[2])).toBeNull()
    
    // Fourth key should be in next batch
    fakeTimers.advanceTimeByTime(100)
    expect(getCacheItem(keys[3])).toBeNull()
  })

  it('should handle multiple priority queues', async () => {
    const highKeys = [cacheKeys.portfolio.holdings()]
    const normalKeys = [cacheKeys.market.quote('AAPL')]
    
    // Schedule with different priorities
    scheduleRefresh(highKeys, 'high')
    scheduleRefresh(normalKeys, 'normal')
    
    // High priority should process first
    fakeTimers.advanceTimeByTime(150)
    expect(getCacheItem(highKeys[0])).toBeNull()
    expect(getCacheItem(normalKeys[0])).not.toBeNull() // Not yet processed
    
    // Normal priority should process after delay
    fakeTimers.advanceTimeByTime(100)
    expect(getCacheItem(normalKeys[0])).toBeNull()
  })
})

describe('Cache Metrics', () => {
  it('should track hit rate accurately', () => {
    const key = cacheKeys.market.quote('AAPL')
    const data = { price: 150 }
    
    // Miss
    getCacheItem(key)
    let metrics = getCacheMetrics()
    expect(metrics.hits).toBe(0)
    expect(metrics.misses).toBe(1)
    expect(metrics.hitRate).toBe(0)
    
    // Set and hit
    setCacheItem(key, data, 60000)
    getCacheItem(key)
    metrics = getCacheMetrics()
    expect(metrics.hits).toBe(1)
    expect(metrics.misses).toBe(1)
    expect(metrics.hitRate).toBe(50)
    
    // Another hit
    getCacheItem(key)
    metrics = getCacheMetrics()
    expect(metrics.hits).toBe(2)
    expect(metrics.misses).toBe(1)
    expect(metrics.hitRate).toBeCloseTo(66.67, 1)
  })

  it('should track invalidations and evictions', () => {
    // Fill cache to trigger eviction
    for (let i = 0; i < CACHE_CONFIG.MAX_KEYS + 5; i++) {
      const key = getCacheKey(CACHE_NAMESPACES.MARKET, 'EVICT', i)
      setCacheItem(key, { value: i }, 60000)
    }
    
    let metrics = getCacheMetrics()
    expect(metrics.evictions).toBeGreaterThan(0)
    
    // Invalidate namespace
    invalidateNamespace(CACHE_NAMESPACES.MARKET)
    
    metrics = getCacheMetrics()
    expect(metrics.invalidations).toBeGreaterThan(0)
  })

  it('should reset metrics', () => {
    // Generate some activity
    setCacheItem(cacheKeys.market.quote('AAPL'), { price: 150 }, 60000)
    getCacheItem(cacheKeys.market.quote('AAPL'))
    getCacheItem(cacheKeys.market.quote('GOOG')) // Miss
    invalidateNamespace(CACHE_NAMESPACES.MARKET)
    
    let metrics = getCacheMetrics()
    expect(metrics.totalRequests).toBeGreaterThan(0)
    expect(metrics.invalidations).toBeGreaterThan(0)
    
    // Reset and verify
    resetMetrics()
    metrics = getCacheMetrics()
    expect(metrics.hits).toBe(0)
    expect(metrics.misses).toBe(0)
    expect(metrics.invalidations).toBe(0)
    expect(metrics.evictions).toBe(0)
    expect(metrics.totalRequests).toBe(0)
    expect(metrics.avgLatency).toBe(0)
  })
})

describe('Cache Key Generation', () => {
  it('should generate consistent keys for different namespaces', () => {
    const marketKey = cacheKeys.market.quote('AAPL')
    const portfolioKey = cacheKeys.portfolio.holdings()
    const ordersKey = cacheKeys.orders.order('123')
    const engineKey = cacheKeys.engine.recommendation('AAPL')
    
    expect(marketKey).toBe('market:QUOTE:AAPL')
    expect(portfolioKey).toBe('portfolio:HOLDINGS:current')
    expect(ordersKey).toBe('orders:ORDER:123')
    expect(engineKey).toBe('engine:RECOMMENDATION:AAPL')
  })

  it('should handle complex key generation', () => {
    const bootstrapKey = cacheKeys.market.bootstrap('AAPL', '1Y', '1D')
    const rankingKey = cacheKeys.engine.ranking('top', 20)
    
    expect(bootstrapKey).toBe('market:BOOTSTRAP:AAPL:1Y:1D')
    expect(rankingKey).toBe('engine:RANKING:top:20')
  })
})
