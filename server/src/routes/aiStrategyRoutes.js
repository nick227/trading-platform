import { executeAiStrategyCycle, getAiDecisionsHistory, getOrCreateCanonicalAiBot } from '../services/ai/aiBotService.js'
import { loadBotFills, calculateFifoAccounting } from '../services/botAccountingService.js'
import { runAiStrategyMarketOpenJob } from '../jobs/aiStrategyMarketOpenJob.js'
import { getAiPipelineStatus } from '../services/ai/aiPipelineTracker.js'
import { evaluatePaperPortfolioIntelligence } from '../services/ai/portfolioIntelligenceService.js'
import { AI_STOCK_TRADER_PLATFORM_BOT_ID } from '../services/ai/strategies/aiStockTraderStrategy.js'
import { requireRole } from '../middleware/requireAdmin.js'

/**
 * /api/ai/strategies — Endpoints for autonomous AI strategy execution and inspection.
 */
export default async function aiStrategyRoutes(app) {
  const adminOnly = requireRole(['admin'])

  // GET /api/ai/portfolio-intelligence — Evaluate holdings, concentration & rebalance proposals for a paper bot
  app.get('/portfolio-intelligence', async (request, reply) => {
    const botId = String(request.query?.botId || AI_STOCK_TRADER_PLATFORM_BOT_ID).trim()
    try {
      const result = await evaluatePaperPortfolioIntelligence({ botId })
      return reply.send({ success: true, data: result })
    } catch (err) {
      return reply.code(500).send({
        success: false,
        error: { code: 'AI_PORTFOLIO_INTELLIGENCE_ERROR', message: err.message }
      })
    }
  })

  // POST /api/ai/strategies/:templateId/run — Triggers autonomous daily research & decision cycle
  app.post('/strategies/:templateId/run', { preHandler: [adminOnly] }, async (request, reply) => {
    const { templateId } = request.params
    const { session, provider = 'openai', dryRun = false } = request.body || {}

    try {
      const result = await executeAiStrategyCycle({
        templateId,
        session: session ?? null,
        providerName: provider,
        dryRun: Boolean(dryRun)
      })

      return reply.send({
        success: true,
        data: result
      })
    } catch (err) {
      app.log.error(err, 'Failed to execute AI strategy cycle')
      return reply.code(500).send({
        success: false,
        error: {
          code: 'AI_CYCLE_ERROR',
          message: err.message
        }
      })
    }
  })

  // GET /api/ai/strategies/:templateId/decisions — Inspect past AI decisions and full thesis
  app.get('/strategies/:templateId/decisions', async (request, reply) => {
    const { templateId } = request.params
    const limit = Math.min(100, Math.max(1, Number(request.query?.limit) || 20))

    try {
      const { bot } = await getOrCreateCanonicalAiBot()
      const decisions = await getAiDecisionsHistory(bot.id, { limit })

      return reply.send({
        success: true,
        data: {
          templateId,
          botId: bot.id,
          decisions
        }
      })
    } catch (err) {
      return reply.code(500).send({
        success: false,
        error: {
          code: 'AI_DECISIONS_LOOKUP_ERROR',
          message: err.message
        }
      })
    }
  })

  // GET /api/ai/strategies/:templateId/status — Live paper portfolio status of the AI strategy
  app.get('/strategies/:templateId/status', async (request, reply) => {
    const { templateId } = request.params

    try {
      const { bot, portfolio } = await getOrCreateCanonicalAiBot()
      const fills = await loadBotFills(bot.id)
      const accounting = calculateFifoAccounting(fills)

      return reply.send({
        success: true,
        data: {
          templateId,
          botId: bot.id,
          name: bot.name,
          enabled: bot.enabled,
          portfolioId: portfolio.id,
          capitalAllocated: Number(bot.config?.allocatedAmount) || 10_000,
          maxOrderNotional: Number(bot.config?.maxOrderNotional) || 2_000,
          positions: accounting.positions || {},
          realizedPnl: accounting.realizedPnl || 0,
          fillsCount: fills.length
        }
      })
    } catch (err) {
      return reply.code(500).send({
        success: false,
        error: {
          code: 'AI_STATUS_LOOKUP_ERROR',
          message: err.message
        }
      })
    }
  })

  // POST /api/ai/strategies/:templateId/market-open — Executes pending next_open orders at market open
  app.post('/strategies/:templateId/market-open', { preHandler: [adminOnly] }, async (request, reply) => {
    const { templateId } = request.params

    try {
      const result = await runAiStrategyMarketOpenJob({ templateId })
      return reply.send({
        success: true,
        data: result
      })
    } catch (err) {
      return reply.code(500).send({
        success: false,
        error: {
          code: 'AI_MARKET_OPEN_ERROR',
          message: err.message
        }
      })
    }
  })

  // GET /api/ai/strategies/:templateId/pipeline — Full 5-stage pipeline monitoring status
  app.get('/strategies/:templateId/pipeline', async (request, reply) => {
    const { templateId } = request.params

    try {
      const status = await getAiPipelineStatus({ templateId })
      return reply.send({
        success: true,
        data: status
      })
    } catch (err) {
      return reply.code(500).send({
        success: false,
        error: {
          code: 'AI_PIPELINE_STATUS_ERROR',
          message: err.message
        }
      })
    }
  })
}
