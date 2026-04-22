import { engineClient } from '../clients/engine.js'
import { oldEngineClient } from '../clients/oldEngine.js'

const QUOTE_ENRICH_TTL_MS = 30_000
const quoteEnrichCache = new Map()

function getRowTicker(row) {
  return String(row?.ticker ?? row?.symbol ?? row?.tkr ?? '').toUpperCase()
}

function coerceNumber(value) {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

async function getCachedQuote(symbol) {
  const key = String(symbol).toUpperCase()
  const now = Date.now()
  const cached = quoteEnrichCache.get(key)
  if (cached && cached.expiresAt > now) return cached.quote

  const quote = await engineClient.getQuote(key)
  quoteEnrichCache.set(key, { quote, expiresAt: now + QUOTE_ENRICH_TTL_MS })
  return quote
}

async function enrichRankingsPayload(data, { limitConcurrency = 6 } = {}) {
  if (!data || typeof data !== 'object') return data
  const rows = Array.isArray(data.rankings) ? data.rankings : []
  if (rows.length === 0) return data

  const uniqueTickers = Array.from(new Set(rows.map(getRowTicker).filter(Boolean)))
  const quoteByTicker = new Map()

  let cursor = 0
  const workers = Array.from({ length: Math.min(limitConcurrency, uniqueTickers.length) }, async () => {
    while (cursor < uniqueTickers.length) {
      const i = cursor++
      const tkr = uniqueTickers[i]
      try {
        const quote = await getCachedQuote(tkr)
        quoteByTicker.set(tkr, quote)
      } catch (error) {
        quoteByTicker.set(tkr, null)
      }
    }
  })

  await Promise.all(workers)

  const enrichedRows = rows.map((row) => {
    const tkr = getRowTicker(row)
    const quote = tkr ? quoteByTicker.get(tkr) : null

    const price = row?.price ?? quote?.price ?? quote?.last ?? quote?.close
    const dailyChangePct = row?.dailyChangePct ?? quote?.dailyChangePct ?? quote?.changePct ?? quote?.change

    return {
      ...row,
      ticker: row?.ticker ?? (tkr || undefined),
      price: coerceNumber(price),
      dailyChangePct: coerceNumber(dailyChangePct)
    }
  })

  return { ...data, rankings: enrichedRows, _enrichedAt: new Date().toISOString() }
}

export default async function engineRoutes(fastify, opts) {
  
  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    try {
      const health = await engineClient.checkHealth()
      return { success: true, data: health }
    } catch (error) {
      fastify.log.error('Engine health check failed:', error)
      reply.code(503)
      return { success: false, error: error.message }
    }
  })

  // Market data endpoints
  fastify.get('/api/tickers', async (request, reply) => {
    try {
      const { q = '' } = request.query
      const data = await engineClient.getTickers(q)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get tickers failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/api/quote/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params
      const data = await engineClient.getQuote(symbol)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get quote failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/api/history/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params
      const { range = '1Y', interval = '1D' } = request.query
      const data = await engineClient.getHistory(symbol, range, interval)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get history failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/api/stats/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params
      const data = await engineClient.getStats(symbol)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get stats failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/api/company/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params
      const data = await engineClient.getCompany(symbol)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get company failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/api/regime/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params
      const data = await engineClient.getRegime(symbol)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get regime failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  // Research endpoints
  fastify.get('/api/ticker/:symbol/accuracy', async (request, reply) => {
    try {
      const { symbol } = request.params
      const data = await engineClient.getTickerAccuracy(symbol)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get ticker accuracy failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/api/ticker/:symbol/attribution', async (request, reply) => {
    try {
      const { symbol } = request.params
      const data = await engineClient.getTickerAttribution(symbol)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get ticker attribution failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/api/consensus/signals', async (request, reply) => {
    try {
      const { ticker } = request.query
      if (!ticker) {
        reply.code(400)
        return { success: false, error: 'ticker query param is required' }
      }
      const data = await engineClient.getConsensusSignals(String(ticker))
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get consensus signals failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  // Rankings endpoints
  fastify.get('/rankings/top', async (request, reply) => {
    try {
      const { limit = 20, maxFragility = null } = request.query
      const maxFragilityNum = maxFragility === null || maxFragility === undefined || maxFragility === ''
        ? null
        : Number(maxFragility)

      const raw = await engineClient.getTopRankings(parseInt(limit), maxFragilityNum)
      const data = await enrichRankingsPayload(raw)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get top rankings failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/rankings/movers', async (request, reply) => {
    try {
      const { limit = 50 } = request.query
      const raw = await engineClient.getRankingMovers(parseInt(limit))
      const data = await enrichRankingsPayload(raw)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get ranking movers failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  // Ticker-specific endpoints
  fastify.get('/ticker/:symbol/explainability', async (request, reply) => {
    try {
      const { symbol } = request.params
      const data = await engineClient.getTickerExplainability(symbol)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get ticker explainability failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/ticker/:symbol/performance', async (request, reply) => {
    try {
      const { symbol } = request.params
      const { window = '30d' } = request.query
      const data = await engineClient.getTickerPerformance(symbol, window)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get ticker performance failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  // Admission monitoring
  fastify.get('/admission/changes', async (request, reply) => {
    try {
      const { hours = 24 } = request.query
      const data = await engineClient.getAdmissionChanges(parseInt(hours))
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get admission changes failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  // Combined dashboard data
  fastify.get('/dashboard', async (request, reply) => {
    try {
      const data = await engineClient.getDashboardData()
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get dashboard data failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  // Recommendations endpoints
  fastify.get('/recommendations/latest', async (request, reply) => {
    try {
      const { limit = 10, mode = 'balanced', preference = 'absolute' } = request.query
      const data = await engineClient.getRecommendationsLatest(parseInt(limit), mode, preference)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get latest recommendations failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/recommendations/best', async (request, reply) => {
    try {
      const { mode = 'balanced', preference = 'absolute' } = request.query
      const data = await engineClient.getBestRecommendation(mode, preference)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get best recommendation failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/recommendations/:symbol', async (request, reply) => {
    try {
      const { symbol } = request.params
      const { mode = 'balanced' } = request.query
      const data = await engineClient.getTickerRecommendation(symbol, mode)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get ticker recommendation failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/recommendations/batch', async (request, reply) => {
    try {
      const { tickers, mode = 'balanced' } = request.query
      const data = await engineClient.getBatchRecommendations(tickers, mode)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get batch recommendations failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/recommendations/under/:cap', async (request, reply) => {
    try {
      const { cap } = request.params
      const { mode = 'balanced', limit = 25, preference = null } = request.query
      const data = await engineClient.getRecommendationsUnder(cap, mode, parseInt(limit), preference)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get price-capped recommendations failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  // Active signals for trading
  fastify.get('/signals/active', async (request, reply) => {
    try {
      const signals = await engineClient.getActiveSignals()
      return { success: true, data: signals }
    } catch (error) {
      fastify.log.error('Get active signals failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  // Legacy endpoints for compatibility
  fastify.get('/predictions', async (request, reply) => {
    try {
      const data = await oldEngineClient.getPredictions(request.query)
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get predictions failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/strategies', async (request, reply) => {
    try {
      const data = await oldEngineClient.getStrategies()
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get strategies failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })

  fastify.get('/prices/current', async (request, reply) => {
    try {
      const data = await oldEngineClient.getCurrentPrices()
      return { success: true, data }
    } catch (error) {
      fastify.log.error('Get current prices failed:', error)
      reply.code(500)
      return { success: false, error: error.message }
    }
  })
}
