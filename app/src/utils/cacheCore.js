// Cache Core - LRU implementation and basic operations
// Separated for better modularity and testing

// Performance timing with fallback for server-side/SSR
export const getPerformanceNow = () => {
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

// LRU Cache implementation
export class LRUCache {
  constructor(maxSize = 500) {
    this.maxSize = maxSize
    this.cache = new Map()
    this.accessOrder = new Map() // Track access order for LRU
  }

  _updateAccessOrder(key) {
    if (this.accessOrder.has(key)) {
      this.accessOrder.delete(key)
    }
    this.accessOrder.set(key, Date.now())
  }

  _evictLRU() {
    if (this.cache.size >= this.maxSize) {
      // Find least recently used key
      let oldestKey = null
      let oldestTime = Date.now()
      
      for (const [key, time] of this.accessOrder) {
        if (time < oldestTime) {
          oldestTime = time
          oldestKey = key
        }
      }
      
      if (oldestKey) {
        this.cache.delete(oldestKey)
        this.accessOrder.delete(oldestKey)
        return true
      }
    }
    return false
  }

  set(key, value, ttl = 5 * 60_000) {
    this._evictLRU()
    
    const item = {
      data: value,
      expires: Date.now() + ttl,
      cachedAt: Date.now(),
      ttl
    }
    
    this.cache.set(key, item)
    this._updateAccessOrder(key)
  }

  get(key) {
    const item = this.cache.get(key)
    if (!item) return null
    
    // Check expiration
    if (Date.now() > item.expires) {
      this.cache.delete(key)
      this.accessOrder.delete(key)
      return null
    }
    
    this._updateAccessOrder(key)
    return item.data
  }

  delete(key) {
    const deleted = this.cache.delete(key)
    this.accessOrder.delete(key)
    return deleted
  }

  clear() {
    this.cache.clear()
    this.accessOrder.clear()
  }

  size() {
    return this.cache.size
  }

  keys() {
    return Array.from(this.cache.keys())
  }

  // Stale-while-revalidate support
  getStale(key) {
    const item = this.cache.get(key)
    if (!item) return null
    
    const isExpired = Date.now() > item.expires
    return {
      data: item.data,
      isStale: isExpired,
      age: Date.now() - item.cachedAt,
      ttl: item.ttl
    }
  }
}

// Global cache instance
export const globalCache = new LRUCache()
