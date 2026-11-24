import { randomUUID } from 'node:crypto'
import prisma from '../../loaders/prisma.js'
import { engineClient } from '../../clients/engine.js'
import { getProvider } from './providers/providerRegistry.js'
import { assembleAiResearchContext } from './researchContext.js'
import { buildSystemPrompt, buildUserPrompt, validateAiDecisionOutput, STRATEGY_ID } from './strategies/catalystMomentumStrategy.js'
import { DEFAULT_TRADABLE_SYMBOLS, simulationConfig } from '../simulationService.js'

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
          asOfSession
        }
      }
    })
  }

  // 5. Submit Eligible Executions (Next-session execution, no look-ahead)
  const createdExecutions = []
  const rejectedOrders = []

  if (!dryRun && sanitized.selectedDecisions.length > 0) {
    const nextSession = nextTradingSession(asOfSession)
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
