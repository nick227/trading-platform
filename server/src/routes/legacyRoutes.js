import prisma from '../loaders/prisma.js'
import { softRoute } from './helpers/routeWrapper.js'

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
  fastify.get('/prices/current', softRoute(async (request, reply) => {
    const data = await buildLiveQuotePriceMap()
    return { success: true, data }
  }))
}
