// Fastify response caching (in-memory, TTL-based)
import { createHash } from 'crypto'

class MemoryCache {
  constructor(maxSize = 1000, defaultTTL = 300000) {
    this.cache = new Map()
    this.maxSize = maxSize
    this.defaultTTL = defaultTTL
    this.hitCount = 0
    this.missCount = 0
  }

  set(key, value, ttl = this.defaultTTL) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }

    const size =
      typeof value?.payload === 'string'
        ? Buffer.byteLength(value.payload, 'utf8')
        : Buffer.isBuffer(value?.payload)
          ? value.payload.length
          : 0

    this.cache.set(key, {
      value,
      expires: Date.now() + ttl,
      size
    })
  }

  get(key) {
    const item = this.cache.get(key)
    if (!item) {
      this.missCount++
      return null
    }

    if (Date.now() > item.expires) {
      this.cache.delete(key)
      this.missCount++
      return null
    }

    this.hitCount++
    return item.value
  }

  delete(key) {
    return this.cache.delete(key)
  }

  clear() {
    this.cache.clear()
    this.hitCount = 0
    this.missCount = 0
  }

  getStats() {
    const total = this.hitCount + this.missCount
    return {
      size: this.cache.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: total > 0 ? ((this.hitCount / total) * 100).toFixed(2) + '%' : '0%',
      memoryUsage: Array.from(this.cache.values()).reduce((sum, item) => sum + item.size, 0)
    }
  }
}

const cacheConfig = {
  'market-data': { ttl: 5000, maxSize: 500 },
  'bot-catalog': { ttl: 300000, maxSize: 100 },
  portfolio: { ttl: 10000, maxSize: 200 },
  performance: { ttl: 60000, maxSize: 100 },
  executions: { ttl: 30000, maxSize: 1000 },
  'user-data': { ttl: 120000, maxSize: 50 }
}

const caches = Object.fromEntries(
  Object.entries(cacheConfig).map(([type, cfg]) => [type, new MemoryCache(cfg.maxSize, cfg.ttl)])
)

const generateCacheKey = (request) => {
  const keyData = {
    method: request.method,
    url: request.url,
    userId: request.user?.id || 'anonymous'
  }
  return createHash('md5').update(JSON.stringify(keyData)).digest('hex')
}

const getCacheType = (url) => {
  if (url.includes('/market-data') || url.includes('/tickers')) return 'market-data'
  if (url.includes('/catalog') || url.includes('/templates')) return 'bot-catalog'
  if (url.includes('/portfolio')) return 'portfolio'
  if (url.includes('/performance')) return 'performance'
  if (url.includes('/executions')) return 'executions'
  if (url.includes('/user') || url.includes('/profile')) return 'user-data'
  return null
}

export const createCacheMiddleware = (cacheType) => {
  const cache = caches[cacheType]
  if (!cache) {
    console.warn(`Unknown cache type: ${cacheType}`)
    return async () => {}
  }

  return async (request, reply) => {
    if (request.method !== 'GET') return

    const cacheControl = request.headers['cache-control']
    if (typeof cacheControl === 'string' && cacheControl.includes('no-cache')) return

    const key = generateCacheKey(request)
    const cached = cache.get(key)

    if (cached) {
      reply.header('X-Cache', 'HIT')
      reply.header('X-Cache-Key', key.substring(0, 8))
      reply.header('X-Cache-Age', Math.floor((Date.now() - cached.timestamp) / 1000))

      if (cached.contentType) reply.header('content-type', cached.contentType)
      if (cached.contentEncoding) reply.header('content-encoding', cached.contentEncoding)
      if (cached.statusCode) reply.code(cached.statusCode)

      reply.send(cached.payload)
      return
    }

    request.__cache = { key, cacheType }
    reply.header('X-Cache', 'MISS')
    reply.header('X-Cache-Key', key.substring(0, 8))
  }
}

export const autoCache = async (request, reply) => {
  const cacheType = getCacheType(request.url)
  if (!cacheType) return
  return createCacheMiddleware(cacheType)(request, reply)
}

const shouldCacheReply = (reply) => {
  if (reply.statusCode !== 200) return false
  const responseCacheControl = reply.getHeader('cache-control')
  if (typeof responseCacheControl === 'string' && responseCacheControl.includes('no-store')) return false
  return true
}

const cacheOnSend = async (request, reply, payload) => {
  const cacheInfo = request.__cache
  if (!cacheInfo) return payload

  const cache = caches[cacheInfo.cacheType]
  if (!cache || !shouldCacheReply(reply)) return payload

  // Don't attempt to cache streams.
  if (payload && typeof payload === 'object' && typeof payload.pipe === 'function') return payload

  let payloadToStore = payload
  if (payloadToStore != null && typeof payloadToStore === 'object' && !Buffer.isBuffer(payloadToStore)) {
    try {
      payloadToStore = JSON.stringify(payloadToStore)
    } catch {
      return payload
    }
  }

  cache.set(cacheInfo.key, {
    payload: payloadToStore,
    timestamp: Date.now(),
    contentType: reply.getHeader('content-type'),
    contentEncoding: reply.getHeader('content-encoding'),
    statusCode: reply.statusCode
  })

  return payload
}

export const warmCache = async (app) => {
  console.log('Warming up caches...')

  try {
    await app.inject({ method: 'GET', url: '/api/bots/catalog' })
    const popularTickers = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN']
    await Promise.all(
      popularTickers.map((ticker) => app.inject({ method: 'GET', url: `/api/market-data/${ticker}` }))
    )
    console.log('Cache warming completed')
  } catch (error) {
    console.error('Cache warming failed:', error)
  }
}

export const invalidateCache = (cacheType, pattern) => {
  const cache = caches[cacheType]
  if (!cache) return

  if (pattern) {
    for (const key of cache.cache.keys()) {
      if (key.includes(pattern)) cache.delete(key)
    }
    return
  }

  cache.clear()
}

export const getCacheStats = () =>
  Object.fromEntries(Object.entries(caches).map(([type, cache]) => [type, cache.getStats()]))

export const resetAllCaches = () => {
  Object.values(caches).forEach((cache) => cache.clear())
}

export const cacheHealthCheck = () => {
  const health = { status: 'healthy', caches: {}, issues: [] }

  for (const [type, cache] of Object.entries(caches)) {
    const stats = cache.getStats()
    health.caches[type] = stats

    // Note: hitRate is a formatted string ("12.34%"), keep the original behavior.
    if (stats.hitRate < '50%') health.issues.push(`Low hit rate for ${type}: ${stats.hitRate}`)
    if (stats.memoryUsage > 50 * 1024 * 1024) {
      health.issues.push(`High memory usage for ${type}: ${Math.round(stats.memoryUsage / 1024 / 1024)}MB`)
    }
  }

  if (health.issues.length > 0) health.status = 'warning'
  return health
}

// Rate limiting for cache warming
const rateLimitMap = new Map()

export const rateLimitCacheWarmup = (key, limit = 1, windowMs = 60000) => {
  const now = Date.now()
  const windowStart = now - windowMs

  if (!rateLimitMap.has(key)) rateLimitMap.set(key, [])

  const requests = rateLimitMap.get(key)
  const validRequests = requests.filter((time) => time > windowStart)

  if (validRequests.length >= limit) return false

  validRequests.push(now)
  rateLimitMap.set(key, validRequests)
  return true
}

export default async function cachingPlugin(app) {
  app.addHook('preHandler', autoCache)
  app.addHook('onSend', cacheOnSend)
}

