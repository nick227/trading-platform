import { randomUUID } from 'node:crypto'
import prisma from '../../loaders/prisma.js'
import { engineClient } from '../../clients/engine.js'
import { getProvider } from './providers/providerRegistry.js'
import { assembleAiResearchContext } from './researchContext.js'
import { buildSystemPrompt, buildUserPrompt, validateAiDecisionOutput, STRATEGY_ID } from './strategies/catalystMomentumStrategy.js'
import { DEFAULT_TRADABLE_SYMBOLS, currentSimSession, simulationConfig } from '../simulationService.js'
import { calculateFillPnl, loadBotFills } from '../botAccountingService.js'

export function nextTradingSession(sessionStr) {
  const d = new Date(`${sessionStr}T00:00:00Z`)
  const day = d.getUTCDay() // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const addDays = day === 5 ? 3 : day === 6 ? 2 : 1
  d.setUTCDate(d.getUTCDate() + addDays)
  return d.toISOString().slice(0, 10)
}

/**
 * Finds or initializes the canonical platform paper bot for the AI strategy.
 */
export async function getOrCreateCanonicalAiBot({ prismaClient = prisma } = {}) {
  // Find or create platform user
  let user = await prismaClient.user.findFirst()
  if (!user) {
    user = await prismaClient.user.create({
      data: {
        id: 'usr_platform_canonical',
        email: 'tradeloom-ai@tradeloom.internal',
        name: 'TradeLoom AI System'
      }
    })
  }

  // Find or create platform portfolio
  let portfolio = await prismaClient.portfolio.findFirst({
    where: { userId: user.id }
  })
  if (!portfolio) {
    portfolio = await prismaClient.portfolio.create({
      data: {
        id: 'port_ai_platform',
        userId: user.id,
        name: 'AI Strategies Paper Portfolio',
        cashBalance: 10_000,
        totalValue: 10_000
      }
    })
  }

  // Find or create bot
  let bot = await prismaClient.bot.findFirst({
    where: {
      templateId: STRATEGY_ID,
      userId: user.id
    }
  })

  if (!bot) {
    bot = await prismaClient.bot.create({
      data: {
        id: 'bot_canonical_ai_catalyst_momentum',
        userId: user.id,
        portfolioId: portfolio.id,
        templateId: STRATEGY_ID,
        botType: 'strategy_based',
        name: 'AI Catalyst & Momentum (Platform Paper)',
        enabled: true,
        config: {
          signalSource: 'ai_catalyst_momentum',
          provider: 'openai',
          model: 'gpt-4o-mini',
          tickers: DEFAULT_TRADABLE_SYMBOLS,
          capitalMode: 'allocated',
          allocatedAmount: 10_000,
          maxOrderNotional: 2_000
        }
      }
    })
  }

  return { bot, user, portfolio }
}

/**
 * Executes a full autonomous AI research & decision cycle.
 * 
 * 1. Assembles point-in-time market, catalyst, and portfolio context.
 * 2. Calls LLM through provider registry.
 * 3. Records complete structured decision audit (including HOLD decisions).
 * 4. Validates and submits eligible orders for next session execution.
 * 
 * @param {object} options
 * @param {string} [options.botId]
 * @param {string} [options.session] Point-in-time session (YYYY-MM-DD)
 * @param {string} [options.providerName] 'openai' | 'mock'
 * @param {boolean} [options.dryRun] If true, records decisions but skips queueing execution
 * @param {object} [options.prismaClient]
 * @param {object} [options.engine]
 */
export async function executeAiStrategyCycle({
  botId = null,
  session = null,
  providerName = 'openai',
  dryRun = false,
  prismaClient = prisma,
  engine = engineClient
} = {}) {
  const { bot, portfolio } = await getOrCreateCanonicalAiBot({ prismaClient })
  const activeBotId = botId ?? bot.id

  // 1. Point-in-Time Context Assembly
  const context = await assembleAiResearchContext({
    botId: activeBotId,
    session,
    engine,
    prismaClient
  })

  const asOfSession = context.asOfSession

  // 2. Format Prompts & Request Decision
  const systemPrompt = buildSystemPrompt()
  const userPrompt = buildUserPrompt(context)

  const provider = getProvider(providerName)
  const llmResponse = await provider.completeStructured({
    systemPrompt,
    userPrompt,
    temperature: 0.2
  })

  // 3. Validate Structured Output
  const sanitized = validateAiDecisionOutput(llmResponse.structured, context)

  // 4. Record Full Decision Audit to BotEvent
  // Records the complete cycle event
  const decisionTimestamp = new Date().toISOString()
  const nextSession = nextTradingSession(asOfSession)
  const summaryDetail = `AI Research Cycle (${asOfSession}): ${sanitized.marketSummary}`.slice(0, 180)
  await prismaClient.botEvent.create({
    data: {
      id: `evt_ai_${randomUUID().slice(0, 16)}`,
      botId: activeBotId,
      portfolioId: portfolio.id,
      type: 'decision_made',
      detail: summaryDetail,
      metadata: {
        strategy: STRATEGY_ID,
        asOfSession,
        decisionTimestamp,
        intendedExecutionSession: nextSession,
        model: llmResponse.model,
        usage: llmResponse.usage,
        provider: providerName,
        marketSummary: sanitized.marketSummary,
        symbolEvaluations: sanitized.symbolEvaluations,
        selectedDecisions: sanitized.selectedDecisions,
        portfolioAtDecision: context.portfolio
      }
    }
  })

  // Also log individual symbol evaluations (HOLD, BUY, SELL)
  for (const ev of sanitized.symbolEvaluations) {
    const eventType = ev.action === 'HOLD' ? 'signal_hold' : 'decision_made'
    const evDetail = `[${ev.action}] ${ev.symbol} (${Math.round(ev.confidence * 100)}%): ${ev.thesis}`.slice(0, 180)
    await prismaClient.botEvent.create({
      data: {
        id: `evt_ai_${randomUUID().slice(0, 16)}`,
        botId: activeBotId,
        portfolioId: portfolio.id,
        type: eventType,
        detail: evDetail,
        metadata: {
          symbol: ev.symbol,
          action: ev.action,
          confidence: ev.confidence,
          exitRule: ev.exitRule,
          evidence: ev.evidence,
          asOfSession,
          decisionTimestamp,
          intendedExecutionSession: nextSession
        }
      }
    })
  }

  // 5. Submit Eligible Executions (Next-session execution, no look-ahead)
  const createdExecutions = []
  const rejectedOrders = []

  if (!dryRun && sanitized.selectedDecisions.length > 0) {
    const availableCash = context.portfolio.cash
    const maxOrderNotional = Number(bot.config?.maxOrderNotional) || 2_000

    let remainingCash = availableCash

    for (const decision of sanitized.selectedDecisions) {
      const symContext = context.symbols.find(s => s.symbol === decision.symbol)
      const currentPrice = symContext?.currentPrice

      if (!currentPrice || currentPrice <= 0) {
        rejectedOrders.push({ symbol: decision.symbol, reason: 'missing_market_price' })
        continue
      }

      if (decision.action === 'BUY') {
        // Size calculation: target allocation or capped at maxOrderNotional
        const targetSpend = Math.min(
          maxOrderNotional,
          decision.targetAllocationPct * (context.portfolio.allocatedCapital || 10_000),
          remainingCash
        )

        const quantity = Math.floor(targetSpend / currentPrice)
        if (quantity < 1) {
          rejectedOrders.push({ symbol: decision.symbol, reason: 'insufficient_cash_for_minimum_share', targetSpend, currentPrice })
          continue
        }

        const notional = quantity * currentPrice
        remainingCash -= notional

        const execId = `exec_ai_${randomUUID().replace(/-/g, '').slice(0, 16)}`
        const clientOrderId = `co_ai_${decision.symbol.toLowerCase()}_${asOfSession.replace(/-/g, '')}_${randomUUID().slice(0, 6)}`

        const execution = await prismaClient.execution.create({
          data: {
            id: execId,
            userId: bot.userId,
            portfolioId: portfolio.id,
            botId: activeBotId,
            ticker: decision.symbol,
            direction: 'buy',
            quantity,
            price: currentPrice, // intent price
            origin: 'bot',
            sourceType: 'ML_SIGNAL',
            sourceId: STRATEGY_ID,
            status: 'queued',
            simSession: nextSession, // fills at next session
            clientOrderId,
            commission: 0,
            fees: 0,
            pnl: 0,
            signalScore: decision.confidence
          }
        })

        createdExecutions.push({
          id: execution.id,
          symbol: decision.symbol,
          direction: 'buy',
          quantity,
          intentPrice: currentPrice,
          targetSession: nextSession,
          thesis: decision.thesis
        })
      } else if (decision.action === 'SELL') {
        const held = context.portfolio.positions.find(p => p.symbol === decision.symbol)
        if (!held || held.quantity <= 0) {
          rejectedOrders.push({ symbol: decision.symbol, reason: 'no_position_to_sell' })
          continue
        }

        const quantity = held.quantity
        const execId = `exec_ai_${randomUUID().replace(/-/g, '').slice(0, 16)}`
        const clientOrderId = `co_ai_${decision.symbol.toLowerCase()}_${asOfSession.replace(/-/g, '')}_${randomUUID().slice(0, 6)}`

        const execution = await prismaClient.execution.create({
          data: {
            id: execId,
            userId: bot.userId,
            portfolioId: portfolio.id,
            botId: activeBotId,
            ticker: decision.symbol,
            direction: 'sell',
            quantity,
            price: currentPrice,
            origin: 'bot',
            sourceType: 'ML_SIGNAL',
            sourceId: STRATEGY_ID,
            status: 'queued',
            simSession: nextSession,
            clientOrderId,
            commission: 0,
            fees: 0,
            pnl: 0,
            signalScore: decision.confidence
          }
        })

        createdExecutions.push({
          id: execution.id,
          symbol: decision.symbol,
          direction: 'sell',
          quantity,
          intentPrice: currentPrice,
          targetSession: nextSession,
          thesis: decision.thesis
        })
      }
    }
  }

  return {
    ok: true,
    botId: activeBotId,
    asOfSession,
    model: llmResponse.model,
    marketSummary: sanitized.marketSummary,
    evaluationsCount: sanitized.symbolEvaluations.length,
    holdCount: sanitized.symbolEvaluations.filter(e => e.action === 'HOLD').length,
    actionableCount: sanitized.selectedDecisions.length,
    evaluations: sanitized.symbolEvaluations,
    createdExecutions,
    rejectedOrders
  }
}

/**
 * Retrieves past AI research decisions and theses for public strategy inspection.
 */
export async function getAiDecisionsHistory(botId, { limit = 20, prismaClient = prisma } = {}) {
  const events = await prismaClient.botEvent.findMany({
    where: {
      botId,
      type: 'decision_made'
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  })

  return events.map(e => ({
    id: e.id,
    createdAt: e.createdAt,
    detail: e.detail,
    metadata: e.metadata
  }))
}

/**
 * Processes queued executions for an AI bot against completed session closes.
 * Fails closed if the target session close is not yet available in market data.
 */
export async function processPendingAiExecutions(botId, {
  currentSession = null,
  prismaClient = prisma,
  engine = engineClient
} = {}) {
  const pending = await prismaClient.execution.findMany({
    where: {
      botId,
      status: 'queued'
    },
    orderBy: { createdAt: 'asc' }
  })

  const filledExecutions = []
  const failedExecutions = []

  for (const exec of pending) {
    const session = exec.simSession || currentSession
    if (!session) continue
    if (currentSession && session > currentSession) {
      // Intended execution session has not completed yet
      continue
    }

    try {
      const closeData = await engine.getSessionClose(exec.ticker, session)
      if (!closeData || !(Number(closeData.close) > 0)) {
        console.warn(`[processPendingAiExecutions] No close data for ${exec.ticker} on ${session}:`, closeData)
        continue // Price unavailable for session
      }

      const fillPrice = Number(closeData.close)
      const fillQty = Number(exec.quantity)
      let pnl = 0

      if (String(exec.direction).toLowerCase() === 'sell') {
        pnl = await calculateFillPnl({
          execution: exec,
          fillPrice,
          fillQty,
          prismaClient
        })
      }

      const brokerOrderId = `sim_${session.replace(/-/g, '')}_${exec.id}`
      const filledAt = new Date()

      await prismaClient.execution.update({
        where: { id: exec.id },
        data: {
          status: 'filled',
          filledPrice: fillPrice,
          filledQuantity: fillQty,
          brokerOrderId,
          brokerStatus: 'filled',
          filledAt,
          pnl
        }
      })

      await prismaClient.executionAudit.create({
        data: {
          id: `aud_${randomUUID()}`,
          executionId: exec.id,
          userId: exec.userId,
          workerId: 'ai_daily_job',
          eventType: 'filled',
          detail: `Simulated fill at ${session} close: ${exec.direction.toUpperCase()} ${fillQty} ${exec.ticker} @ $${fillPrice.toFixed(2)}`,
          metadata: { session, fillPrice, fillQty, pnl }
        }
      })

      filledExecutions.push({
        id: exec.id,
        ticker: exec.ticker,
        direction: exec.direction,
        quantity: fillQty,
        fillPrice,
        session,
        pnl
      })
    } catch (err) {
      console.error('[processPendingAiExecutions] fill error:', err.message)
      failedExecutions.push({ id: exec.id, error: err.message })
    }
  }

  return { filledExecutions, failedExecutions }
}

/**
 * Computes forward portfolio accounting, daily equity curve, and benchmark comparisons
 * for the canonical AI bot based on actual verified paper executions.
 */
export async function computeAiBotForwardEquity(botId, {
  asOfSession = null,
  prismaClient = prisma,
  engine = engineClient
} = {}) {
  const bot = await prismaClient.bot.findUnique({ where: { id: botId } })
  const startingCapital = Number(bot?.config?.allocatedAmount) || 10_000

  const fills = await loadBotFills(botId, { prismaClient })
  if (!fills.length) {
    return {
      status: 'awaiting_sessions',
      startingCapital,
      currentEquity: startingCapital,
      cash: startingCapital,
      realizedPnl: 0,
      unrealizedPnl: 0,
      returnPct: 0,
      trades: 0,
      winRate: null,
      curve: [],
      buyAndHold: { returnPct: 0, curve: [] }
    }
  }

  const firstSession = fills[0].simSession || fills[0].createdAt.toISOString().slice(0, 10)
  let endSession = asOfSession
  if (!endSession) {
    try {
      endSession = await currentSimSession({ engine })
    } catch {
      endSession = fills[fills.length - 1].simSession || new Date().toISOString().slice(0, 10)
    }
  }

  const spyBarsRes = await engine.getDailyBars('SPY', firstSession, endSession).catch(() => ({ bars: [] }))
  const spyBars = Array.isArray(spyBarsRes?.bars) ? spyBarsRes.bars : []
  const sessions = spyBars.map(b => b[0])
  if (!sessions.includes(firstSession)) sessions.unshift(firstSession)
  if (!sessions.includes(endSession)) sessions.push(endSession)
  sessions.sort()

  let cash = startingCapital
  const positionInventory = {} // symbol -> [{ qty, price }]
  const curve = []
  let realizedPnl = 0
  const closedTrades = []

  const fillsBySession = new Map()
  for (const f of fills) {
    const s = f.simSession || f.createdAt.toISOString().slice(0, 10)
    if (!fillsBySession.has(s)) fillsBySession.set(s, [])
    fillsBySession.get(s).push(f)
  }

  const tradedSymbols = [...new Set(fills.map(f => f.ticker))]
  const priceCache = new Map()
  for (const sym of tradedSymbols) {
    const bRes = await engine.getDailyBars(sym, firstSession, endSession).catch(() => ({ bars: [] }))
    for (const b of (bRes?.bars || [])) {
      priceCache.set(`${sym}|${b[0]}`, b[4])
    }
  }

  for (const session of sessions) {
    const sessionFills = fillsBySession.get(session) || []
    for (const f of sessionFills) {
      const price = Number(f.filledPrice || f.price)
      const qty = Number(f.filledQuantity || f.quantity)
      if (f.direction === 'buy') {
        cash -= (qty * price)
        if (!positionInventory[f.ticker]) positionInventory[f.ticker] = []
        positionInventory[f.ticker].push({ qty, price })
      } else if (f.direction === 'sell') {
        cash += (qty * price)
        const tradePnl = Number(f.pnl) || 0
        realizedPnl += tradePnl
        closedTrades.push(tradePnl)

        let rem = qty
        while (rem > 0 && positionInventory[f.ticker]?.length) {
          const lot = positionInventory[f.ticker][0]
          if (lot.qty <= rem) {
            rem -= lot.qty
            positionInventory[f.ticker].shift()
          } else {
            lot.qty -= rem
            rem = 0
          }
        }
      }
    }

    let positionsValue = 0
    let unrealizedPnl = 0
    for (const [sym, lots] of Object.entries(positionInventory)) {
      const totalQty = lots.reduce((a, b) => a + b.qty, 0)
      if (totalQty > 0) {
        const close = priceCache.get(`${sym}|${session}`) || lots[lots.length - 1].price
        const cost = lots.reduce((a, b) => a + (b.qty * b.price), 0)
        const mv = totalQty * close
        positionsValue += mv
        unrealizedPnl += (mv - cost)
      }
    }

    const totalEquity = Math.round((cash + positionsValue) * 100) / 100
    curve.push({
      date: session,
      equity: totalEquity,
      cash: Math.round(cash * 100) / 100,
      positionsValue: Math.round(positionsValue * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100
    })
  }

  const latestEquity = curve.length ? curve[curve.length - 1].equity : startingCapital
  const returnPct = Math.round(((latestEquity - startingCapital) / startingCapital) * 10000) / 100

  const winRate = closedTrades.length
    ? Math.round((closedTrades.filter(p => p > 0).length / closedTrades.length) * 100) / 100
    : null

  let peak = startingCapital
  let maxDd = 0
  for (const pt of curve) {
    if (pt.equity > peak) peak = pt.equity
    const dd = peak > 0 ? ((peak - pt.equity) / peak) * 100 : 0
    if (dd > maxDd) maxDd = dd
  }

  const bhCurve = []
  let bhReturnPct = 0
  if (spyBars.length) {
    const baseSpy = spyBars[0][4]
    for (const b of spyBars) {
      const val = Math.round((startingCapital * (b[4] / baseSpy)) * 100) / 100
      bhCurve.push({ date: b[0], equity: val })
    }
    const finalSpy = spyBars[spyBars.length - 1][4]
    bhReturnPct = Math.round(((finalSpy - baseSpy) / baseSpy) * 10000) / 100
  }

  return {
    status: 'ok',
    startingCapital,
    currentEquity: latestEquity,
    cash: Math.round(cash * 100) / 100,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    trades: fills.length,
    closedTradesCount: closedTrades.length,
    winRate,
    returnPct,
    maxDrawdownPct: Math.round(maxDd * 100) / 100,
    curve,
    buyAndHold: {
      returnPct: bhReturnPct,
      curve: bhCurve
    }
  }
}
