/**
 * Flagship paper-only execution boundary. LLM decisions never reach a broker.
 * All accepted intents are verified, persisted and reconciled by SimulatedBroker.
 */
import { randomUUID } from 'node:crypto'
import prisma from '../../loaders/prisma.js'
import { evaluateRiskCaps } from '../../../../worker/src/risk/riskCaps.js'
import { readEmergencyStop } from '../emergencyStopService.js'
import { nextTradingSession } from './aiBotService.js'
import { AI_STOCK_TRADER_STRATEGY_ID } from './strategies/aiStockTraderStrategy.js'

export async function queueStockTraderPaperOrders({
  bot,
  portfolio,
  research,
  screening,
  portfolioSnapshot,
  prismaClient = prisma,
  riskEvaluator = evaluateRiskCaps
}) {
  if (!bot?.enabled || bot.config?.mode !== 'paper' ||
      bot.templateId !== AI_STOCK_TRADER_STRATEGY_ID ||
      portfolio?.id !== bot.portfolioId || portfolio.userId !== bot.userId) {
    throw new Error('Flagship paper bot identity or execution mode invalid')
  }
  if (!research?.ok || !research.decision || !research.eventId ||
      research.decision.asOfSession !== screening?.asOfSession ||
      portfolioSnapshot?.asOfSession !== screening.asOfSession) {
    throw new Error('Validated same-session research and portfolio required')
  }

  const user = await prismaClient.user.findUnique({ where: { id: bot.userId }, select: { riskSettings: true } })
  if (!user || readEmergencyStop(user.riskSettings).active) {
    return { queued: [], rejected: research.decision.actionable.map(x => ({ symbol: x.symbol, reason: 'emergency_stop_or_missing_account' })) }
  }

  const limits = bot.config.execution
  const maxOrders = Math.min(2, Number(limits.maxOrdersPerCycle))
  const maxAllocation = Math.min(0.20, Number(limits.maxPositionPct))
  const maxOrderNotional = Math.min(2000, Number(limits.maxOrderNotional))
  if (!Number.isInteger(maxOrders) || maxOrders < 1 ||
      !Number.isFinite(maxAllocation) || maxAllocation <= 0 ||
      !Number.isFinite(maxOrderNotional) || maxOrderNotional <= 0) {
    throw new Error('Invalid flagship execution limits')
  }
  const capital = Number(bot.config.allocatedAmount)
  const cash = Number(portfolioSnapshot.cash)
  if (!Number.isFinite(capital) || capital <= 0 || !Number.isFinite(cash) || cash < 0 ||
      !Array.isArray(portfolioSnapshot.positions)) {
    throw new Error('Invalid paper portfolio accounting')
  }

  // Reserve cash tied up in previous queued BUYs across sessions.
  const outstanding = await prismaClient.execution.findMany({
    where: { botId: bot.id, direction: 'buy', status: 'queued' },
    select: { quantity: true, price: true }
  })
  const committedCash = outstanding.reduce((total, e) => total + Number(e.quantity) * Number(e.price), 0)
  let remainingCash = Math.max(0, cash - committedCash)
  const queued = []
  const rejected = []
  const shortlist = new Map(screening.shortlist.map(row => [row.symbol, row]))
  const held = new Map(portfolioSnapshot.positions.map(p => [p.symbol, p]))

  for (const intent of research.decision.actionable.slice(0, maxOrders)) {
    if (!['BUY', 'SELL'].includes(intent.action) ||
        !Number.isFinite(intent.confidence) || intent.confidence < 0 || intent.confidence > 1 ||
        (intent.action === 'BUY' && (intent.confidence < 0.65 ||
          !Number.isFinite(intent.targetAllocationPct) || intent.targetAllocationPct <= 0 ||
          intent.targetAllocationPct > maxAllocation))) {
      rejected.push({ symbol: intent.symbol, reason: 'invalid_or_low_confidence_proposal' })
      continue
    }
    const candidate = shortlist.get(intent.symbol)
    const price = Number(candidate?.indicators?.price)
    if (!Number.isFinite(price) || price <= 0) {
      rejected.push({ symbol: intent.symbol, reason: 'missing_market_price' })
      continue
    }
    if (intent.action === 'BUY' && (!candidate.eligible || !candidate.inUniverse)) {
      rejected.push({ symbol: intent.symbol, reason: 'ineligible_buy' })
      continue
    }
    if (intent.action === 'SELL' && !(Number(held.get(intent.symbol)?.quantity) > 0)) {
      rejected.push({ symbol: intent.symbol, reason: 'unheld_sell' })
      continue
    }

    const currentPositionValue = Number(held.get(intent.symbol)?.marketValue || 0)
    const maxPositionValue = capital * maxAllocation
    const allowedNewNotional = Math.max(0, maxPositionValue - currentPositionValue)
    const spend = intent.action === 'BUY'
      ? Math.min(maxOrderNotional, capital * intent.targetAllocationPct, remainingCash, allowedNewNotional)
      : 0
    const quantity = intent.action === 'BUY' ? Math.floor(spend / price) : Number(held.get(intent.symbol)?.quantity)
    if (!(quantity >= 1) || !Number.isInteger(quantity)) {
      rejected.push({ symbol: intent.symbol, reason: 'insufficient_cash_or_position' })
      continue
    }

    const clientOrderId = `co_stock_${bot.id}_${screening.asOfSession.replace(/-/g, '')}_${intent.symbol}_${intent.action}`
    const activeIntentKey = `intent_stock_${bot.id}_${screening.asOfSession.replace(/-/g, '')}_${intent.symbol}_${intent.action}`
    const existing = await prismaClient.execution.findFirst({
      where: { OR: [{ clientOrderId }, { activeIntentKey }] }
    })
    if (existing) continue

    // Fail closed: an unavailable or broken risk policy cannot authorize trading.
    let caps
    try {
      caps = await riskEvaluator({
        userId: bot.userId, ticker: intent.symbol, quantity, price
      })
    } catch {
      rejected.push({ symbol: intent.symbol, reason: 'risk_service_unavailable' })
      continue
    }
    if (!caps?.allowed) {
      rejected.push({ symbol: intent.symbol, reason: caps?.reason || 'risk_policy_denied' })
      continue
    }

    const execution = {
      id: `exec_stock_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      userId: bot.userId,
      portfolioId: bot.portfolioId,
      botId: bot.id,
      ticker: intent.symbol,
      direction: intent.action.toLowerCase(),
      quantity,
      price,
      origin: 'bot',
      sourceType: 'AI_FORWARD',
      sourceId: AI_STOCK_TRADER_STRATEGY_ID,
      status: 'queued',
      simSession: nextTradingSession(screening.asOfSession),
      clientOrderId,
      activeIntentKey,
      commission: 0,
      fees: 0,
      pnl: 0,
      signalScore: intent.confidence
    }
    try {
      // Atomic order + evidence audit. DB uniqueness protects concurrent writers.
      await prismaClient.$transaction(async tx => {
        await tx.execution.create({ data: execution })
        await tx.executionAudit.create({
          data: {
            id: `aud_${randomUUID()}`,
            executionId: execution.id,
            userId: bot.userId,
            workerId: 'ai_stock_trader',
            eventType: 'execution_created',
            detail: `AI Stock Trader ${intent.action} ${intent.symbol} queued for ${execution.simSession}`,
            metadata: {
              researchEventId: research.eventId,
              signalSession: screening.asOfSession,
              targetSession: execution.simSession,
              entryType: 'next_open',
              thesis: intent.thesis,
              evidence: intent.evidence,
              exitRule: intent.exitRule
            }
          }
        })
      })
    } catch (error) {
      if (error.code === 'P2002') continue // Another worker already queued this intent.
      throw error
    }
    if (intent.action === 'BUY') remainingCash -= quantity * price
    queued.push({ id: execution.id, symbol: intent.symbol, direction: execution.direction, quantity, targetSession: execution.simSession })
  }
  return { queued, rejected }
}
