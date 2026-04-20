// Orders Bootstrap Endpoint (Fastify)
// Aggregates all ticker data needed for Orders.jsx in a single request.

import alphaEngineService from '../services/alphaEngineService.js'
import executionsService from '../services/executionsService.js'

// Cache with TTL policies (in-memory)
const cache = new Map()
const TTL_MS = {
  bootstrap:       2 * 60 * 1000,           // 2 minutes
  tickers:         24 * 60 * 60 * 1000,     // 1 day
  company:         7 * 24 * 60 * 60 * 1000, // 7 days
  stats:           5 * 60 * 1000,           // 5 minutes
  quote:           30 * 1000,               // 30 seconds
  history:         60 * 60 * 1000,          // 1 hour
  explainability:  10 * 60 * 1000,          // 10 minutes
  ownership:       2 * 60 * 1000            // 2 minutes (user data changes frequently)
}

function getCacheKey(type, ticker, params = '') {
  return `${type}:${ticker}:${params}`
}

function getCachedData(type, ticker, params = '') {
  const key = getCacheKey(type, ticker, params)
  const cached = cache.get(key)
  if (!cached) return null
  const ttl = TTL_MS[type]
  if (!ttl) return null
  if (Date.now() - cached.timestamp < ttl) return cached.data
  return null
}

function setCachedData(type, ticker, data, params = '') {
  const key = getCacheKey(type, ticker, params)
  cache.set(key, { data, timestamp: Date.now() })
}

async function getUserOwnershipData(ticker, userId = 'default') {
  // Ownership is derived from executions (filled + queued) and is approximate.
  const executions = await executionsService.getExecutions({
    ticker,
    userId,
    limit: 100
  })

  if (!executions.data || executions.data.length === 0) {
    return {
      currentShares: 0,
      avgCost: 0,
      realizedPnL: 0,
      lastTrade: null,
      lifetimeTradeCount: 0,
      totalBuys: 0,
      totalSells: 0,
      tradeHistory: []
    }
  }

  const tickerExecutions = executions.data
  let currentShares = 0
  let totalCost = 0
  let realizedPnL = 0
  let totalBuys = 0
  let totalSells = 0

  for (const exec of tickerExecutions) {
    if (exec.direction === 'buy') {
      currentShares += exec.quantity
      totalCost += exec.quantity * exec.price
      totalBuys += 1
      continue
    }

    if (exec.direction === 'sell') {
      const sharesSold = Math.min(exec.quantity, currentShares)
      const avgCostPerShare = currentShares > 0 ? totalCost / currentShares : 0
      realizedPnL += sharesSold * (exec.price - avgCostPerShare)
      currentShares -= sharesSold
      totalCost -= sharesSold * avgCostPerShare
      totalSells += 1
    }
  }

  const avgCost = currentShares > 0 ? totalCost / currentShares : 0
  const lastTrade = tickerExecutions.reduce((latest, exec) => (
    (!latest || new Date(exec.createdAt) > new Date(latest.createdAt)) ? exec : latest
  ), null)

  return {
    currentShares,
    avgCost,
    realizedPnL,
    lastTrade,
    lifetimeTradeCount: tickerExecutions.length,
    totalBuys,
    totalSells,
    tradeHistory: tickerExecutions.slice(-10).map(exec => ({
      id: exec.id,
      direction: exec.direction,
      quantity: exec.quantity,
      price: exec.price,
      timestamp: exec.createdAt,
      status: exec.status
    }))
  }
}

export default async function ordersRoutes(app) {
  // GET /api/orders/bootstrap
  app.get('/bootstrap', async (request, reply) => {
    try {
      const { ticker, range = '1Y', interval = '1D' } = request.query ?? {}
      if (!ticker) {
        return reply.code(400).send({ error: 'Ticker parameter is required' })
      }

      const paramsKey = `${range}:${interval}`
      const cachedBootstrap = getCachedData('bootstrap', ticker, paramsKey)
      if (cachedBootstrap) return reply.send(cachedBootstrap)

      const requestId = Date.now() + Math.random()
      const userId = request.user?.id ?? 'default'

      const [
        quote,
        stats,
        company,
        history,
        explainability,
        userOwnership
      ] = await Promise.allSettled([
        (async () => {
          const cached = getCachedData('quote', ticker)
          if (cached) return cached
          const data = await alphaEngineService.getQuote(ticker)
          setCachedData('quote', ticker, data)
          return data
        })(),
        (async () => {
          const cached = getCachedData('stats', ticker)
          if (cached) return cached
          const data = await alphaEngineService.getStats(ticker)
          setCachedData('stats', ticker, data)
          return data
        })(),
        (async () => {
          const cached = getCachedData('company', ticker)
          if (cached) return cached
          const data = await alphaEngineService.getCompany(ticker)
          setCachedData('company', ticker, data)
          return data
        })(),
        (async () => {
          const cached = getCachedData('history', ticker, paramsKey)
          if (cached) return cached
          const data = await alphaEngineService.getHistory(ticker, range, interval)
          setCachedData('history', ticker, data, paramsKey)
          return data
        })(),
        (async () => {
          const cached = getCachedData('explainability', ticker)
          if (cached) return cached
          const data = await alphaEngineService.getTickerExplainability(ticker)
          setCachedData('explainability', ticker, data)
          return data
        })(),
        (async () => {
          const cached = getCachedData('ownership', ticker, userId)
          if (cached) return cached
          const data = await getUserOwnershipData(ticker, userId)
          setCachedData('ownership', ticker, data, userId)
          return data
        })()
      ])

      const bootstrapData = {
        ticker,
        quote: quote.status === 'fulfilled' ? quote.value : null,
        stats: stats.status === 'fulfilled' ? stats.value : null,
        company: company.status === 'fulfilled' ? company.value : null,
        history: history.status === 'fulfilled' ? history.value : null,
        alpha: explainability.status === 'fulfilled' ? explainability.value : null,
        userOwnership: userOwnership.status === 'fulfilled' ? userOwnership.value : null,
        requestId,
        timestamp: new Date().toISOString(),
        dataCoverage: {
          quote: quote.status === 'fulfilled',
          stats: stats.status === 'fulfilled',
          company: company.status === 'fulfilled',
          history: history.status === 'fulfilled',
          alpha: explainability.status === 'fulfilled',
          userOwnership: userOwnership.status === 'fulfilled'
        }
      }

      setCachedData('bootstrap', ticker, bootstrapData, paramsKey)
      return reply.send(bootstrapData)
    } catch (error) {
      request.log?.error?.(error)
      return reply.code(500).send({
        error: 'Failed to fetch bootstrap data',
        message: error.message
      })
    }
  })

  // GET /api/orders/tickers
  app.get('/tickers', async (request, reply) => {
    try {
      const { search = '' } = request.query ?? {}
      const cached = getCachedData('tickers', 'all', search)
      if (cached) return reply.send(cached)

      const tickers = await alphaEngineService.getTickers(search)
      setCachedData('tickers', 'all', tickers, search)
      return reply.send(tickers)
    } catch (error) {
      request.log?.error?.(error)
      return reply.code(500).send({
        error: 'Failed to fetch tickers',
        message: error.message
      })
    }
  })

  // DELETE /api/orders/cache (dev utility)
  app.delete('/cache', async (request, reply) => {
    cache.clear()
    return reply.send({ message: 'Cache cleared' })
  })

  // GET /api/orders/cache/stats (dev utility)
  app.get('/cache/stats', async (request, reply) => {
    const stats = {}
    for (const key of cache.keys()) {
      const [type] = key.split(':')
      stats[type] = (stats[type] || 0) + 1
    }
    return reply.send({
      totalEntries: cache.size,
      byType: stats,
      ttlMs: TTL_MS
    })
  })
}

