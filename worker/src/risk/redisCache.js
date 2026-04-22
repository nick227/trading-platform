// Redis-based risk state cache for multi-instance safety
// Replaces in-memory Map with distributed Redis cache

import Redis from 'ioredis'

class RedisRiskCache {
  constructor(redisUrl = process.env.REDIS_URL) {
    this.redis = new Redis(redisUrl, {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    })
    
    this.keyPrefix = 'risk:state:'
    this.defaultTtl = 30 // 30 seconds
  }

  async connect() {
    try {
      await this.redis.connect()
      console.log('Redis risk cache connected')
    } catch (error) {
      console.error('Failed to connect to Redis:', error)
      throw error
    }
  }

  async disconnect() {
    await this.redis.disconnect()
  }

  // Get risk state from cache
  async get(portfolioId) {
    try {
      const key = this.keyPrefix + portfolioId
      const cached = await this.redis.get(key)
      
      if (cached) {
        const data = JSON.parse(cached)
        return data.state
      }
      
      return null
    } catch (error) {
      console.error('Failed to get from Redis cache:', error)
      return null
    }
  }

  // Set risk state in cache
  async set(portfolioId, state, ttl = this.defaultTtl) {
    try {
      const key = this.keyPrefix + portfolioId
      const data = {
        state,
        timestamp: Date.now()
      }
      
      await this.redis.setex(key, ttl, JSON.stringify(data))
      return true
    } catch (error) {
      console.error('Failed to set Redis cache:', error)
      return false
    }
  }

  // Delete risk state from cache
  async delete(portfolioId) {
    try {
      const key = this.keyPrefix + portfolioId
      await this.redis.del(key)
      return true
    } catch (error) {
      console.error('Failed to delete from Redis cache:', error)
      return false
    }
  }

  // Clear all risk state cache
  async clear() {
    try {
      const pattern = this.keyPrefix + '*'
      const keys = await this.redis.keys(pattern)
      
      if (keys.length > 0) {
        await this.redis.del(...keys)
      }
      
      return true
    } catch (error) {
      console.error('Failed to clear Redis cache:', error)
      return false
    }
  }

  // Check if cache exists and is fresh
  async isFresh(portfolioId, maxAgeMs = 30000) {
    try {
      const key = this.keyPrefix + portfolioId
      const cached = await this.redis.get(key)
      
      if (cached) {
        const data = JSON.parse(cached)
        return (Date.now() - data.timestamp) < maxAgeMs
      }
      
      return false
    } catch (error) {
      console.error('Failed to check cache freshness:', error)
      return false
    }
  }

  // Get cache statistics
  async getStats() {
    try {
      const pattern = this.keyPrefix + '*'
      const keys = await this.redis.keys(pattern)
      
      const stats = {
        totalKeys: keys.length,
        memoryUsage: 0,
        oldestKey: null,
        newestKey: null
      }
      
      if (keys.length > 0) {
        // Get memory usage for all keys
        const pipeline = this.redis.pipeline()
        keys.forEach(key => pipeline.memory('usage', key))
        const memoryResults = await pipeline.exec()
        
        stats.memoryUsage = memoryResults.reduce((sum, [err, usage]) => sum + (usage || 0), 0)
        
        // Get timestamps to find oldest/newest
        const timestampPipeline = this.redis.pipeline()
        keys.forEach(key => timestampPipeline.get(key))
        const timestampResults = await timestampPipeline.exec()
        
        let oldestTimestamp = Date.now()
        let newestTimestamp = 0
        let oldestKey = null
        let newestKey = null
        
        timestampResults.forEach(([err, data], index) => {
          if (!err && data) {
            const parsed = JSON.parse(data)
            if (parsed.timestamp < oldestTimestamp) {
              oldestTimestamp = parsed.timestamp
              oldestKey = keys[index]
            }
            if (parsed.timestamp > newestTimestamp) {
              newestTimestamp = parsed.timestamp
              newestKey = keys[index]
            }
          }
        })
        
        stats.oldestKey = oldestKey
        stats.newestKey = newestKey
      }
      
      return stats
    } catch (error) {
      console.error('Failed to get Redis cache stats:', error)
      return { totalKeys: 0, memoryUsage: 0, oldestKey: null, newestKey: null }
    }
  }

  // Health check
  async healthCheck() {
    try {
      const pong = await this.redis.ping()
      const info = await this.redis.info('server')
      
      return {
        status: 'healthy',
        latency: Date.now(),
        info: this.parseRedisInfo(info)
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      }
    }
  }

  // Parse Redis INFO response
  parseRedisInfo(info) {
    const lines = info.split('\r\n')
    const parsed = {}
    
    lines.forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':')
        if (key && value) {
          parsed[key] = value
        }
      }
    })
    
    return parsed
  }
}

// Export singleton instance
export const redisRiskCache = new RedisRiskCache()

export default redisRiskCache
