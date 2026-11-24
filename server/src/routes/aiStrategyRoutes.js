import { executeAiStrategyCycle, getAiDecisionsHistory, getOrCreateCanonicalAiBot } from '../services/ai/aiBotService.js'
import { loadBotFills, calculateFifoAccounting } from '../services/botAccountingService.js'

/**
 * /api/ai/strategies — Endpoints for autonomous AI strategy execution and inspection.
 */
export default async function aiStrategyRoutes(app) {
  // POST /api/ai/strategies/:templateId/run — Triggers autonomous daily research & decision cycle
  app.post('/strategies/:templateId/run', async (request, reply) => {
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
}
