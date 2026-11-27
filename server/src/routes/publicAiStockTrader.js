import { readPublicStockTraderDashboard } from '../services/ai/stockTraderDashboardService.js'
import { discoverAutonomousOpportunities } from '../services/ai/stockDiscoveryService.js'
import { evaluatePaperPortfolioIntelligence } from '../services/ai/portfolioIntelligenceService.js'

/** Public, read-only flagship AI Stock Trader endpoints. Never triggers LLM calls or orders. */
export default async function publicAiStockTraderRoutes(app) {
  app.get('/', async (_request, reply) => {
    try {
      const result = await readPublicStockTraderDashboard()
      let discovery = null
      let portfolioIntelligence = null
      if (result.status !== 'not_initialized') {
        ;[discovery, portfolioIntelligence] = await Promise.all([
          discoverAutonomousOpportunities({ limit: 12 }).catch(() => null),
          evaluatePaperPortfolioIntelligence().catch(() => null)
        ])
      }
      reply.header('Cache-Control', 'public, max-age=60')
      return { data: { ...result, discovery, portfolioIntelligence } }
    } catch (error) {
      app.log.error(error, 'Flagship paper dashboard unavailable')
      return reply.code(503).send({ error: { code: 'PAPER_RESEARCH_UNAVAILABLE', message: 'Paper trading data is temporarily unavailable.' } })
    }
  })

  app.get('/discovery', async (request, reply) => {
    try {
      const { sector, theme, beyondWatchlist, limit } = request.query || {}
      const result = await discoverAutonomousOpportunities({
        sector: sector || null,
        theme: theme || null,
        beyondWatchlistOnly: beyondWatchlist === 'true' || beyondWatchlist === '1',
        limit: limit ? Number(limit) : 24
      })
      reply.header('Cache-Control', 'public, max-age=60')
      return { data: result }
    } catch (error) {
      app.log.error(error, 'Autonomous stock discovery unavailable')
      return reply.code(503).send({ error: { code: 'STOCK_DISCOVERY_UNAVAILABLE', message: 'Stock discovery scan is temporarily unavailable.' } })
    }
  })

  app.get('/portfolio-intelligence', async (_request, reply) => {
    try {
      const result = await evaluatePaperPortfolioIntelligence()
      reply.header('Cache-Control', 'public, max-age=60')
      return { data: result }
    } catch (error) {
      app.log.error(error, 'Flagship portfolio intelligence unavailable')
      return reply.code(503).send({ error: { code: 'PORTFOLIO_INTELLIGENCE_UNAVAILABLE', message: 'Portfolio intelligence is temporarily unavailable.' } })
    }
  })
}
