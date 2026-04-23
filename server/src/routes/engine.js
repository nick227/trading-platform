import marketRoutes from './marketRoutes.js'
import rankingRoutes from './rankingRoutes.js'
import researchRoutes from './researchRoutes.js'
import recommendationRoutes from './recommendationRoutes.js'
import legacyRoutes from './legacyRoutes.js'

export default async function engineRoutes(fastify, opts) {
  await fastify.register(marketRoutes)
  await fastify.register(rankingRoutes)
  await fastify.register(researchRoutes)
  await fastify.register(recommendationRoutes)
  await fastify.register(legacyRoutes)
}
