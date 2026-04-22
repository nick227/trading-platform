import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { engineClient } from '../clients/engine.js'
import executionsService from './executionsService.js'
import { STUB_USER_ID } from '../utils/auth.js'
import operatorConfig from '../../../config/operator.json' with { type: 'json' }

// Resolve (or create) the operator's default portfolio once per process.
let _defaultPortfolioId = null
async function getDefaultPortfolioId() {
  if (_defaultPortfolioId) return _defaultPortfolioId
  const portfolio = await prisma.portfolio.findFirst({
    where: { userId: STUB_USER_ID },
    orderBy: { createdAt: 'asc' }
  })
  if (portfolio) {
    _defaultPortfolioId = portfolio.id
    return _defaultPortfolioId
  }
  const created = await prisma.portfolio.create({
    data: {
      id: generateId(ID_PREFIXES.PORTFOLIO),
      userId: STUB_USER_ID,
      name: 'Main Portfolio'
    }
  })
  _defaultPortfolioId = created.id
  return _defaultPortfolioId
}

class BotService {
  constructor() {
    this.currentRun = null
    this.isRunning = false
    this.runInterval = null
  }

  async getBotStatus() {
    return {
      status: this.isRunning ? 'running' : 'stopped',
      currentRunId: this.currentRun?.id ?? null,
      lastExecution: await this.getLastExecution()
    }
  }

  async startBot() {
    if (this.isRunning) {
      throw new Error('Bot is already running')
    }

    // BotRun.id is autoincrement Int — do NOT pass an id
    const botRun = await prisma.botRun.create({
      data: {
        userId:         STUB_USER_ID,
        status:         'running',
        signalCount:    0,
        executionCount: 0,
        totalPnl:       0
      }
    })

    this.currentRun = botRun
    this.isRunning  = true

    const intervalMinutes = operatorConfig?.botSettings?.runIntervalMinutes ?? 15

    this.runInterval = setInterval(() => {
      this.executeNextSignal().catch(err =>
        console.error('[BotService] interval execution error:', err.message)
      )
    }, intervalMinutes * 60 * 1000)

    return botRun
  }

  async stopBot() {
    if (!this.isRunning) {
      throw new Error('Bot is not running')
    }

    clearInterval(this.runInterval)
    this.runInterval = null

    if (this.currentRun) {
      await prisma.botRun.update({
        where: { id: this.currentRun.id },
        data:  { status: 'completed', endedAt: new Date() }
      })
    }

    this.isRunning = false
    const completedRun = this.currentRun
    this.currentRun = null
    return { botRun: completedRun }
  }

  // Execute a single signal through the real worker queue.
  // The worker picks it up and submits to Alpaca — same path as manual trades.
  async executeSignal(signal) {
    const portfolioId = await getDefaultPortfolioId()

    const tradeSize = operatorConfig?.defaultTradeSize ?? 25
    const price     = signal.target > 0 ? signal.target : 1
    const quantity  = Math.max(1, Math.floor(tradeSize / price))

    const execution = await executionsService.createExecution({
      userId:      STUB_USER_ID,
      portfolioId,
      ticker:      signal.symbol,
      direction:   signal.direction.toLowerCase(), // schema requires 'buy' | 'sell'
      quantity,
      price,
      signalScore: signal.score ?? null,
      commission:  Math.max(quantity * price * 0.001, 1.95),
      fees:        quantity * price * 0.0005,
      botRunId:    this.currentRun?.id ?? null,
      origin:      'bot'
    })

    // Update run counters
    if (this.currentRun) {
      await prisma.botRun.update({
        where: { id: this.currentRun.id },
        data:  { executionCount: { increment: 1 }, signalCount: { increment: 1 } }
      })
    }

    return execution
  }

  // Called by the periodic interval and by run-once.
  async executeNextSignal() {
    const minConfidence  = operatorConfig?.minConfidence ?? 0.72

    const rankings = await engineClient.getTopRankings(1)
    const top = rankings?.rankings?.[0]

    if (!top) {
      console.log('[BotService] No rankings available')
      return null
    }

    if ((top.confidence ?? 0) < minConfidence) {
      console.log(`[BotService] Signal confidence ${top.confidence} below threshold ${minConfidence}`)
      return null
    }

    const signal = {
      symbol:     top.symbol,
      direction:  top.direction ?? 'buy',
      confidence: top.confidence ?? 0,
      score:      top.score ?? 0,
      target:     top.price ?? 0
    }

    const execution = await this.executeSignal(signal)
    console.log(`[BotService] Queued execution: ${signal.symbol} ${signal.direction} @ ${signal.target}`)
    return execution
  }

  async getBotRuns({ limit = 20 } = {}) {
    return prisma.botRun.findMany({
      where:   { userId: STUB_USER_ID },
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

  async getLastExecution() {
    return prisma.execution.findFirst({
      where:   { userId: STUB_USER_ID },
      orderBy: { createdAt: 'desc' }
    })
  }
}

export default new BotService()
