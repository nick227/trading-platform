import { getPublicStrategy, listPublicStrategies } from '../services/strategyEvidenceService.js'
import { getAiPipelineStatus } from '../services/ai/aiPipelineTracker.js'

/** /api/public/strategies — platform strategy evidence, readable without an account. */
export default async function publicStrategyRoutes(app) {
  const cache = (reply) => reply.header('Cache-Control', 'public, max-age=300')
  app.get('/', async (request, reply) => {
    cache(reply)
    return { data: await listPublicStrategies() }
  })
  app.get('/:templateId/pipeline', async (request, reply) => {
    const status = await getAiPipelineStatus({ templateId: String(request.params.templateId) })
    return { data: status }
  })
  app.get('/:templateId', async (request, reply) => {
    const s = await getPublicStrategy(String(request.params.templateId), { versionId: request.query?.version ? String(request.query.version) : null })
    if (!s) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Strategy not found' } })
    cache(reply)
    return { data: s }
  })
}
