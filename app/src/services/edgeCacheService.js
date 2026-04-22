import { useState, useEffect, useRef, useCallback } from 'react'

// Edge Computing and Advanced Caching Strategies
// Implements CDN-level caching, service workers, and edge optimization

class EdgeCacheService {
  constructor(options = {}) {
    this.serviceWorkerRegistration = null
    this.cacheName = options.cacheName || 'trading-platform-edge-v1'
    this.edgeEndpoint = options.edgeEndpoint || 'https://edge.trading-platform.com'
    this.maxCacheAge = options.maxCacheAge || 300000 // 5 minutes
    
    this.stats = {
      edgeHits: 0,
      edgeMisses: 0,
      serviceWorkerHits: 0,
      serviceWorkerMisses: 0,
      cdnHits: 0,
      cdnMisses: 0,
      totalRequests: 0
    }
  }

  // Initialize Service Worker for edge caching
  async initServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        this.serviceWorkerRegistration = await navigator.serviceWorker.register('/sw.js')
        
        // Wait for service worker to be ready
        await navigator.serviceWorker.ready
        
        console.log('Service Worker initialized for edge caching')
        return true
      } catch (error) {
        console.warn('Service Worker initialization failed:', error)
        return false
      }
    }
    return false
  }

  // Check if data is available from edge cache
  async getFromEdgeCache(key, options = {}) {
    this.stats.totalRequests++
    
    try {
      // Try edge CDN first
      const edgeData = await this.queryEdgeCDN(key, options)
      if (edgeData) {
        this.stats.edgeHits++
        return edgeData
      }
      this.stats.edgeMisses++
      
      // Try service worker cache
      const swData = await this.getFromServiceWorkerCache(key)
      if (swData) {
        this.stats.serviceWorkerHits++
        return swData
      }
      this.stats.serviceWorkerMisses++
      
      // Try browser cache
      const browserData = await this.getFromBrowserCache(key)
      if (browserData) {
        this.stats.cdnHits++
        return browserData
      }
      this.stats.cdnMisses++
      
    } catch (error) {
      console.warn('Edge cache query failed:', error)
    }
    
    return null
  }

  // Query edge CDN for cached data
  async queryEdgeCDN(key, options = {}) {
    try {
      const response = await fetch(`${this.edgeEndpoint}/cache/${key}`, {
        method: 'GET',
        headers: {
          'X-Cache-Strategy': options.strategy || 'default',
          'X-Max-Age': options.maxAge?.toString() || this.maxCacheAge.toString()
        }
      })
      
      if (response.ok) {
        const data = await response.json()
        
        // Check cache headers
        const cacheStatus = response.headers.get('X-Cache-Status')
        if (cacheStatus === 'HIT') {
          return {
            data,
            source: 'edge-cdn',
            cachedAt: parseInt(response.headers.get('X-Cached-At') || '0'),
            ttl: parseInt(response.headers.get('X-Cache-TTL') || '0')
          }
        }
      }
    } catch (error) {
      console.warn('Edge CDN query failed:', error)
    }
    
    return null
  }

  // Get data from service worker cache
  async getFromServiceWorkerCache(key) {
    if (!this.serviceWorkerRegistration) {
      await this.initServiceWorker()
    }
    
    try {
      const cache = await caches.open(this.cacheName)
      const response = await cache.match(key)
      
      if (response) {
        const data = await response.json()
        const cachedAt = parseInt(response.headers.get('X-Cached-At') || '0')
        
        // Check if still valid
        if (Date.now() - cachedAt < this.maxCacheAge) {
          return {
            data,
            source: 'service-worker',
            cachedAt,
            ttl: this.maxCacheAge
          }
        } else {
          // Remove expired entry
          await cache.delete(key)
        }
      }
    } catch (error) {
      console.warn('Service Worker cache query failed:', error)
    }
    
    return null
  }

  // Get data from browser cache
  async getFromBrowserCache(key) {
    try {
      const response = await fetch(key, {
        method: 'GET',
        cache: 'force-cache'
      })
      
      if (response.ok) {
        const data = await response.json()
        return {
          data,
          source: 'browser-cache',
          cachedAt: Date.now() - (parseInt(response.headers.get('Age') || '0') * 1000)
        }
      }
    } catch (error) {
      console.warn('Browser cache query failed:', error)
    }
    
    return null
  }

  // Store data in edge cache hierarchy
  async storeInEdgeCache(key, data, options = {}) {
    const ttl = options.ttl || this.maxCacheAge
    const strategy = options.strategy || 'default'
    
    try {
      // Store in service worker cache
      await this.storeInServiceWorkerCache(key, data, ttl)
      
      // Store in edge CDN (if available)
      await this.storeInEdgeCDN(key, data, { ttl, strategy })
      
      return true
    } catch (error) {
      console.warn('Edge cache storage failed:', error)
      return false
    }
  }

  // Store in service worker cache
  async storeInServiceWorkerCache(key, data, ttl) {
    if (!this.serviceWorkerRegistration) {
      await this.initServiceWorker()
    }
    
    try {
      const cache = await caches.open(this.cacheName)
      const response = new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'X-Cached-At': Date.now().toString(),
          'X-Cache-TTL': ttl.toString()
        }
      })
      
      await cache.put(key, response)
    } catch (error) {
      console.warn('Service Worker cache storage failed:', error)
    }
  }

  // Store in edge CDN
  async storeInEdgeCDN(key, data, options = {}) {
    try {
      const response = await fetch(`${this.edgeEndpoint}/cache/${key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Cache-Strategy': options.strategy || 'default',
          'X-Cache-TTL': options.ttl?.toString() || this.maxCacheAge.toString()
        },
        body: JSON.stringify(data)
      })
      
      return response.ok
    } catch (error) {
      console.warn('Edge CDN storage failed:', error)
      return false
    }
  }

  // Preload critical data to edge cache
  async preloadCriticalData(dataList) {
    const preloadPromises = dataList.map(async ({ key, data, options }) => {
      try {
        await this.storeInEdgeCache(key, data, options)
        return { key, success: true }
      } catch (error) {
        console.warn(`Failed to preload ${key}:`, error)
        return { key, success: false, error }
      }
    })
    
    return Promise.all(preloadPromises)
  }

  // Invalidate cache entries
  async invalidateCache(key, options = {}) {
    try {
      // Invalidate service worker cache
      const cache = await caches.open(this.cacheName)
      await cache.delete(key)
      
      // Invalidate edge CDN
      await fetch(`${this.edgeEndpoint}/cache/${key}`, {
        method: 'DELETE',
        headers: {
          'X-Cache-Strategy': options.strategy || 'default'
        }
      })
      
      return true
    } catch (error) {
      console.warn('Cache invalidation failed:', error)
      return false
    }
  }

  // Get cache statistics
  getStats() {
    const total = this.stats.edgeHits + this.stats.edgeMisses + 
                this.stats.serviceWorkerHits + this.stats.serviceWorkerMisses +
                this.stats.cdnHits + this.stats.cdnMisses
    
    return {
      ...this.stats,
      edgeHitRate: this.stats.edgeHits / (this.stats.edgeHits + this.stats.edgeMisses) * 100,
      serviceWorkerHitRate: this.stats.serviceWorkerHits / (this.stats.serviceWorkerHits + this.stats.serviceWorkerMisses) * 100,
      cdnHitRate: this.stats.cdnHits / (this.stats.cdnHits + this.stats.cdnMisses) * 100,
      overallHitRate: (this.stats.edgeHits + this.stats.serviceWorkerHits + this.stats.cdnHits) / total * 100
    }
  }

  // Clear all caches
  async clearAllCaches() {
    try {
      // Clear service worker cache
      const cache = await caches.open(this.cacheName)
      const keys = await cache.keys()
      await Promise.all(keys.map(key => cache.delete(key)))
      
      // Clear edge CDN
      await fetch(`${this.edgeEndpoint}/cache/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheName: this.cacheName })
      })
      
      // Reset stats
      this.stats = {
        edgeHits: 0,
        edgeMisses: 0,
        serviceWorkerHits: 0,
        serviceWorkerMisses: 0,
        cdnHits: 0,
        cdnMisses: 0,
        totalRequests: 0
      }
      
      return true
    } catch (error) {
      console.warn('Cache clearing failed:', error)
      return false
    }
  }
}

// React hook for edge caching
export function useEdgeCache(options = {}) {
  const edgeCache = useRef(new EdgeCacheService(options)).current
  
  useEffect(() => {
    edgeCache.initServiceWorker()
  }, [edgeCache])
  
  return edgeCache
}

// Market data edge caching hook
export function useMarketDataEdgeCache() {
  const edgeCache = useEdgeCache()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  const getCachedMarketData = useCallback(async (ticker, fetcher, options = {}) => {
    setLoading(true)
    setError(null)
    
    try {
      const cacheKey = `market-data-${ticker}`
      
      // Try edge cache first
      let data = await edgeCache.getFromEdgeCache(cacheKey, options)
      
      if (!data) {
        // Fetch fresh data
        data = await fetcher()
        
        // Store in edge cache
        await edgeCache.storeInEdgeCache(cacheKey, data, {
          ttl: 5000, // 5 seconds for market data
          strategy: 'market-data'
        })
      }
      
      return data.data || data
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [edgeCache])
  
  const preloadMarketData = useCallback(async (tickers) => {
    const preloadData = tickers.map(ticker => ({
      key: `market-data-${ticker}`,
      data: null, // Will be fetched on demand
      options: { strategy: 'market-data-preload' }
    }))
    
    return edgeCache.preloadCriticalData(preloadData)
  }, [edgeCache])
  
  return {
    getCachedMarketData,
    preloadMarketData,
    loading,
    error,
    stats: edgeCache.getStats()
  }
}

// Bot configuration edge caching hook
export function useBotConfigEdgeCache() {
  const edgeCache = useEdgeCache()
  
  const getCachedBotConfig = useCallback(async (botId, fetcher) => {
    const cacheKey = `bot-config-${botId}`
    
    // Try edge cache first
    let data = await edgeCache.getFromEdgeCache(cacheKey, {
      strategy: 'bot-config'
    })
    
    if (!data) {
      // Fetch fresh data
      data = await fetcher()
      
      // Store in edge cache
      await edgeCache.storeInEdgeCache(cacheKey, data, {
        ttl: 300000, // 5 minutes for bot config
        strategy: 'bot-config'
      })
    }
    
    return data.data || data
  }, [edgeCache])
  
  const invalidateBotConfig = useCallback(async (botId) => {
    const cacheKey = `bot-config-${botId}`
    return edgeCache.invalidateCache(cacheKey, { strategy: 'bot-config' })
  }, [edgeCache])
  
  return { getCachedBotConfig, invalidateBotConfig }
}

export default EdgeCacheService
