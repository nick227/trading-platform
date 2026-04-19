import { engineClient } from '../clients/engine.js'
import { oldEngineClient } from '../clients/oldEngine.js'

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

  // Rankings endpoints
  fastify.get('/rankings/top', async (request, reply) => {
    try {
      const { limit = 20 } = request.query
      const data = await engineClient.getTopRankings(parseInt(limit))
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
      const data = await engineClient.getRankingMovers(parseInt(limit))
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
