import { readPublicStockTraderDashboard } from '../services/ai/stockTraderDashboardService.js'

/** Public read-only platform-owned paper-bot results, never user private data. */
export default async function publicAiStockTraderRoutes(app) {
  app.get('/', async (_request, reply) => {
    try {
      const result = await readPublicStockTraderDashboard()
      reply.header('Cache-Control', 'public, max-age=60')
      return { data: result }
    } catch (error) {
      app.log.error(error, 'Flagship paper dashboard unavailable')
      return reply.code(503).send({ error: { code: 'PAPER_RESEARCH_UNAVAILABLE', message: 'Paper trading data is temporarily unavailable.' } })
    }
  })
}
