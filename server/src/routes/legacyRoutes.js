import { oldEngineClient as legacyPricesClient } from '../clients/oldEngine.js'
import { route, softRoute } from './helpers/routeWrapper.js'

export default async function legacyRoutes(fastify, opts) {
  fastify.get('/predictions', route(async (request, reply) => {
    const data = await legacyPricesClient.getPredictions(request.query)
    return { success: true, data }
  }))

  fastify.get('/strategies', route(async (request, reply) => {
    const data = await legacyPricesClient.getStrategies()
    return { success: true, data }
  }))

  fastify.get('/prices/current', softRoute(async (request, reply) => {
    const data = await legacyPricesClient.getCurrentPrices()
    return { success: true, data }
  }))
}
