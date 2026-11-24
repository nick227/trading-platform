import { getPublicStrategy, listPublicStrategies } from '../services/strategyEvidenceService.js'

/** /api/public/strategies — platform strategy evidence, readable without an account. */
export default async function publicStrategyRoutes(app) {
  const cache = (reply) => reply.header('Cache-Control', 'public, max-age=300')
  app.get('/', async (request, reply) => {
    cache(reply)
    return { data: await listPublicStrategies() }
  })
  app.get('/:templateId', async (request, reply) => {
    const s = await getPublicStrategy(String(request.params.templateId))
    if (!s) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Strategy not found' } })
    cache(reply)
    return { data: s }
  })
}
