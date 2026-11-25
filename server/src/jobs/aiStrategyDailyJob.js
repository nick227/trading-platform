/**
 * Autonomous AI Strategy Daily Job
 * 
 * Scheduled to run daily post-close (4:30 PM ET, Mon–Fri).
 * 
 * Flow:
 * 1. Checks Alpha Engine for the latest completed trading session.
 * 2. Idempotently verifies whether a cycle has already executed for this session.
 * 3. Fills pending executions whose target session has completed (using SimulatedBroker).
 * 4. Assembles point-in-time market, catalyst, and portfolio context.
 * 5. Solicits structured decisions from the configured LLM provider.
 * 6. Records full decision audit with the three distinct timestamps:
 *    - Market session analyzed
 *    - Model decision timestamp
 *    - Intended execution session
 * 7. Queues next-session executions (look-ahead protected).
 * 8. Recomputes forward paper portfolio equity and synchronizes public strategy evidence.
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
    return {
      ok: true,
      skipped: true,
      reason: 'fresh_market_data_unavailable'
    }
  }

  console.log(`[ai_daily_job] Active session for execution: ${activeSession}`)

  // 2. Process pending eligible executions targeting this completed session FIRST
  // Runs independently so pending orders fill even if fresh research is skipped or completed
  const fillResults = await processPendingAiExecutions(bot.id, {
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

  // 3. Market Data Freshness Validation: Require the exact expected completed exchange session
  if (!session && !force) {
    const expectedSession = getExpectedCompletedExchangeSession(now)
    if (activeSession < expectedSession) {
      console.warn(`[ai_daily_job] Market data gap: latest bar is ${activeSession}, expected completed exchange session is ${expectedSession}. Skipping new research cycle.`)
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

  // 5. Run autonomous AI research and decision cycle if not skipped
  if (!researchSkipped) {
    cycleResult = await executeAiStrategyCycle({
      botId: bot.id,
      session: activeSession,
      providerName,
      dryRun,
      prismaClient,
      engine
    })
  }

  // 6. Compute forward portfolio equity & sync public strategy evidence
  const forwardEquity = await computeAiBotForwardEquity(bot.id, {
    asOfSession: activeSession,
    prismaClient,
    engine
  })

  // Sync public strategy evidence so the Forward window displays the latest equity curve
  if (syncEvidence) {
    try {
      await generateStrategyEvidence({ prismaClient, engine })
    } catch (err) {
      console.warn(`[ai_daily_job] Strategy evidence generation warning: ${err.message}`)
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
