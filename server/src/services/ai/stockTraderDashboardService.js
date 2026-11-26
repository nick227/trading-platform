/**
 * Read-only public snapshot for the platform-owned flagship paper bot.
 * Never creates a bot, invokes a provider, or publishes private account data.
 */
import prisma from '../../loaders/prisma.js'
import { engineClient } from '../../clients/engine.js'
import { calculateFifoAccounting, loadBotFills } from '../botAccountingService.js'
import { AI_STOCK_TRADER_PLATFORM_BOT_ID, AI_STOCK_TRADER_STRATEGY_ID } from './strategies/aiStockTraderStrategy.js'

const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null

export async function readPublicStockTraderDashboard({
  prismaClient = prisma,
  engine = engineClient,
  fillLoader = loadBotFills,
  accountant = calculateFifoAccounting
} = {}) {
  const bot = await prismaClient.bot.findUnique({ where: { id: AI_STOCK_TRADER_PLATFORM_BOT_ID } })
  if (!bot || bot.templateId !== AI_STOCK_TRADER_STRATEGY_ID || bot.deletedAt) {
    return { status: 'not_initialized', simulated: true, name: 'AI Stock Trader', research: [], orders: [], positions: [], performance: null }
  }
  const [fills, executions, events] = await Promise.all([
    fillLoader(bot.id, { prismaClient }),
    prismaClient.execution.findMany({
      where: { botId: bot.id }, orderBy: { createdAt: 'desc' }, take: 40
    }),
    prismaClient.botEvent.findMany({
      where: { botId: bot.id, type: 'decision_made' }, orderBy: { createdAt: 'desc' }, take: 100
    })
  ])
  if (!Array.isArray(fills)) throw new Error('Paper fill history unavailable')

  const preliminary = accountant(fills)
  const currentPrices = {}
  const priceDates = {}
  for (const ticker of Object.keys(preliminary.openPositions || {}).sort()) {
    const close = await engine.getSessionClose(ticker).catch(() => null)
    const price = finite(close?.close)
    if (price > 0 && typeof close?.session === 'string') {
      currentPrices[ticker] = price
      priceDates[ticker] = close.session
    }
  }
  const accounting = accountant(fills, { currentPrices })
  const positions = Object.values(accounting.openPositions || {}).map(p => ({
    symbol: p.ticker,
    quantity: finite(p.quantity),
    averageCost: finite(p.avgPrice),
    lastPrice: finite(p.currentPrice),
    asOfSession: priceDates[p.ticker] || null,
    marketValue: finite(p.currentPrice) === null ? null : Number((p.quantity * p.currentPrice).toFixed(2)),
    unrealizedPnl: finite(p.unrealizedPnl)
  })).sort((a,b) => a.symbol.localeCompare(b.symbol))
  const capital = finite(bot.config?.allocatedAmount)
  const performance = accounting.hasFills ? {
    realizedPnl: finite(accounting.performance?.realizedPnl),
    unrealizedPnl: finite(accounting.performance?.unrealizedPnl),
    totalPnl: finite(accounting.performance?.totalPnl),
    fillCount: accounting.fillCount,
    closedTrades: accounting.performance?.closedTrades ?? null,
    winRate: finite(accounting.performance?.winRate),
    totalEquity: capital !== null && finite(accounting.performance?.totalPnl) !== null
      ? Number((capital + accounting.performance.totalPnl - (accounting.performance.fees || 0)).toFixed(2)) : null
  } : null
  const research = events.filter(e => e.metadata?.status === 'completed' && e.metadata?.decision?.decisions)
    .slice(0, 10)
    .map(e => ({
      id: e.id,
      createdAt: e.createdAt,
      asOfSession: e.metadata.decision.asOfSession,
      marketSummary: e.metadata.decision.marketSummary,
      model: e.metadata.model || null,
      // Publish high-level research provenance, never raw provider prompts,
      // full tool outputs, account credentials or untrusted source text.
      investigation: e.metadata.investigation ? {
        focus: String(e.metadata.investigation.plan?.focus || '').slice(0, 300),
        toolsUsed: [...new Set((e.metadata.investigation.toolTrace || [])
          .map(item => item.toolId).filter(id => typeof id === 'string'))].slice(0, 10),
        toolCalls: Number(e.metadata.investigation.toolUsage?.calls) || 0,
        modelCalls: Number(e.metadata.investigation.providerCalls) || 0,
        priorResearchCycles: Array.isArray(e.metadata.snapshot?.memory?.history)
          ? e.metadata.snapshot.memory.history.length : 0
      } : null,
      decisions: e.metadata.decision.decisions.map(d => ({
        symbol: d.symbol, action: d.action, confidence: finite(d.confidence),
        thesis: d.thesis, evidence: Array.isArray(d.evidence) ? d.evidence : [],
        risks: Array.isArray(d.risks) ? d.risks : []
      }))
    }))
  return {
    status: bot.enabled ? 'enabled' : 'paused',
    simulated: true,
    name: bot.name,
    botId: bot.id,
    capitalAllocated: capital,
    research,
    positions,
    performance,
    orders: executions.map(e => ({
      id: e.id, symbol: e.ticker, direction: e.direction, quantity: finite(e.quantity),
      status: e.status, intentSession: e.simSession,
      filledPrice: finite(e.filledPrice), filledQuantity: finite(e.filledQuantity),
      filledAt: e.filledAt, createdAt: e.createdAt
    }))
  }
}
