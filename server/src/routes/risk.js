// Risk API Routes
// Premium endpoints exposing risk scoring and decision insights

import { executionConfidenceService } from '../../../worker/src/risk/services/ExecutionConfidenceService.js'
import { portfolioExposureService } from '../../../worker/src/risk/services/PortfolioExposureService.js'
import { drawdownStressService } from '../../../worker/src/risk/services/DrawdownStressService.js'
import { operationalRiskService } from '../../../worker/src/risk/services/OperationalRiskService.js'
import { riskDecisionMatrix } from '../../../worker/src/risk/services/RiskDecisionMatrix.js'
import { botControlService } from '../../../worker/src/risk/services/BotControlService.js'
import prisma from '../loaders/prisma.js'

// Human-readable reason taxonomy
const reasonTaxonomy = {
  'operational_critical': 'System health degraded - trading paused',
  'operational_degraded': 'System health issues - reduced trading',
  'exposure_critical': 'Portfolio too concentrated - only diversifying trades allowed',
  'exposure_warning': 'Portfolio concentration elevated - reduced position sizes',
  'stress_critical': 'Account in recovery mode - minimal trading',
  'stress_warning': 'Recent drawdown - half size maximum',
  'execution_weak': 'Signal confidence too low - trade rejected',
  'execution_moderate': 'Signal confidence moderate - reduced size',
  'all_scores_healthy': 'All risk scores within healthy ranges',
  'single_ticker_limit': 'Position exceeds single ticker concentration limit',
  'evaluation_error': 'Error evaluating trade request',
  'daily_loss_limit': 'Daily loss limit reached',
  'position_size_limit': 'Position size exceeds limit',
  'drawdown_limit': 'Drawdown protection active',
  'concurrent_trades_limit': 'Too many concurrent trades',
  'risk_per_trade_limit': 'Risk per trade exceeds limit'
}

function getHumanReadableReason(reason) {
  return reasonTaxonomy[reason] || reason
}

export default async function riskRoutes(app) {
  // POST /api/risk/size - Smart Position Size API
  app.post('/size', {
    schema: {
      body: {
        type: 'object',
        required: ['portfolioId', 'ticker'],
        properties: {
          portfolioId: { type: 'string' },
          ticker: { type: 'string' },
          signal: {
            type: 'object',
            properties: {
              confidence: { type: 'number' },
              regime: { type: 'string' },
              botId: { type: 'string' }
            }
          },
          maxQuantity: { type: 'number' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { portfolioId, ticker, signal, maxQuantity = 100 } = request.body

      // Get current market data (simplified - in production would fetch real data)
      const marketData = { ticker, price: 100 } // Placeholder

      // Calculate execution confidence
      const confidenceResult = await executionConfidenceService.calculateExecutionConfidence(
        signal || { confidence: 0.7, ticker, regime: 'bull' },
        portfolioId,
        marketData
      )

      // Calculate sizes without fake precision
      const confidenceMultiplier = confidenceResult.score / 100
      const suggestedSize = Math.floor(maxQuantity * confidenceMultiplier)
      const maxSafeSize = Math.floor(maxQuantity * 0.8) // Conservative cap

      return reply.send({
        data: {
          ticker,
          suggestedSize,
          maxSafeSize,
          maxQuantity,
          confidence: confidenceResult.label, // good/moderate/weak
          executionConfidence: {
            score: confidenceResult.score,
            label: confidenceResult.label,
            breakdown: confidenceResult.breakdown
          },
          reasoning: confidenceResult.recommendation
        }
      })
    } catch (error) {
      console.error('Failed to calculate position size:', error)
      return reply.code(500).send({ error: { message: error.message } })
    }
  })

  // GET /api/risk/dashboard - Portfolio Risk Dashboard API
  app.get('/dashboard', {
    schema: {
      querystring: {
        type: 'object',
        required: ['portfolioId'],
        properties: {
          portfolioId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { portfolioId } = request.query

      // Calculate all 4 risk scores in parallel
      const [operational, exposure, stress] = await Promise.all([
        operationalRiskService.calculateOperationalRisk(portfolioId),
        portfolioExposureService.calculatePortfolioExposure(portfolioId),
        drawdownStressService.calculateDrawdownStress(portfolioId)
      ])

      // Calculate overall score
      const overallScore = Math.round((operational.score + exposure.score + stress.score) / 3)

      // Get exposure details
      const exposureDetails = exposure.details
      const topConcentrationRisks = exposureDetails?.positions
        ?.sort((a, b) => b.pct - a.pct)
        ?.slice(0, 3)
        ?.map(p => ({
          ticker: p.ticker,
          concentration: `${(p.pct * 100).toFixed(1)}%`,
          value: p.value
        })) || []

      // Determine trading mode
      const tradingMode = riskDecisionMatrix.getTradingMode(
        operational.score,
        exposure.score,
        stress.score
      )

      // Generate recommended actions
      const actions = []
      if (operational.score < 60) actions.push('Review system health')
      if (exposure.score < 50) actions.push('Diversify positions')
      if (stress.score < 50) actions.push('Reduce position sizes')
      if (actions.length === 0) actions.push('No action needed')

      return reply.send({
        data: {
          portfolioId,
          overallScore,
          overallLabel: overallScore >= 75 ? 'good' : overallScore >= 50 ? 'moderate' : 'weak',
          scores: {
            operational: {
              score: operational.score,
              label: operational.label,
              status: operational.breakdown?.brokerHealth?.status
            },
            exposure: {
              score: exposure.score,
              label: exposure.label,
              topRisks: topConcentrationRisks
            },
            stress: {
              score: stress.score,
              label: stress.label,
              currentDrawdown: stress.details?.drawdown,
              losingStreak: stress.details?.losingStreak
            }
          },
          tradingMode,
          recommendedActions: actions,
          canAutoTrade: operational.score >= 60
        }
      })
    } catch (error) {
      console.error('Failed to get risk dashboard:', error)
      return reply.code(500).send({ error: { message: error.message } })
    }
  })

  // GET /api/risk/decisions/recent - Why Trade Was Blocked API
  app.get('/decisions/recent', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          portfolioId: { type: 'string' },
          limit: { type: 'number', default: 20 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { portfolioId, limit = 20 } = request.query

      // Query recent risk decision events from botEvent table
      const events = await prisma.botEvent.findMany({
        where: {
          ...(portfolioId && { portfolioId }),
          type: { in: ['trade_blocked', 'trade_approved', 'trade_restricted'] }
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          type: true,
          detail: true,
          metadata: true,
          createdAt: true
        }
      })

      const decisions = events.map(event => {
        const metadata = event.metadata || {}
        const rawReason = metadata.reason || event.detail
        return {
          id: event.id,
          type: event.type,
          ticker: metadata.ticker,
          decision: event.type === 'trade_approved' ? 'approved' : 
                   event.type === 'trade_restricted' ? 'restricted' : 'blocked',
          reason: getHumanReadableReason(rawReason),
          failedScore: metadata.failedScore,
          scores: metadata.scores,
          whatWouldApprove: metadata.whatWouldApprove,
          timestamp: event.createdAt
        }
      })

      return reply.send({
        data: {
          decisions,
          count: decisions.length
        }
      })
    } catch (error) {
      console.error('Failed to get recent decisions:', error)
      return reply.code(500).send({ error: { message: error.message } })
    }
  })

  // GET /api/risk/alerts - Current active issues
  app.get('/alerts', {
    schema: {
      querystring: {
        type: 'object',
        required: ['portfolioId'],
        properties: {
          portfolioId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { portfolioId } = request.query

      const alerts = []

      // Check operational health
      const operational = await operationalRiskService.calculateOperationalRisk(portfolioId)
      if (operational.score < 60) {
        alerts.push({
          type: 'operational',
          severity: operational.score < 40 ? 'critical' : 'warning',
          message: operational.score < 40 
            ? 'System health degraded - trading paused' 
            : 'System health issues - reduced trading',
          score: operational.score
        })
      }

      // Check exposure
      const exposure = await portfolioExposureService.calculatePortfolioExposure(portfolioId)
      if (exposure.score < 50) {
        const topRisk = exposure.details?.positions?.[0]
        alerts.push({
          type: 'exposure',
          severity: exposure.score < 35 ? 'critical' : 'warning',
          message: topRisk 
            ? `${topRisk.ticker} concentration elevated at ${(topRisk.pct * 100).toFixed(1)}%`
            : 'Portfolio concentration elevated',
          score: exposure.score
        })
      }

      // Check drawdown stress
      const stress = await drawdownStressService.calculateDrawdownStress(portfolioId)
      if (stress.score < 50) {
        alerts.push({
          type: 'stress',
          severity: stress.score < 40 ? 'critical' : 'warning',
          message: stress.score < 40 
            ? 'Account in recovery mode - minimal trading' 
            : 'Recent drawdown - half size maximum',
          score: stress.score,
          details: {
            drawdown: stress.details?.drawdown,
            losingStreak: stress.details?.losingStreak
          }
        })
      }

      // Check bot status
      const botStatus = await prisma.bot.findMany({
        where: { portfolioId },
        select: { status: true, riskMode: true }
      })

      const throttledBots = botStatus.filter(b => b.riskMode === 'throttled').length
      if (throttledBots > 0) {
        alerts.push({
          type: 'bot_status',
          severity: 'warning',
          message: `${throttledBots} bot(s) throttled due to risk controls`
        })
      }

      const pausedBots = botStatus.filter(b => b.status === 'paused_risk').length
      if (pausedBots > 0) {
        alerts.push({
          type: 'bot_status',
          severity: 'warning',
          message: `${pausedBots} bot(s) paused by risk management`
        })
      }

      return reply.send({
        data: {
          portfolioId,
          alerts,
          count: alerts.length,
          hasCriticalAlerts: alerts.some(a => a.severity === 'critical')
        }
      })
    } catch (error) {
      console.error('Failed to get risk alerts:', error)
      return reply.code(500).send({ error: { message: error.message } })
    }
  })

  // GET /api/risk/history - 7d/30d risk history charts
  app.get('/history', {
    schema: {
      querystring: {
        type: 'object',
        required: ['portfolioId'],
        properties: {
          portfolioId: { type: 'string' },
          days: { type: 'number', default: 7 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { portfolioId, days = 7 } = request.query
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

      // Query risk-related events from botEvent table
      const riskEvents = await prisma.botEvent.findMany({
        where: {
          portfolioId,
          createdAt: { gte: startDate },
          type: { in: ['bots_paused', 'bots_throttled', 'trading_restored', 'drawdown_protection'] }
        },
        orderBy: { createdAt: 'asc' },
        select: {
          type: true,
          detail: true,
          metadata: true,
          createdAt: true
        }
      })

      // Query trade history for drawdown calculation
      const trades = await prisma.trade.findMany({
        where: {
          portfolioId,
          createdAt: { gte: startDate },
          status: 'filled'
        },
        orderBy: { createdAt: 'asc' },
        select: {
          pnl: true,
          createdAt: true
        }
      })

      // Calculate daily equity curve from trades
      const dailyData = new Map()
      let runningPnl = 0
      trades.forEach(trade => {
        runningPnl += trade.pnl
        const dateKey = trade.createdAt.toISOString().split('T')[0]
        dailyData.set(dateKey, runningPnl)
      })

      // Build time series data
      const timeSeries = []
      const now = new Date()
      for (let i = days; i >= 0; i--) {
        const date = new Date(now - i * 24 * 60 * 60 * 1000)
        const dateKey = date.toISOString().split('T')[0]
        const dayEvents = riskEvents.filter(e => e.createdAt.toISOString().split('T')[0] === dateKey)
        
        timeSeries.push({
          date: dateKey,
          pnl: dailyData.get(dateKey) || 0,
          events: dayEvents.map(e => ({
            type: e.type,
            detail: e.detail
          }))
        })
      }

      // Calculate current scores
      const [operational, exposure, stress] = await Promise.all([
        operationalRiskService.calculateOperationalRisk(portfolioId),
        portfolioExposureService.calculatePortfolioExposure(portfolioId),
        drawdownStressService.calculateDrawdownStress(portfolioId)
      ])

      return reply.send({
        data: {
          portfolioId,
          period: `${days} days`,
          timeSeries,
          currentScores: {
            operational: operational.score,
            exposure: exposure.score,
            stress: stress.score
          },
          summary: {
            totalEvents: riskEvents.length,
            totalTrades: trades.length,
            netPnl: runningPnl
          }
        }
      })
    } catch (error) {
      console.error('Failed to get risk history:', error)
      return reply.code(500).send({ error: { message: error.message } })
    }
  })

  // POST /api/risk/pause-bots - Pause all bots in portfolio
  app.post('/pause-bots', {
    schema: {
      body: {
        type: 'object',
        required: ['portfolioId', 'reason'],
        properties: {
          portfolioId: { type: 'string' },
          reason: { type: 'string' },
          actor: { type: 'string', enum: ['user', 'admin', 'system', 'scheduled'], default: 'user' },
          idempotencyKey: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { portfolioId, reason, actor = 'user', idempotencyKey } = request.body

      // Check idempotency if key provided
      if (idempotencyKey) {
        const existing = await prisma.botEvent.findFirst({
          where: {
            portfolioId,
            type: 'bots_paused',
            metadata: { path: ['idempotencyKey'], equals: idempotencyKey }
          }
        })
        if (existing) {
          return reply.send({
            data: {
              success: true,
              action: 'skipped',
              message: 'Request already processed',
              eventId: existing.id
            }
          })
        }
      }

      const result = await botControlService.pauseAllBots(portfolioId, reason, { idempotencyKey }, actor)

      return reply.send({ data: result })
    } catch (error) {
      console.error('Failed to pause bots:', error)
      return reply.code(500).send({ error: { message: error.message } })
    }
  })

  // POST /api/risk/resume-bots - Resume all bots in portfolio
  app.post('/resume-bots', {
    schema: {
      body: {
        type: 'object',
        required: ['portfolioId'],
        properties: {
          portfolioId: { type: 'string' },
          actor: { type: 'string', enum: ['user', 'admin', 'system', 'scheduled'], default: 'user' },
          idempotencyKey: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { portfolioId, actor = 'user', idempotencyKey } = request.body

      // Check idempotency if key provided
      if (idempotencyKey) {
        const existing = await prisma.botEvent.findFirst({
          where: {
            portfolioId,
            type: 'trading_restored',
            metadata: { path: ['idempotencyKey'], equals: idempotencyKey }
          }
        })
        if (existing) {
          return reply.send({
            data: {
              success: true,
              action: 'skipped',
              message: 'Request already processed',
              eventId: existing.id
            }
          })
        }
      }

      const result = await botControlService.restoreNormalTrading(portfolioId, 'resume_bots', { idempotencyKey }, actor)

      return reply.send({ data: result })
    } catch (error) {
      console.error('Failed to resume bots:', error)
      return reply.code(500).send({ error: { message: error.message } })
    }
  })

  // POST /api/risk/throttle-bots - Throttle all bots in portfolio
  app.post('/throttle-bots', {
    schema: {
      body: {
        type: 'object',
        required: ['portfolioId', 'reason'],
        properties: {
          portfolioId: { type: 'string' },
          reason: { type: 'string' },
          duration: { type: 'number' }, // minutes
          actor: { type: 'string', enum: ['user', 'admin', 'system', 'scheduled'], default: 'user' },
          idempotencyKey: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { portfolioId, reason, duration, actor = 'user', idempotencyKey } = request.body

      // Check idempotency if key provided
      if (idempotencyKey) {
        const existing = await prisma.botEvent.findFirst({
          where: {
            portfolioId,
            type: 'bots_throttled',
            metadata: { path: ['idempotencyKey'], equals: idempotencyKey }
          }
        })
        if (existing) {
          return reply.send({
            data: {
              success: true,
              action: 'skipped',
              message: 'Request already processed',
              eventId: existing.id
            }
          })
        }
      }

      const result = await botControlService.throttleBots(portfolioId, reason, { idempotencyKey, duration }, actor)

      return reply.send({ data: result })
    } catch (error) {
      console.error('Failed to throttle bots:', error)
      return reply.code(500).send({ error: { message: error.message } })
    }
  })

  // POST /api/risk/kill-switch - Emergency stop all trading
  app.post('/kill-switch', {
    schema: {
      body: {
        type: 'object',
        required: ['portfolioId', 'reason'],
        properties: {
          portfolioId: { type: 'string' },
          reason: { type: 'string' },
          actor: { type: 'string', enum: ['user', 'admin', 'system'], default: 'user' },
          idempotencyKey: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { portfolioId, reason, actor = 'user', idempotencyKey } = request.body

      // Check idempotency if key provided
      if (idempotencyKey) {
        const existing = await prisma.botEvent.findFirst({
          where: {
            portfolioId,
            type: 'bots_paused',
            metadata: { path: ['idempotencyKey'], equals: idempotencyKey }
          }
        })
        if (existing) {
          return reply.send({
            data: {
              success: true,
              action: 'skipped',
              message: 'Kill switch already activated',
              eventId: existing.id
            }
          })
        }
      }

      // Kill switch = pause all bots with admin actor override
      const result = await botControlService.pauseAllBots(portfolioId, `KILL_SWITCH: ${reason}`, { idempotencyKey, killSwitch: true }, 'admin')

      return reply.send({ data: result })
    } catch (error) {
      console.error('Failed to activate kill switch:', error)
      return reply.code(500).send({ error: { message: error.message } })
    }
  })
}
