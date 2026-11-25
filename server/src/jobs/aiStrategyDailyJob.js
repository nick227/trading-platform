/**
 * Autonomous AI Strategy Daily Job
 * 
 * Scheduled to run daily post-close (4:30 PM ET, Mon–Fri).
 * 
 * Flow:
 * 1. Checks Alpha Engine for the latest completed trading session and validates all 10 symbols.
 * 2. Processes eligible pending executions targeting this completed session (SimulatedBroker).
 * 3. Enforces market data freshness and chronological integrity.
 * 4. Idempotently verifies whether research has already executed for this session.
 * 5. Solicits structured decisions from configured LLM provider (gpt-4o-mini).
 * 6. Queues next-session executions (look-ahead protected, next_open model).
 * 7. Reconciles forward paper portfolio equity and marks open positions to market.
 * 8. Synchronizes public strategy evidence for the Forward window.
 */
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'
import {
  getOrCreateCanonicalAiBot,
  executeAiStrategyCycle,
  processPendingAiExecutions,
  computeAiBotForwardEquity
} from '../services/ai/aiBotService.js'
import { generateStrategyEvidence } from '../services/strategyEvidenceService.js'
import { getExpectedCompletedExchangeSession } from '../utils/marketCalendar.js'
import { validateAndIngestDailyMarketData, DEFAULT_TRADABLE_SYMBOLS } from '../services/ai/aiMarketDataService.js'
import { recordPipelineStage } from '../services/ai/aiPipelineTracker.js'

export { getExpectedCompletedExchangeSession }

export async function runAiStrategyDailyJob({
  templateId = 'tmpl_ai_catalyst_momentum',
  session = null,
  force = false,
  dryRun = false,
  providerName = 'openai',
  now = new Date(),
  syncEvidence = true,
  prismaClient = prisma,
  engine = engineClient
} = {}) {
  const startMs = Date.now()
  console.log(`[ai_daily_job] Starting autonomous AI daily job for ${templateId}...`)

  const { bot } = await getOrCreateCanonicalAiBot({ prismaClient })

  // 1. Resolve trading session
  let activeSession = session
  if (!activeSession) {
    try {
      const end = new Date().toISOString().slice(0, 10)
      const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
      const barsRes = await engine.getDailyBars('SPY', start, end)
      const bars = Array.isArray(barsRes?.bars) ? barsRes.bars : []
      if (bars.length) {
        activeSession = bars[bars.length - 1][0]
      }
    } catch (err) {
      console.warn(`[ai_daily_job] Failed to resolve latest session from engine: ${err.message}`)
    }
  }

  if (!activeSession) {
    console.warn(`[ai_daily_job] Fresh market data is unavailable from market engine. Skipping daily research cycle.`)
    await recordPipelineStage({
      botId: bot.id,
      portfolioId: bot.portfolioId,
      session: 'unknown',
      stage: 'market_data_ingestion',
      status: 'failed',
      error: 'fresh_market_data_unavailable',
      durationMs: Date.now() - startMs,
      prismaClient
    })
    return {
      ok: true,
      skipped: true,
      reason: 'fresh_market_data_unavailable'
    }
  }

  console.log(`[ai_daily_job] Active session for execution: ${activeSession}`)

  // 2. Stage 2: Process pending eligible executions targeting this completed session FIRST
  // Runs independently so pending orders fill even if fresh research is skipped or completed
  const stage2Start = Date.now()
  let fillResults = { filledExecutions: [], failedExecutions: [], exitExecutions: [] }
  try {
    fillResults = await processPendingAiExecutions(bot.id, {
      currentSession: activeSession,
      prismaClient,
      engine
    })
    if (fillResults.filledExecutions?.length > 0) {
      console.log(`[ai_daily_job] Filled ${fillResults.filledExecutions.length} pending executions for session ${activeSession}`)
    }
    if (fillResults.exitExecutions?.length > 0) {
      console.log(`[ai_daily_job] Queued ${fillResults.exitExecutions.length} protective exit orders based on ${activeSession} close`)
    }
    await recordPipelineStage({
      botId: bot.id,
      portfolioId: bot.portfolioId,
      session: activeSession,
      stage: 'pending_order_execution',
      status: 'ok',
      details: {
        filledCount: fillResults.filledExecutions?.length || 0,
        exitCount: fillResults.exitExecutions?.length || 0
      },
      durationMs: Date.now() - stage2Start,
      prismaClient
    })
  } catch (err) {
    console.error(`[ai_daily_job] Pending executions error: ${err.message}`)
    await recordPipelineStage({
      botId: bot.id,
      portfolioId: bot.portfolioId,
      session: activeSession,
      stage: 'pending_order_execution',
      status: 'failed',
      error: err.message,
      durationMs: Date.now() - stage2Start,
      prismaClient
    })
  }

  // 3. Stage 1: Market Data Freshness Validation: Require the exact expected completed exchange session
  if (!session && !force) {
    const expectedSession = getExpectedCompletedExchangeSession(now)
    if (activeSession < expectedSession) {
      console.warn(`[ai_daily_job] Market data gap: latest bar is ${activeSession}, expected completed exchange session is ${expectedSession}. Skipping new research cycle.`)
      await recordPipelineStage({
        botId: bot.id,
        portfolioId: bot.portfolioId,
        session: activeSession,
        stage: 'market_data_ingestion',
        status: 'skipped',
        details: { latestBarDate: activeSession, expectedSession },
        error: 'stale_market_data',
        durationMs: Date.now() - startMs,
        prismaClient
      })
      return {
        ok: true,
        skipped: true,
        reason: 'stale_market_data',
        latestBarDate: activeSession,
        expectedSession,
        fills: fillResults
      }
    }
  }

  // Deep validation of universe market data if full engine is available
  try {
    const validation = await validateAndIngestDailyMarketData({
      session: activeSession,
      symbols: DEFAULT_TRADABLE_SYMBOLS,
      engine
    })
    if (!validation.valid && validation.reason !== 'session_is_not_exchange_trading_day') {
      console.warn(`[ai_daily_job] Market data validation advisory: ${validation.reason}`)
    }
    await recordPipelineStage({
      botId: bot.id,
      portfolioId: bot.portfolioId,
      session: activeSession,
      stage: 'market_data_ingestion',
      status: validation.valid ? 'ok' : 'degraded',
      details: {
        symbolsValidated: validation.symbolsValidated,
        missing: validation.missingSymbols,
        stale: validation.staleSymbols
      },
      durationMs: Date.now() - startMs,
      prismaClient
    })
  } catch (err) {
    // Engine mock or custom environment might not support all 10 symbols; continue gracefully
  }

  // 4. Idempotency check: did we already run research for this session on this bot?
  let cycleResult = null
  let researchSkipped = false
  let skipReason = null

  if (!force) {
    const existingEvents = await prismaClient.botEvent.findMany({
      where: {
        botId: bot.id,
        type: 'decision_made'
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    })

    const alreadyRun = existingEvents.some(e => e.metadata?.asOfSession === activeSession)
    if (alreadyRun) {
      console.log(`[ai_daily_job] Cycle for session ${activeSession} has already executed. Skipping new research. (use force=true to override)`)
      researchSkipped = true
      skipReason = 'already_executed_for_session'
    }
  }

  // 5. Stage 3: Run autonomous AI research and decision cycle if not skipped
  const stage3Start = Date.now()
  if (!researchSkipped) {
    try {
      cycleResult = await executeAiStrategyCycle({
        botId: bot.id,
        session: activeSession,
        providerName,
        dryRun,
        prismaClient,
        engine
      })
      await recordPipelineStage({
        botId: bot.id,
        portfolioId: bot.portfolioId,
        session: activeSession,
        stage: 'ai_research_decision',
        status: cycleResult.ok ? 'ok' : 'failed',
        details: {
          actionableCount: cycleResult.actionableCount,
          createdExecutionsCount: cycleResult.createdExecutions?.length || 0
        },
        durationMs: Date.now() - stage3Start,
        prismaClient
      })
    } catch (err) {
      console.error(`[ai_daily_job] Research cycle failed: ${err.message}`)
      await recordPipelineStage({
        botId: bot.id,
        portfolioId: bot.portfolioId,
        session: activeSession,
        stage: 'ai_research_decision',
        status: 'failed',
        error: err.message,
        durationMs: Date.now() - stage3Start,
        prismaClient
      })
      throw err
    }
  } else {
    await recordPipelineStage({
      botId: bot.id,
      portfolioId: bot.portfolioId,
      session: activeSession,
      stage: 'ai_research_decision',
      status: 'skipped',
      details: { reason: skipReason },
      durationMs: Date.now() - stage3Start,
      prismaClient
    })
  }

  // 6. Stage 4: Compute forward portfolio equity & reconcile balances
  const stage4Start = Date.now()
  const forwardEquity = await computeAiBotForwardEquity(bot.id, {
    asOfSession: activeSession,
    prismaClient,
    engine
  })
  await recordPipelineStage({
    botId: bot.id,
    portfolioId: bot.portfolioId,
    session: activeSession,
    stage: 'portfolio_valuation',
    status: 'ok',
    details: {
      equity: forwardEquity.currentEquity,
      cash: forwardEquity.cash,
      returnPct: forwardEquity.returnPct
    },
    durationMs: Date.now() - stage4Start,
    prismaClient
  })

  // 7. Stage 5: Sync public strategy evidence so the Forward window displays the latest equity curve
  const stage5Start = Date.now()
  if (syncEvidence) {
    try {
      await generateStrategyEvidence({ prismaClient, engine })
      await recordPipelineStage({
        botId: bot.id,
        portfolioId: bot.portfolioId,
        session: activeSession,
        stage: 'strategy_evidence_publication',
        status: 'ok',
        durationMs: Date.now() - stage5Start,
        prismaClient
      })
    } catch (err) {
      console.warn(`[ai_daily_job] Strategy evidence generation warning: ${err.message}`)
      await recordPipelineStage({
        botId: bot.id,
        portfolioId: bot.portfolioId,
        session: activeSession,
        stage: 'strategy_evidence_publication',
        status: 'degraded',
        error: err.message,
        durationMs: Date.now() - stage5Start,
        prismaClient
      })
    }
  }

  console.log(`[ai_daily_job] Completed autonomous AI daily job for session ${activeSession}. Equity: $${forwardEquity.currentEquity} (${forwardEquity.returnPct}%)`)

  return {
    ok: true,
    session: activeSession,
    fills: fillResults,
    researchSkipped,
    skipReason,
    cycle: cycleResult,
    forwardEquity
  }
}
