import { engineClient } from '../clients/engine.js'
import { route } from './helpers/routeWrapper.js'

export default async function researchRoutes(fastify, opts) {
  fastify.get('/api/ticker/:symbol/accuracy', route(async (request, reply) => {
    const { symbol } = request.params
    const data = await engineClient.getTickerAccuracy(symbol)
    return { success: true, data }
  }))

  fastify.get('/api/ticker/:symbol/attribution', route(async (request, reply) => {
    const { symbol } = request.params
    const data = await engineClient.getTickerAttribution(symbol)
    return { success: true, data }
  }))

  fastify.get('/api/consensus/signals', route(async (request, reply) => {
    const { ticker } = request.query
    if (!ticker) {
      reply.code(400)
      return { success: false, error: 'ticker query param is required' }
    }
    const data = await engineClient.getConsensusSignals(String(ticker))
    return { success: true, data }
  }))
}
