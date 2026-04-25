import { oldEngineClient as legacyPricesClient } from '../clients/oldEngine.js'
import prisma from '../loaders/prisma.js'
import { route, softRoute } from './helpers/routeWrapper.js'

async function buildLiveQuotePriceMap(limit = 200) {
  const rows = await prisma.liveQuote.findMany({
    orderBy: { updatedAt: 'desc' },
    take: limit
  })

  const priceMap = {}
  for (const row of rows) {
    const ticker = String(row.ticker ?? '').toUpperCase()
    if (!ticker || ticker in priceMap) continue
    priceMap[ticker] = {
      price: Number(row.last),
      change: Number(row.changePct ?? 0)
    }
  }

  return priceMap
}

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
    let data
    try {
      data = await legacyPricesClient.getCurrentPrices()
    } catch (error) {
      // Silent fallback to DB - old engine may not be running
      data = await buildLiveQuotePriceMap()
    }
    return { success: true, data }
  }))
}
