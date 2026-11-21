import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { engineClient } from '../clients/engine.js'
import executionsService from './executionsService.js'
import operatorConfig from '../../../config/operator.json' with { type: 'json' }

// Resolve (or create) the user's default portfolio.
async function getUserDefaultPortfolioId(userId) {
  if (!userId) {
    throw new Error('userId is required to resolve default portfolio')
  }
  const portfolio = await prisma.portfolio.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' }
  })
  if (portfolio) {
    return portfolio.id
  }
  const created = await prisma.portfolio.create({
    data: {
      id: generateId(ID_PREFIXES.PORTFOLIO),
      userId,
      name: 'Main Portfolio'
    }
  })
  return created.id
}

class BotService {
  constructor() {
    this.currentRun = null
    this.isRunning = false
    this.runInterval = null
    this.activeUserId = null
  }

  async getBotStatus(userId = null) {
    return {
      status: this.isRunning ? 'running' : 'stopped',
      currentRunId: this.currentRun?.id ?? null,
      activeUserId: this.activeUserId,
      lastExecution: userId ? await this.getLastExecution(userId) : null
    }
  }

  async startBot({ userId, portfolioId = null, runIntervalMinutes = null } = {}) {
    if (!userId) {
      throw new Error('userId is required to start bot')
    }

    if (this.isRunning) {
      throw new Error('Bot is already running')
    }

    // Verify user has an active broker account configured
    const broker = await prisma.brokerAccount.findUnique({ where: { userId } })
    if (!broker || broker.status !== 'active' || !broker.apiKey || !broker.apiSecret) {
      const err = new Error('Broker account is not configured or inactive')
      err.code = 'BROKER_NOT_CONFIGURED'
      throw err
    }

    // Resolve and validate portfolio ownership
    const resolvedPortfolioId = portfolioId || await getUserDefaultPortfolioId(userId)
    const portfolio = await prisma.portfolio.findFirst({
      where: { id: resolvedPortfolioId, userId }
    })
    if (!portfolio) {
      const err = new Error('Portfolio not found or unauthorized')
      err.code = 'INVALID_PORTFOLIO'
      throw err
    }

    // BotRun.id is autoincrement Int — do NOT pass an id
    const botRun = await prisma.botRun.create({
      data: {
        userId,
        status:         'running',
        signalCount:    0,
        executionCount: 0,
        totalPnl:       0
      }
    })

    this.currentRun   = botRun
    this.isRunning    = true
    this.activeUserId = userId

    const intervalMin = runIntervalMinutes ?? operatorConfig?.botSettings?.runIntervalMinutes ?? 15

    this.runInterval = setInterval(() => {
      this.executeNextSignal({ userId, portfolioId: resolvedPortfolioId, botRunId: botRun.id }).catch(err =>
        console.error('[BotService] interval execution error:', err.message)
      )
    }, intervalMin * 60 * 1000)

    return botRun
  }

  async stopBot({ userId = null } = {}) {
    if (!this.isRunning) {
      throw new Error('Bot is not running')
    }

    if (userId && this.activeUserId && this.activeUserId !== userId) {
      const err = new Error('Cannot stop bot belonging to another user')
      err.code = 'UNAUTHORIZED'
      throw err
    }

    clearInterval(this.runInterval)
    this.runInterval = null

    if (this.currentRun) {
      await prisma.botRun.update({
        where: { id: this.currentRun.id },
        data:  { status: 'completed', endedAt: new Date() }
      })
    }

    this.isRunning    = false
    const completedRun = this.currentRun
    this.currentRun   = null
    this.activeUserId = null
    return { botRun: completedRun }
  }

  // Execute a single signal through the real worker queue.
  // The worker picks it up and submits to Alpaca — same path as manual trades.
  async executeSignal(signal, { userId, portfolioId = null, botRunId = null } = {}) {
    if (!userId) {
      throw new Error('userId is required for execution')
    }

    const direction = String(signal?.direction ?? '').toLowerCase().trim()
    if (direction !== 'buy' && direction !== 'sell') {
      throw new Error(`Invalid trading direction: "${signal?.direction}". Must be strictly 'buy' or 'sell'.`)
    }

    const resolvedPortfolioId = portfolioId || await getUserDefaultPortfolioId(userId)

    const tradeSize = operatorConfig?.defaultTradeSize ?? 25
    const price     = Number(signal.target) > 0 ? Number(signal.target) : 1
    const quantity  = Math.max(1, Math.floor(tradeSize / price))

    const execution = await executionsService.createExecution({
      userId,
      portfolioId: resolvedPortfolioId,
      ticker:      signal.symbol,
      direction,   // strictly 'buy' or 'sell'
      quantity,
      price,
      signalScore: signal.score ?? null,
      commission:  Math.max(quantity * price * 0.001, 1.95),
      fees:        quantity * price * 0.0005,
      botRunId:    botRunId ?? this.currentRun?.id ?? null,
      origin:      'bot'
    })

    // Update run counters
    if (this.currentRun && this.currentRun.id === botRunId) {
      await prisma.botRun.update({
        where: { id: this.currentRun.id },
        data:  { executionCount: { increment: 1 }, signalCount: { increment: 1 } }
      })
    }

    return execution
  }

  // Called by the periodic interval and by run-once.
  // Priority 1: Never interprets relative_priority rankings as orders.
  // Fails closed on degraded/suppressed intelligence, missing directions, or unauthorized user/broker.
  async executeNextSignal({ userId, portfolioId = null, botRunId = null, minConfidence = null } = {}) {
    if (!userId) {
      return {
        executed: false,
        rejectedReason: 'MISSING_USER_CONTEXT',
        diagnostics: { error: 'userId is required' }
      }
    }

    // Verify broker is configured for this user
    const broker = await prisma.brokerAccount.findUnique({ where: { userId } })
    if (!broker || broker.status !== 'active' || !broker.apiKey || !broker.apiSecret) {
      return {
        executed: false,
        rejectedReason: 'BROKER_NOT_CONFIGURED',
        diagnostics: { userId, message: 'User must configure active broker credentials' }
      }
    }

    // Fetch authoritative recommendations, NOT raw relative_priority rankings
    let recsPayload
    try {
      recsPayload = await engineClient.getRecommendationsLatest(5)
    } catch (err) {
      return {
        executed: false,
        rejectedReason: 'ENGINE_UNAVAILABLE',
        diagnostics: { error: err.message }
      }
    }

    // Check intelligence confidence tier and pipeline gates
    const tier = recsPayload?.intelligenceConfidenceTier
    const pipelineSignals = recsPayload?.pipelineSignals
    const isDegraded = tier === 'degraded' || pipelineSignals?.rankingsSuppressed === true

    if (isDegraded) {
      return {
        executed: false,
        rejectedReason: 'INTELLIGENCE_DEGRADED',
        diagnostics: {
          tier,
          rankingsSuppressed: pipelineSignals?.rankingsSuppressed,
          reasons: pipelineSignals?.suppressionReasons ?? []
        }
      }
    }

    const recs = Array.isArray(recsPayload?.recommendations) ? recsPayload.recommendations : []
    const top = recs[0]

    if (!top) {
      return {
        executed: false,
        rejectedReason: 'NO_RECOMMENDATIONS',
        diagnostics: { returnedCount: recs.length }
      }
    }

    const confidenceThreshold = minConfidence ?? operatorConfig?.minConfidence ?? 0.72
    const recConfidence = Number(top.confidence) || 0
    if (recConfidence < confidenceThreshold) {
      return {
        executed: false,
        rejectedReason: 'CONFIDENCE_BELOW_THRESHOLD',
        diagnostics: {
          confidence: recConfidence,
          threshold: confidenceThreshold,
          ticker: top.ticker
        }
      }
    }

    // Priority 1 requirement: Never default an absent direction to 'buy'
    const rawAction = String(top.action ?? '').toUpperCase().trim()
    if (rawAction !== 'BUY' && rawAction !== 'SELL') {
      return {
        executed: false,
        rejectedReason: 'INVALID_TRADING_DIRECTION',
        diagnostics: {
          action: top.action,
          ticker: top.ticker,
          message: 'Recommendation does not have an explicit BUY or SELL action'
        }
      }
    }

    const direction = rawAction === 'BUY' ? 'buy' : 'sell'
    const targetPrice = Number(top.entryZone?.[0] ?? top.price ?? 0)

    const signal = {
      symbol:     top.ticker,
      direction,
      confidence: recConfidence,
      score:      top.score ?? 0,
      target:     targetPrice
    }

    const execution = await this.executeSignal(signal, {
      userId,
      portfolioId,
      botRunId
    })

    return {
      executed: true,
      execution,
      signal
    }
  }

  async getBotRuns({ userId, limit = 20 } = {}) {
    if (!userId) {
      throw new Error('userId is required to query bot runs')
    }
    return prisma.botRun.findMany({
      where:   { userId },
      orderBy: { startedAt: 'desc' },
      take:    limit,
      include: {
        executions: {
          take:    5,
          orderBy: { createdAt: 'desc' }
        }
      }
    })
  }

  async getLastExecution(userId) {
    if (!userId) return null
    return prisma.execution.findFirst({
      where:   { userId },
      orderBy: { createdAt: 'desc' }
    })
  }
}

export default new BotService()
