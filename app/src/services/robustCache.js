// Robust cache implementation with proper eviction strategies

export class LRUCache {
  constructor(maxSize = 100, ttl = 5 * 60 * 1000) {
    this.maxSize = maxSize
    this.ttl = ttl
    this.cache = new Map()
    this.timers = new Map()
    this.hits = 0
    this.misses = 0
  }

  get(key) {
    const entry = this.cache.get(key)
    
    if (!entry) {
      this.misses++
      return null
    }
    
    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.delete(key)
      this.misses++
      return null
    }
    
    // Move to end (LRU)
    this.cache.delete(key)
    this.cache.set(key, entry)
    this.hits++
    
    return entry.value
  }

  set(key, value) {
    // Delete existing if present
    if (this.cache.has(key)) {
      this.delete(key)
    }
    
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      this.delete(oldestKey)
    }
    
    // Set new entry
    const entry = {
      value,
      timestamp: Date.now()
    }
    
    this.cache.set(key, entry)
    
    // Set TTL timer
    const timer = setTimeout(() => {
      this.delete(key)
    }, this.ttl)
    this.timers.set(key, timer)
  }

  delete(key) {
    if (this.cache.has(key)) {
      this.cache.delete(key)
      
      // Clear timer
      const timer = this.timers.get(key)
      if (timer) {
        clearTimeout(timer)
        this.timers.delete(key)
      }
      
      return true
    }
    return false
  }

  clear() {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    
    this.cache.clear()
    this.timers.clear()
    this.hits = 0
    this.misses = 0
  }

  getStats() {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total) * 100 : 0,
      memoryUsage: this.estimateMemoryUsage()
    }
  }

  estimateMemoryUsage() {
    // Rough estimate in bytes
    let size = 0
    for (const [key, entry] of this.cache) {
      size += key.length * 2 // UTF-16
      size += JSON.stringify(entry.value).length * 2
      size += 16 // overhead
    }
    return size
  }
}

// Memory-aware cache with size limits
export class MemoryAwareCache {
  constructor(maxMemoryMB = 50, ttl = 5 * 60 * 1000) {
    this.maxMemoryBytes = maxMemoryMB * 1024 * 1024
    this.ttl = ttl
    this.cache = new Map()
    this.timers = new Map()
    this.currentMemoryUsage = 0
    this.hits = 0
    this.misses = 0
  }

  get(key) {
    const entry = this.cache.get(key)
    
    if (!entry) {
      this.misses++
      return null
    }
    
    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.delete(key)
      this.misses++
      return null
    }
    
    // Move to end (LRU)
    this.cache.delete(key)
    this.cache.set(key, entry)
    this.hits++
    
    return entry.value
  }

  set(key, value) {
    const valueSize = this.estimateSize(value)
    
    // Delete existing if present
    if (this.cache.has(key)) {
      this.delete(key)
    }
    
    // Evict entries until we have enough memory
    while (this.currentMemoryUsage + valueSize > this.maxMemoryBytes && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next().value
      this.delete(oldestKey)
    }
    
    // If still not enough memory, reject the entry
    if (valueSize > this.maxMemoryBytes) {
      console.warn(`Cache entry too large: ${valueSize} bytes`)
      return false
    }
    
    // Set new entry
    const entry = {
      value,
      timestamp: Date.now(),
      size: valueSize
    }
    
    this.cache.set(key, entry)
    this.currentMemoryUsage += valueSize
    
    // Set TTL timer
    const timer = setTimeout(() => {
      this.delete(key)
    }, this.ttl)
    this.timers.set(key, timer)
    
    return true
  }

  delete(key) {
    const entry = this.cache.get(key)
    if (entry) {
      this.cache.delete(key)
      this.currentMemoryUsage -= entry.size
      
      // Clear timer
      const timer = this.timers.get(key)
      if (timer) {
        clearTimeout(timer)
        this.timers.delete(key)
      }
      
      return true
    }
    return false
  }

  clear() {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    
    this.cache.clear()
    this.timers.clear()
    this.currentMemoryUsage = 0
    this.hits = 0
    this.misses = 0
  }

  estimateSize(value) {
    // Rough estimate in bytes
    if (typeof value === 'string') {
      return value.length * 2
    } else if (typeof value === 'number') {
      return 8
    } else if (typeof value === 'object') {
      return JSON.stringify(value).length * 2 + 16
    } else {
      return 16
    }
  }

  getStats() {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      memoryUsage: this.currentMemoryUsage,
      maxMemory: this.maxMemoryBytes,
      memoryUtilization: (this.currentMemoryUsage / this.maxMemoryBytes) * 100,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total) * 100 : 0
    }
  }
}

// Tiered cache with multiple eviction strategies
export class TieredCache {
  constructor(options = {}) {
    const {
      hotSize = 50,
      warmSize = 200,
      coldSize = 500,
      hotTTL = 60 * 1000,  // 1 minute
      warmTTL = 5 * 60 * 1000,  // 5 minutes
      coldTTL = 30 * 60 * 1000  // 30 minutes
    } = options
    
    this.hotCache = new LRUCache(hotSize, hotTTL)
    this.warmCache = new LRUCache(warmSize, warmTTL)
    this.coldCache = new LRUCache(coldSize, coldTTL)
    
    this.promotions = 0
    this.demotions = 0
  }

  get(key) {
    // Check hot cache first
    let value = this.hotCache.get(key)
    if (value !== null) {
      return value
    }
    
    // Check warm cache
    value = this.warmCache.get(key)
    if (value !== null) {
      // Promote to hot cache
      this.hotCache.set(key, value)
      this.promotions++
      return value
    }
    
    // Check cold cache
    value = this.coldCache.get(key)
    if (value !== null) {
      // Promote to warm cache
      this.warmCache.set(key, value)
      this.promotions++
      return value
    }
    
    return null
  }

  set(key, value) {
    // Always start in cold cache
    this.coldCache.set(key, value)
  }

  getStats() {
    return {
      hot: this.hotCache.getStats(),
      warm: this.warmCache.getStats(),
      cold: this.coldCache.getStats(),
      promotions: this.promotions,
      demotions: this.demotions
    }
  }

  clear() {
    this.hotCache.clear()
    this.warmCache.clear()
    this.coldCache.clear()
    this.promotions = 0
    this.demotions = 0
  }
}

// Cache factory for different use cases
export class CacheFactory {
  static createPriceHistoryCache() {
    // Price history needs memory awareness and moderate TTL
    return new MemoryAwareCache(20, 10 * 60 * 1000) // 20MB, 10 minutes
  }
  
  static createStockDataCache() {
    // Stock data is relatively static, can use longer TTL
    return new LRUCache(1000, 60 * 60 * 1000) // 1000 items, 1 hour
  }
  
  static createPredictionCache() {
    // Predictions change frequently, need hot cache
    return new LRUCache(500, 2 * 60 * 1000) // 500 items, 2 minutes
  }
  
  static createCalculationCache() {
    // Calculations are expensive, use tiered cache
    return new TieredCache({
      hotSize: 20,
      warmSize: 100,
      coldSize: 500,
      hotTTL: 60 * 1000,
      warmTTL: 5 * 60 * 1000,
      coldTTL: 30 * 60 * 1000
    })
  }
}

// Global cache instances
export const GlobalCaches = {
  priceHistory: CacheFactory.createPriceHistoryCache(),
  stockData: CacheFactory.createStockDataCache(),
  predictions: CacheFactory.createPredictionCache(),
  calculations: CacheFactory.createCalculationCache()
}

// Cache monitoring
export class CacheMonitor {
  static startMonitoring(intervalMs = 30000) {
    setInterval(() => {
      console.log('Cache Stats:', {
        priceHistory: GlobalCaches.priceHistory.getStats(),
        stockData: GlobalCaches.stockData.getStats(),
        predictions: GlobalCaches.predictions.getStats(),
        calculations: GlobalCaches.calculations.getStats()
      })
    }, intervalMs)
  }
  
  static getHealthReport() {
    const report = {}
    
    for (const [name, cache] of Object.entries(GlobalCaches)) {
      const stats = cache.getStats()
      report[name] = {
        healthy: stats.hitRate > 50 && stats.memoryUtilization < 80,
        ...stats
      }
    }
    
    return report
  }
  
  static cleanup() {
    for (const cache of Object.values(GlobalCaches)) {
      cache.clear()
    }
  }
}
