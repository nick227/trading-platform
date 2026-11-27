import { executeAiStrategyCycle, getAiDecisionsHistory, getOrCreateCanonicalAiBot } from '../services/ai/aiBotService.js'
import { loadBotFills, calculateFifoAccounting } from '../services/botAccountingService.js'
import { runAiStrategyMarketOpenJob } from '../jobs/aiStrategyMarketOpenJob.js'
import { getAiPipelineStatus } from '../services/ai/aiPipelineTracker.js'
import { evaluatePaperPortfolioIntelligence } from '../services/ai/portfolioIntelligenceService.js'
import { evaluateAiPerformanceIntelligence } from '../services/ai/aiPerformanceIntelligenceService.js'
import {
  PersonalTraderConfigError,
  configurePersonalAiTrader,
  getPersonalAiTraderState,
  runPersonalAiTraderCycle,
  settlePersonalAiTraderPaperOrders
} from '../services/ai/personalAiTraderService.js'
import {
  CopilotProposalError,
  approveCopilotProposal,
  cancelCopilotProposal,
  listUserCopilotProposals
} from '../services/ai/copilotProposalService.js'
import { AI_STOCK_TRADER_PLATFORM_BOT_ID } from '../services/ai/strategies/aiStockTraderStrategy.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireAdmin.js'

/**
 * /api/ai/strategies — Endpoints for autonomous AI strategy execution and inspection.
 */
export default async function aiStrategyRoutes(app) {
  const adminOnly = requireRole(['admin'])

  // GET /api/ai/personal-trader — Authenticated user's Personal AI Trader state, paper portfolio & lifecycle
  app.get('/personal-trader', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const state = await getPersonalAiTraderState(request.user.id)
      return reply.send({ success: true, data: state })
    } catch (err) {
      const status = err instanceof PersonalTraderConfigError ? 400 : 500
      return reply.code(status).send({
        success: false,
        error: { code: err.code || 'PERSONAL_TRADER_LOOKUP_ERROR', message: err.message }
      })
    }
  })

  // PUT /api/ai/personal-trader — Strictly structured Personal AI Trader setup/update (zero freeform text)
  app.put('/personal-trader', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const state = await configurePersonalAiTrader(request.user.id, request.body ?? {})
      return reply.send({ success: true, data: state })
    } catch (err) {
      if (err instanceof PersonalTraderConfigError) {
        return reply.code(400).send({
          success: false,
          error: {
            code: err.code,
            field: err.field || null,
            message: err.message
          }
        })
      }
      return reply.code(500).send({
        success: false,
        error: { code: 'PERSONAL_TRADER_SAVE_ERROR', message: err.message }
      })
    }
  })

  // POST /api/ai/personal-trader/run-cycle — Governed simulated daily cycle for authenticated user
  app.post('/personal-trader/run-cycle', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const data = await runPersonalAiTraderCycle(request.user.id, {
        session: request.body?.session ?? null
      })
      return reply.send({ success: true, data })
    } catch (err) {
      const status = err instanceof PersonalTraderConfigError ? 400 : 500
      return reply.code(status).send({
        success: false,
        error: { code: err.code || 'PERSONAL_TRADER_CYCLE_ERROR', message: err.message }
      })
    }
  })

  // POST /api/ai/personal-trader/settle-paper — Settles due simulated paper fills for authenticated user
  app.post('/personal-trader/settle-paper', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const data = await settlePersonalAiTraderPaperOrders(request.user.id, {
        currentSession: request.body?.session ?? null
      })
      return reply.send({ success: true, data })
    } catch (err) {
      return reply.code(500).send({
        success: false,
        error: { code: 'PERSONAL_TRADER_SETTLE_ERROR', message: err.message }
      })
    }
  })

  // GET /api/ai/copilot-proposals — Reconciles exchange-calendar deadlines and returns user's proposals
  app.get('/copilot-proposals', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const data = await listUserCopilotProposals(request.user.id)
      return reply.send({ success: true, data })
    } catch (err) {
      const status = err instanceof CopilotProposalError ? err.status : 500
      return reply.code(status).send({
        success: false,
        error: { code: err.code || 'COPILOT_PROPOSALS_ERROR', message: err.message }
      })
    }
  })

  // POST /api/ai/copilot-proposals/:id/approve — Explicit approval before NYSE deadline (atomic CAS)
  app.post('/copilot-proposals/:id/approve', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const data = await approveCopilotProposal(request.user.id, request.params.id)
      return reply.send({ success: true, data })
    } catch (err) {
      const status = err instanceof CopilotProposalError ? err.status : 500
      return reply.code(status).send({
        success: false,
        error: { code: err.code || 'COPILOT_APPROVE_ERROR', message: err.message }
      })
    }
  })

  // POST /api/ai/copilot-proposals/:id/cancel — Explicit veto/cancellation before NYSE deadline (atomic CAS)
  app.post('/copilot-proposals/:id/cancel', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const data = await cancelCopilotProposal(request.user.id, request.params.id, {
        reason: request.body?.reason || 'cancelled_by_user'
      })
      return reply.send({ success: true, data })
    } catch (err) {
      const status = err instanceof CopilotProposalError ? err.status : 500
      return reply.code(status).send({
        success: false,
        error: { code: err.code || 'COPILOT_CANCEL_ERROR', message: err.message }
      })
    }
  })

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

  // GET /api/ai/performance-intelligence — Attribution, benchmark comparison & hypothesis validation
  app.get('/performance-intelligence', async (request, reply) => {
    const botId = String(request.query?.botId || AI_STOCK_TRADER_PLATFORM_BOT_ID).trim()
    try {
      const result = await evaluateAiPerformanceIntelligence({ botId })
      return reply.send({ success: true, data: result })
    } catch (err) {
      return reply.code(500).send({
        success: false,
        error: { code: 'AI_PERFORMANCE_INTELLIGENCE_ERROR', message: err.message }
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
