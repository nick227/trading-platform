import { getPublicStrategy, listPublicStrategies } from '../services/strategyEvidenceService.js'
import { buildCrossStrategyLeaderboard } from '../services/strategyLeaderboardService.js'
import { getAiPipelineStatus } from '../services/ai/aiPipelineTracker.js'

/** /api/public/strategies — platform strategy evidence & cross-strategy leaderboards, readable without an account. */
export default async function publicStrategyRoutes(app) {
  const cache = (reply, seconds = 300) => reply.header('Cache-Control', `public, max-age=${seconds}`)

  app.get('/', async (_request, reply) => {
    cache(reply)
    return { data: await listPublicStrategies() }
  })

  app.get('/leaderboard', async (request, reply) => {
    const { track, category, sortBy } = request.query || {}
    const board = await buildCrossStrategyLeaderboard({
      track: track ? String(track) : 'overview',
      category: category ? String(category) : 'all',
      sortBy: sortBy ? String(sortBy) : 'risk_adjusted'
    })
    cache(reply, 60)
    return { data: board }
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
