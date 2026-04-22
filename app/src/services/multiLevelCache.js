import { useState, useEffect, useRef, useCallback } from 'react'

// Multi-Level Caching System
// L1: In-Memory (Application)
// L2: IndexedDB (Browser Persistence)  
// L3: Server Cache (API)

class MultiLevelCache {
  constructor(options = {}) {
    this.l1Cache = new Map() // In-memory cache
    this.l2CacheName = options.l2CacheName || 'trading-platform-cache'
    this.maxL1Size = options.maxL1Size || 1000
    this.defaultTTL = options.defaultTTL || 300000 // 5 minutes
    
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      serverHits: 0,
      serverMisses: 0,
      totalRequests: 0
    }
  }

  // Initialize L2 cache (IndexedDB)
  async initL2Cache() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.l2CacheName, 1)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result
        if (!db.objectStoreNames.contains('cache')) {
          const store = db.createObjectStore('cache', { keyPath: 'key' })
          store.createIndex('expires', 'expires')
          store.createIndex('category', 'category')
        }
      }
    })
  }

  // Generate cache key
  generateKey(category, identifier, params = {}) {
    const keyData = {
      category,
      identifier,
      params: Object.keys(params).sort().reduce((sorted, key) => {
        sorted[key] = params[key]
        return sorted
      }, {})
    }
    
    return btoa(JSON.stringify(keyData))
  }

  // Get data from cache hierarchy
  async get(category, identifier, params = {}) {
    this.stats.totalRequests++
    const key = this.generateKey(category, identifier, params)
    
    // L1 Cache (Memory)
    const l1Item = this.l1Cache.get(key)
    if (l1Item && Date.now() < l1Item.expires) {
      this.stats.l1Hits++
      return l1Item.data
    }
    this.stats.l1Misses++
    
    // L2 Cache (IndexedDB)
    try {
      const db = await this.initL2Cache()
      const tx = db.transaction(['cache'], 'readonly')
      const store = tx.objectStore('cache')
      
      const request = store.get(key)
      const l2Item = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      
      if (l2Item && l2Item.expires > Date.now()) {
        this.stats.l2Hits++
        // Promote to L1
        this.setL1(key, l2Item.data, l2Item.expires)
        return l2Item.data
      }
      this.stats.l2Misses++
      
      // Remove expired L2 item
      if (l2Item) {
        const deleteTx = db.transaction(['cache'], 'readwrite')
        deleteTx.objectStore('cache').delete(key)
      }
      
    } catch (error) {
      console.warn('L2 cache read failed:', error)
    }
    
    return null
  }

  // Set data in cache hierarchy
  async set(category, identifier, data, ttl = this.defaultTTL) {
    const key = this.generateKey(category, identifier, params)
    const expires = Date.now() + ttl
    
    // Set in L1
    this.setL1(key, data, expires)
    
    // Set in L2
    try {
      const db = await this.initL2Cache()
      const tx = db.transaction(['cache'], 'readwrite')
      const store = tx.objectStore('cache')
      
      const item = {
        key,
        category,
        data,
        expires,
        createdAt: Date.now()
      }
      
      await new Promise((resolve, reject) => {
        const request = store.put(item)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      
      // Clean up expired items
      this.cleanupL2(db)
      
    } catch (error) {
      console.warn('L2 cache write failed:', error)
    }
  }

  // Set in L1 cache with size management
  setL1(key, data, expires) {
    // Remove oldest items if cache is full
    if (this.l1Cache.size >= this.maxL1Size) {
      const firstKey = this.l1Cache.keys().next().value
      this.l1Cache.delete(firstKey)
    }
    
    this.l1Cache.set(key, { data, expires })
  }

  // Clean up expired L2 items
  async cleanupL2(db) {
    try {
      const tx = db.transaction(['cache'], 'readwrite')
      const store = tx.objectStore('cache')
      const index = store.index('expires')
      
      const request = index.openCursor(IDBKeyRange.upperBound(Date.now()))
      const cursor = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      
      const deletePromises = []
      while (cursor) {
        deletePromises.push(cursor.delete())
        await cursor.continue()
      }
      
      await Promise.all(deletePromises)
      
    } catch (error) {
      console.warn('L2 cache cleanup failed:', error)
    }
  }

  // Invalidate cache entries
  async invalidate(category, identifier = null) {
    if (identifier) {
      // Invalidate specific entry
      const key = this.generateKey(category, identifier)
      this.l1Cache.delete(key)
      
      try {
        const db = await this.initL2Cache()
        const tx = db.transaction(['cache'], 'readwrite')
        tx.objectStore('cache').delete(key)
      } catch (error) {
        console.warn('L2 cache invalidation failed:', error)
      }
    } else {
      // Invalidate entire category
      // Remove from L1
      for (const [key, item] of this.l1Cache.entries()) {
        if (item.category === category) {
          this.l1Cache.delete(key)
        }
      }
      
      // Remove from L2
      try {
        const db = await this.initL2Cache()
        const tx = db.transaction(['cache'], 'readwrite')
        const store = tx.objectStore('cache')
        const index = store.index('category')
        
        const request = index.openCursor(category)
        const cursor = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        
        while (cursor) {
          cursor.delete()
          await cursor.continue()
        }
        
      } catch (error) {
        console.warn('L2 cache category invalidation failed:', error)
      }
    }
  }

  // Get cache statistics
  getStats() {
    const total = this.stats.l1Hits + this.stats.l1Misses + this.stats.l2Hits + this.stats.l2Misses
    return {
      ...this.stats,
      l1HitRate: this.stats.l1Hits / (this.stats.l1Hits + this.stats.l1Misses) * 100,
      l2HitRate: this.stats.l2Hits / (this.stats.l2Hits + this.stats.l2Misses) * 100,
      overallHitRate: (this.stats.l1Hits + this.stats.l2Hits) / total * 100,
      l1Size: this.l1Cache.size
    }
  }

  // Clear all caches
  async clear() {
    this.l1Cache.clear()
    
    try {
      const db = await this.initL2Cache()
      const tx = db.transaction(['cache'], 'readwrite')
      await tx.objectStore('cache').clear()
    } catch (error) {
      console.warn('L2 cache clear failed:', error)
    }
    
    // Reset stats
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      serverHits: 0,
      serverMisses: 0,
      totalRequests: 0
    }
  }
}

// Cache categories for different data types
export const CacheCategories = {
  MARKET_DATA: 'market-data',
  BOT_CONFIG: 'bot-config',
  USER_DATA: 'user-data',
  PORTFOLIO: 'portfolio',
  STRATEGIES: 'strategies',
  EXECUTIONS: 'executions',
  PERFORMANCE: 'performance'
}

// TTL configurations for different categories
export const CacheTTL = {
  [CacheCategories.MARKET_DATA]: 5000,      // 5 seconds
  [CacheCategories.BOT_CONFIG]: 300000,    // 5 minutes
  [CacheCategories.USER_DATA]: 600000,      // 10 minutes
  [CacheCategories.PORTFOLIO]: 30000,     // 30 seconds
  [CacheCategories.STRATEGIES]: 3600000,   // 1 hour
  [CacheCategories.EXECUTIONS]: 15000,    // 15 seconds
  [CacheCategories.PERFORMANCE]: 60000     // 1 minute
}

// React hook for multi-level cache
export function useMultiLevelCache(options = {}) {
  const cache = useRef(new MultiLevelCache(options)).current
  
  useEffect(() => {
    return () => {
      cache.clear()
    }
  }, [cache])
  
  return cache
}

// Data fetching with caching
export function useCachedFetch() {
  const cache = useMultiLevelCache()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  const fetchWithCache = useCallback(async (category, identifier, fetcher, params = {}, ttl) => {
    setLoading(true)
    setError(null)
    
    try {
      // Try cache first
      let data = await cache.get(category, identifier, params)
      
      if (!data) {
        // Cache miss - fetch from server
        data = await fetcher(params)
        
        // Store in cache
        await cache.set(category, identifier, data, ttl || CacheTTL[category])
      }
      
      return data
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [cache])
  
  const invalidate = useCallback(async (category, identifier) => {
    await cache.invalidate(category, identifier)
  }, [cache])
  
  return {
    fetchWithCache,
    invalidate,
    loading,
    error,
    stats: cache.getStats()
  }
}

// Market data caching service
export function useMarketDataCache() {
  const { fetchWithCache, invalidate } = useCachedFetch()
  
  const getMarketData = useCallback(async (ticker, fetcher) => {
    return fetchWithCache(
      CacheCategories.MARKET_DATA,
      ticker,
      fetcher,
      {},
      CacheTTL.MARKET_DATA
    )
  }, [fetchWithCache])
  
  const getBatchMarketData = useCallback(async (tickers, fetcher) => {
    const identifier = tickers.sort().join(',')
    return fetchWithCache(
      CacheCategories.MARKET_DATA,
      identifier,
      fetcher,
      { tickers },
      CacheTTL.MARKET_DATA
    )
  }, [fetchWithCache])
  
  const invalidateMarketData = useCallback(async (ticker) => {
    await invalidate(CacheCategories.MARKET_DATA, ticker)
  }, [invalidate])
  
  return { getMarketData, getBatchMarketData, invalidateMarketData }
}

// Bot configuration caching service
export function useBotConfigCache() {
  const { fetchWithCache, invalidate } = useCachedFetch()
  
  const getBotConfig = useCallback(async (botId, fetcher) => {
    return fetchWithCache(
      CacheCategories.BOT_CONFIG,
      botId,
      fetcher,
      {},
      CacheTTL.BOT_CONFIG
    )
  }, [fetchWithCache])
  
  const invalidateBotConfig = useCallback(async (botId) => {
    await invalidate(CacheCategories.BOT_CONFIG, botId)
  }, [invalidate])
  
  return { getBotConfig, invalidateBotConfig }
}

export default MultiLevelCache
