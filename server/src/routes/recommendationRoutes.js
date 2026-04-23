import { engineClient } from '../clients/engine.js'
import { route } from './helpers/routeWrapper.js'
import { clampInt } from './helpers/validation.js'

export default async function recommendationRoutes(fastify, opts) {
  fastify.get('/recommendations/latest', route(async (request, reply) => {
    const { limit = 10, mode = 'balanced', preference = 'absolute' } = request.query
    const limitClamped = clampInt(limit, 1, 100, 10)
    const data = await engineClient.getRecommendationsLatest(limitClamped, mode, preference)
    return { success: true, data }
  }))

  fastify.get('/recommendations/best', route(async (request, reply) => {
    const { mode = 'balanced', preference = 'absolute' } = request.query
    const data = await engineClient.getBestRecommendation(mode, preference)
    return { success: true, data }
  }))

  fastify.get('/recommendations/:symbol', route(async (request, reply) => {
    const { symbol } = request.params
    const { mode = 'balanced' } = request.query
    const data = await engineClient.getTickerRecommendation(symbol, mode)
    return { success: true, data }
  }))

  fastify.get('/recommendations/batch', route(async (request, reply) => {
    const { tickers, mode = 'balanced' } = request.query
    const data = await engineClient.getBatchRecommendations(tickers, mode)
    return { success: true, data }
  }))

  fastify.get('/recommendations/under/:cap', route(async (request, reply) => {
    const { cap } = request.params
    const { mode = 'balanced', limit = 25, preference = null } = request.query
    const limitClamped = clampInt(limit, 1, 100, 25)
    const data = await engineClient.getRecommendationsUnder(cap, mode, limitClamped, preference)
    return { success: true, data }
  }))
}
