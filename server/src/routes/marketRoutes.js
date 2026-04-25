import { engineClient } from '../clients/engine.js'
import { route } from './helpers/routeWrapper.js'
import predictionsService from '../services/predictionsService.js'

export default async function marketRoutes(fastify, opts) {
  fastify.get('/calendar', route(async (request, reply) => {
    const { month = null, limit = 50, distribution = 'uniform', min_days = 12 } = request.query ?? {}

    const limitNum = Math.max(1, Math.min(500, Number(limit) || 50))
    const minDaysNum = Math.max(1, Math.min(31, Number(min_days) || 12))
    const distStr = String(distribution || 'uniform').trim().toLowerCase()

    if (distStr !== 'actual' && distStr !== 'uniform') {
      return reply.code(400).send({ error: 'invalid distribution; use actual or uniform' })
    }

    const data = await engineClient.getCalendarEvents(month, limitNum, distStr, minDaysNum)
    return data
  }))

  fastify.get('/health', route(async (request, reply) => {
    const health = await engineClient.checkHealth()
    return { success: true, data: health }
  }))

  fastify.get('/api/tickers', route(async (request, reply) => {
    const { q = '' } = request.query
    const data = await engineClient.getTickers(q)
    return { success: true, data }
  }))

  fastify.get('/api/quote/:symbol', route(async (request, reply) => {
    const { symbol } = request.params
    const data = await engineClient.getQuote(symbol)
    return { success: true, data }
  }))

  fastify.get('/api/quotes', route(async (request, reply) => {
    const { symbols } = request.query
    if (!symbols) {
      return reply.code(400).send({ error: 'Symbols query parameter required' })
    }

    const symbolList = String(symbols).split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    if (symbolList.length === 0) {
      return reply.code(400).send({ error: 'At least one symbol required' })
    }

    if (symbolList.length > 50) {
      return reply.code(400).send({ error: 'Maximum 50 symbols per batch request' })
    }

    // Batch fetch quotes in parallel using engineClient which handles symbol normalization
    const quotePromises = symbolList.map(symbol =>
      engineClient.getQuote(symbol).catch(() => null)
    )
    const quotes = await Promise.all(quotePromises)

    const results = quotes.map((quote, index) => {
      if (!quote) {
        return { symbol: symbolList[index], error: 'Quote not found' }
      }
      return { symbol: symbolList[index], ...quote }
    })

    return { success: true, data: results, count: results.length }
  }))

  fastify.get('/api/history/:symbol', route(async (request, reply) => {
    const { symbol } = request.params
    const { range = '1Y', interval = '1D' } = request.query
    const data = await engineClient.getHistory(symbol, range, interval)
    return { success: true, data }
  }))

  fastify.get('/api/stats/:symbol', route(async (request, reply) => {
    const { symbol } = request.params
    const data = await engineClient.getStats(symbol)
    return { success: true, data }
  }))

  fastify.get('/api/company/:symbol', route(async (request, reply) => {
    const { symbol } = request.params
    const data = await engineClient.getCompany(symbol)
    return { success: true, data }
  }))

  fastify.get('/api/regime/:symbol', route(async (request, reply) => {
    const { symbol } = request.params
    const data = await engineClient.getRegime(symbol)
    return { success: true, data }
  }))

  fastify.get('/ticker/:symbol/performance', route(async (request, reply) => {
    const { symbol } = request.params
    const { window = '30d' } = request.query
    const data = await engineClient.getTickerPerformance(symbol, window)
    return { success: true, data }
  }))

  fastify.get('/admission/changes', route(async (request, reply) => {
    const { hours = 24 } = request.query
    const data = await engineClient.getAdmissionChanges(parseInt(hours))
    return { success: true, data }
  }))

  fastify.get('/dashboard', route(async (request, reply) => {
    const data = await engineClient.getDashboardData()
    return { success: true, data }
  }))

  fastify.get('/dashboard/bootstrap', route(async (request, reply) => {
    const { fastify: { prisma } } = opts

    // Fetch all dashboard data in parallel
    const [engineData, bots, executions, priceMap, performanceStats, portfolioSummary] = await Promise.allSettled([
      engineClient.getDashboardData(),
      prisma.bot.findMany({ where: { status: 'running' } }).catch(() => []),
      prisma.execution.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }).catch(() => []),
      prisma.liveQuote.findMany().catch(() => []).then(quotes => {
        const map = {}
        quotes.forEach(q => map[q.ticker] = q)
        return map
      }),
      prisma.performanceStats.findFirst().catch(() => null),
      prisma.portfolioSummary.findFirst().catch(() => null)
    ])

    return {
      success: true,
      data: {
        engine: engineData.status === 'fulfilled' ? engineData.value : null,
        bots: bots.status === 'fulfilled' ? bots.value : [],
        executions: executions.status === 'fulfilled' ? executions.value : [],
        prices: priceMap.status === 'fulfilled' ? priceMap.value : {},
        performanceStats: performanceStats.status === 'fulfilled' ? performanceStats.value : null,
        portfolioSummary: portfolioSummary.status === 'fulfilled' ? portfolioSummary.value : null,
        lastUpdated: new Date().toISOString()
      }
    }
  }))

  fastify.get('/ticker/:symbol/dashboard', route(async (request, reply) => {
    const { symbol } = request.params
    const { range = '1Y', interval = '1D' } = request.query
    const data = await engineClient.getBootstrapData(symbol, range, interval)
    return { success: true, data }
  }))

  fastify.get('/signals/active', route(async (request, reply) => {
    const signals = await engineClient.getActiveSignals()
    return { success: true, data: signals }
  }))
}
