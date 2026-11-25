/**
 * AI Autonomous Trading Pipeline Stage Tracker & Status Reporter
 * 
 * Provides end-to-end monitoring across all 5 autonomous trading lifecycle stages:
 * 1. Market Data Ingestion
 * 2. Pending Order Execution
 * 3. AI Research Decision
 * 4. Portfolio Valuation
 * 5. Strategy Evidence Publication
 */
import prisma from '../../loaders/prisma.js'
import { getExpectedCompletedExchangeSession, isExchangeTradingDay } from '../../utils/marketCalendar.js'
import { loadBotFills, calculateFifoAccounting } from '../botAccountingService.js'

export const PIPELINE_STAGES = [
  'market_data_ingestion',
  'pending_order_execution',
  'ai_research_decision',
  'portfolio_valuation',
  'strategy_evidence_publication'
]

/**
 * Records a pipeline stage execution event in BotEvent.
 */
export async function recordPipelineStage({
  botId,
  portfolioId = null,
  session,
  stage,
  status, // 'ok' | 'skipped' | 'failed' | 'in_progress'
  details = null,
  error = null,
  durationMs = null,
  prismaClient = prisma
}) {
  if (!botId || !stage || !session) return null

  try {
    let resolvedPortfolioId = portfolioId
    if (!resolvedPortfolioId) {
      const bot = await prismaClient.bot.findUnique({
        where: { id: botId },
        select: { portfolioId: true }
      })
      resolvedPortfolioId = bot?.portfolioId || 'port_unknown'
    }

    const eventType = status === 'ok'
      ? 'decision_made'
      : (status === 'failed' ? 'error_occurred' : 'rule_triggered')

    const eventId = `pipe_${stage}_${botId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}_${session.replace(/-/g, '')}_${Date.now()}`
    const detailStr = `[Pipeline: ${stage}] Session ${session} -> ${status}${error ? `: ${error}` : ''}`.slice(0, 190)

    return await prismaClient.botEvent.create({
      data: {
        id: eventId,
        botId,
        portfolioId: resolvedPortfolioId,
        type: eventType,
        detail: detailStr,
        metadata: {
          category: 'pipeline_stage',
          stage,
          session,
          status,
          details,
          error: error ? String(error) : null,
          durationMs,
          recordedAt: new Date().toISOString()
        }
      }
    })
  } catch (err) {
    console.warn(`[aiPipelineTracker] Failed to record stage ${stage}: ${err.message}`)
    return null
  }
}

/**
 * Retrieves the comprehensive pipeline status for the canonical AI strategy bot.
 */
export async function getAiPipelineStatus({
  templateId = 'tmpl_ai_catalyst_momentum',
  botId = null,
  prismaClient = prisma,
  now = new Date()
} = {}) {
  // 1. Locate bot
  const bot = botId
    ? await prismaClient.bot.findUnique({ where: { id: botId } })
    : await prismaClient.bot.findFirst({
        where: { templateId, userId: 'usr_platform_canonical', deletedAt: null }
      }) || await prismaClient.bot.findFirst({ where: { templateId, deletedAt: null } })

  if (!bot) {
    return {
      status: 'bot_not_found',
      templateId,
      stages: {}
    }
  }

  // 2. Expected exchange session
  const expectedSession = getExpectedCompletedExchangeSession(now)
  const isTodayTradingDay = isExchangeTradingDay(now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }))

  // 3. Query recent stage events
  const stageEvents = await prismaClient.botEvent.findMany({
    where: { botId: bot.id },
    orderBy: { createdAt: 'desc' },
    take: 100
  }).catch(() => [])

  const filteredStageEvents = stageEvents.filter(e => e.metadata?.category === 'pipeline_stage')

  const stageMap = {}
  for (const s of PIPELINE_STAGES) {
    const latestEvent = filteredStageEvents.find(e => e.metadata?.stage === s)
    stageMap[s] = latestEvent ? {
      session: latestEvent.metadata?.session,
      status: latestEvent.metadata?.status,
      details: latestEvent.metadata?.details,
      error: latestEvent.metadata?.error,
      recordedAt: latestEvent.createdAt
    } : {
      status: 'unrecorded',
      session: null
    }
  }

  // 4. Query pending queued executions
  const pendingExecutions = await prismaClient.execution.findMany({
    where: { botId: bot.id, status: 'queued' },
    orderBy: { createdAt: 'asc' }
  }).catch(() => [])

  // 5. Query portfolio state
  const portfolio = bot.portfolioId
    ? await prismaClient.portfolio.findUnique({ where: { id: bot.portfolioId } })
    : null

  const fills = await loadBotFills(bot.id, { prismaClient }).catch(() => [])
  const accounting = calculateFifoAccounting(fills)

  // 6. Query strategy evidence status
  const forwardEvidence = await prismaClient.strategyEvidence.findFirst({
    where: { templateId, window: 'forward', symbol: 'SPY' },
    orderBy: { createdAt: 'desc' }
  }).catch(() => null)

  const isHealthy = Object.values(stageMap).every(s => s.status !== 'failed')

  return {
    status: isHealthy ? 'healthy' : 'degraded',
    strategyId: templateId,
    botId: bot.id,
    portfolioId: bot.portfolioId,
    expectedCompletedSession: expectedSession,
    isTodayTradingDay,
    stages: stageMap,
    pendingOrdersCount: pendingExecutions.length,
    pendingOrders: pendingExecutions.map(e => ({
      id: e.id,
      ticker: e.ticker,
      direction: e.direction,
      quantity: e.quantity,
      simSession: e.simSession,
      status: e.status
    })),
    portfolio: {
      cashBalance: portfolio?.cashBalance ?? accounting.cashBalance ?? 10_000,
      totalValue: portfolio?.totalValue ?? 10_000,
      openPositions: accounting.openPositions || accounting.positions || {},
      fillsCount: fills.length
    },
    evidence: {
      status: forwardEvidence?.status ?? 'pending',
      lastSession: forwardEvidence?.endDate ?? null,
      forwardReturnPct: forwardEvidence?.results?.annualizedReturnPct ?? null,
      updatedAt: forwardEvidence?.updatedAt ?? null
    },
    scheduler: {
      enabled: process.env.ENABLE_AI_SCHEDULER !== 'false',
      marketOpenCron: '45 9 * * 1-5 (America/New_York)',
      marketCloseCron: '30 16 * * 1-5 (America/New_York)'
    }
  }
}
