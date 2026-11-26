/**
 * Flagship paper order admission. Every admission re-reads authoritative fills
 * and outstanding commitments under the portfolio row lock in one transaction.
 * AI proposes actions; deterministic services size, validate and queue them.
 */
import { randomUUID } from 'node:crypto'
import prisma from '../../loaders/prisma.js'
import { evaluateRiskCaps } from '../../../../worker/src/risk/riskCaps.js'
import { readEmergencyStop } from '../emergencyStopService.js'
import { calculateFifoAccounting } from '../botAccountingService.js'
import { nextStockTraderSession } from './stockTraderTradingSession.js'
import { reconcileStockTraderFills, calculateStockTraderSessionRealizedPnl, STOCK_TRADER_ACTIVE_ORDER_STATUSES } from './stockTraderAccounting.js'
import { evaluateStockTraderPaperProposal } from './stockTraderRiskPolicy.js'
import { AI_STOCK_TRADER_STRATEGY_ID } from './strategies/aiStockTraderStrategy.js'

const money = value => Math.round(value * 100) / 100

export async function queueStockTraderPaperOrders({
  bot,
  portfolio,
  research,
  screening,
  portfolioSnapshot,
  prismaClient = prisma,
  riskEvaluator = evaluateRiskCaps,
  accountant = calculateFifoAccounting
}) {
  if (!bot?.enabled || bot.config?.mode !== 'paper' ||
      bot.templateId !== AI_STOCK_TRADER_STRATEGY_ID ||
      portfolio?.id !== bot.portfolioId || portfolio.userId !== bot.userId) {
    throw new Error('Flagship paper bot identity or execution mode invalid')
  }
  if (!research?.ok || !research.decision || !research.eventId ||
      research.decision.asOfSession !== screening?.asOfSession ||
      portfolioSnapshot?.asOfSession !== screening.asOfSession ||
      !Array.isArray(screening?.shortlist) || !Array.isArray(portfolioSnapshot.positions)) {
    throw new Error('Validated same-session research and portfolio required')
  }
  const limits = bot.config?.execution
  const maxOrders = Math.min(2, Number(limits?.maxOrdersPerCycle))
  if (!Number.isInteger(maxOrders) || maxOrders < 1) throw new Error('Invalid flagship order limit')

  const queued = []
  const rejected = []
  const shortlist = new Map(screening.shortlist.map(row => [row.symbol, row]))
  const quotes = Object.fromEntries(screening.shortlist
    .filter(row => row?.indicators?.price != null)
    .map(row => [row.symbol, row.indicators.price]))

  for (const intent of research.decision.actionable.slice(0, maxOrders)) {
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
    if (!['BUY', 'SELL'].includes(intent.action)) {
      rejected.push({ symbol: intent.symbol, reason: 'unsupported_action' })
      continue
    }
    const dateKey = screening.asOfSession.replace(/-/g, '')
    const clientOrderId = `co_stock_${bot.id}_${dateKey}_${intent.symbol}_${intent.action}`
    const activeIntentKey = `intent_stock_${bot.id}_${dateKey}_${intent.symbol}_${intent.action}`

    try {
      const admitted = await prismaClient.$transaction(async tx => {
        // Updating the portfolio row obtains a DB write lock until commit.
        // Serializes competing admissions even if they propose different symbols.
        await tx.portfolio.update({
          where: { id: portfolio.id },
          data: { updatedAt: new Date() }
        })

        const actor = await tx.user.findUnique({
          where: { id: bot.userId }, select: { riskSettings: true }
        })
        if (!actor || readEmergencyStop(actor.riskSettings).active) {
          return { reason: 'emergency_stop_or_missing_account' }
        }

        const existing = await tx.execution.findFirst({
          where: { OR: [{ clientOrderId }, { activeIntentKey }] }
        })
        if (existing) return { reason: 'already_queued' }

        const fills = await tx.execution.findMany({
          where: { botId: bot.id, filledQuantity: { gt: 0 }, filledPrice: { gt: 0 } }
        })
        const activeOrders = await tx.execution.findMany({
          where: { botId: bot.id, status: { in: [...STOCK_TRADER_ACTIVE_ORDER_STATUSES] } }
        })
        const fresh = reconcileStockTraderFills({
          fills, allocatedCapital: bot.config.allocatedAmount,
          asOfSession: screening.asOfSession, quotes, accountant
        })

        // Refuse proposals derived from stale paper holdings/cash.
        const expectedQuantities = new Map(portfolioSnapshot.positions.map(p => [p.symbol, Number(p.quantity)]))
        if (Math.abs(fresh.cash - Number(portfolioSnapshot.cash)) > 0.02 ||
            fresh.positions.length !== expectedQuantities.size ||
            fresh.positions.some(p => Math.abs(p.quantity - Number(expectedQuantities.get(p.symbol))) > 0.0001)) {
          return { reason: 'portfolio_snapshot_changed' }
        }
        const sessionRealizedPnl = calculateStockTraderSessionRealizedPnl({
          fills, session: screening.asOfSession, accountant
        })
        const plan = evaluateStockTraderPaperProposal({
          intent, price, portfolio: fresh, activeOrders,
          executionLimits: limits, sessionRealizedPnl
        })
        if (!plan.allowed) return { reason: plan.reason }

        // Shared user-wide worker caps remain an additional gate. A failure
        // here can never authorize the order.
        let caps
        try {
          caps = await riskEvaluator({
            userId: bot.userId, ticker: intent.symbol,
            direction: intent.action.toLowerCase(),
            quantity: plan.quantity, price
          })
        } catch {
          return { reason: 'risk_service_unavailable' }
        }
        if (!caps?.allowed) return { reason: caps?.reason || 'risk_policy_denied' }

        const execution = {
          id: `exec_stock_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          userId: bot.userId,
          portfolioId: bot.portfolioId,
          botId: bot.id,
          ticker: intent.symbol,
          direction: intent.action.toLowerCase(),
          quantity: plan.quantity,
          price,
          origin: 'bot',
          sourceType: 'AI_FORWARD',
          sourceId: AI_STOCK_TRADER_STRATEGY_ID,
          status: 'queued',
          simSession: nextStockTraderSession(screening.asOfSession),
          clientOrderId, activeIntentKey,
          commission: 0, fees: 0, pnl: 0,
          signalScore: intent.confidence
        }
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
              exitRule: intent.exitRule,
              reservedNotional: money(plan.notional),
              cashAtDecision: fresh.cash,
              portfolioEquityAtDecision: fresh.totalEquity,
              sessionRealizedPnl
            }
          }
        })
        return { execution }
      })
      if (admitted.execution) {
        const e = admitted.execution
        queued.push({
          id: e.id, symbol: intent.symbol, direction: e.direction,
          quantity: e.quantity, targetSession: e.simSession
        })
      } else if (admitted.reason !== 'already_queued') {
        rejected.push({ symbol: intent.symbol, reason: admitted.reason })
      }
    } catch (error) {
      // A uniqueness collision is an idempotent retry only when our own
      // deterministic order ID exists; other database errors must surface.
      if (error.code === 'P2002') {
        const existing = await prismaClient.execution.findFirst({
          where: { OR: [{ clientOrderId }, { activeIntentKey }] }
        })
        if (existing) continue
      }
      throw error
    }
  }
  return { queued, rejected }
}
