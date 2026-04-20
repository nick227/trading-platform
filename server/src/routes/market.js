// Market Data Routes - Live quotes from worker cache
// Bridges worker's real-time price cache to Orders.jsx

import prisma from '../loaders/prisma.js'

const QUOTE_TTL_MS = 30_000 // 30 seconds for UI freshness

export default async function marketRoutes(app) {
  // GET /api/market/quote/:ticker
  app.get('/quote/:ticker', async (request, reply) => {
    try {
      const { ticker } = request.params
      
      // Try live_quotes table first (worker cache)
      const liveQuote = await prisma.liveQuote.findUnique({
        where: { ticker: ticker.toUpperCase() }
      })
      
      if (liveQuote && (Date.now() - liveQuote.updatedAt.getTime() < QUOTE_TTL_MS)) {
        const ageMs = Date.now() - liveQuote.updatedAt.getTime()
        return reply.send({
          symbol: ticker,
          price: liveQuote.last,
          bid: liveQuote.bid,
          ask: liveQuote.ask,
          change: liveQuote.changePct,
          volume: liveQuote.volume,
          updatedAt: liveQuote.updatedAt.toISOString(),
          ageMs,
          source: 'worker',
          freshness: ageMs < 5000 ? 'live' : ageMs < 15000 ? 'fresh' : 'stale'
        })
      }
      
      // Fallback to alpha-engine if worker quote unavailable/stale
      const alphaEngineService = (await import('../services/alphaEngineService.js')).default
      const alphaQuote = await alphaEngineService.getQuote(ticker)
      
      if (alphaQuote) {
        return reply.send({
          symbol: ticker,
          price: alphaQuote.price,
          change: alphaQuote.change,
          volume: alphaQuote.volume,
          updatedAt: alphaQuote.timestamp,
          ageMs: 0,
          source: 'alpha-engine',
          freshness: 'delayed'
        })
      }
      
      return reply.code(404).send({ error: 'Quote not found' })
    } catch (error) {
      request.log?.error?.(error)
      return reply.code(500).send({ error: 'Failed to fetch quote' })
    }
  })

  // GET /api/market/bootstrap/:ticker
  app.get('/bootstrap/:ticker', async (request, reply) => {
    try {
      const { ticker } = request.params
      const { range = '1Y', interval = '1D' } = request.query
      
      // Get live quote from worker cache
      const liveQuote = await prisma.liveQuote.findUnique({
        where: { ticker: ticker.toUpperCase() }
      })
      
      // Get reference data from alpha-engine (parallel)
      const alphaEngineService = (await import('../services/alphaEngineService.js')).default
      const [stats, company, history, explainability, recommendation] = await Promise.allSettled([
        alphaEngineService.getStats(ticker),
        alphaEngineService.getCompany(ticker),
        alphaEngineService.getHistory(ticker, range, interval),
        alphaEngineService.getTickerExplainability(ticker),
        alphaEngineService.getTickerRecommendation(ticker).catch(() => null)
      ])

      const bootstrapData = {
        ticker,
        quote: liveQuote ? {
          symbol: ticker,
          price: liveQuote.last,
          bid: liveQuote.bid,
          ask: liveQuote.ask,
          change: liveQuote.changePct,
          volume: liveQuote.volume,
          updatedAt: liveQuote.updatedAt.toISOString(),
          ageMs: Date.now() - liveQuote.updatedAt.getTime(),
          source: 'worker',
          freshness: Date.now() - liveQuote.updatedAt.getTime() < 5000 ? 'live' : 'fresh'
        } : null,
        stats: stats.status === 'fulfilled' ? stats.value : null,
        company: company.status === 'fulfilled' ? company.value : null,
        history: history.status === 'fulfilled' ? history.value : null,
        alpha: explainability.status === 'fulfilled' ? explainability.value : null,
        recommendation: recommendation.status === 'fulfilled' ? recommendation.value : null,
        timestamp: new Date().toISOString(),
        dataCoverage: {
          quote: !!liveQuote,
          stats: stats.status === 'fulfilled',
          company: company.status === 'fulfilled',
          history: history.status === 'fulfilled',
          alpha: explainability.status === 'fulfilled'
        }
      }
      
      return reply.send(bootstrapData)
    } catch (error) {
      request.log?.error?.(error)
      return reply.code(500).send({ error: 'Failed to fetch bootstrap data' })
    }
  })

  // POST /api/market/subscribe (demand-driven warmup)
  app.post('/subscribe', async (request, reply) => {
    try {
      const { tickers } = request.body
      if (!Array.isArray(tickers) || tickers.length === 0) {
        return reply.code(400).send({ error: 'Tickers array required' })
      }
      
      // For MVP: trigger worker subscription via DB flag
      // Worker checks this table periodically for new subscriptions
      await Promise.all(tickers.map(async (ticker) => {
        await prisma.liveQuoteSubscription.upsert({
          where: { ticker: ticker.toUpperCase() },
          update: { requestedAt: new Date() },
          create: {
            ticker: ticker.toUpperCase(),
            requestedAt: new Date()
          }
        })
      }))
      
      return reply.send({ 
        message: 'Subscription requests queued',
        tickers: tickers.map(t => t.toUpperCase())
      })
    } catch (error) {
      request.log?.error?.(error)
      return reply.code(500).send({ error: 'Failed to subscribe' })
    }
  })
}
