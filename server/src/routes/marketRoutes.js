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

  fastify.get('/ticker/:symbol/explainability', route(async (request, reply) => {
    const { symbol } = request.params
    const data = await engineClient.getTickerExplainability(symbol)
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

  fastify.get('/signals/active', route(async (request, reply) => {
    const signals = await engineClient.getActiveSignals()
    return { success: true, data: signals }
  }))
}
