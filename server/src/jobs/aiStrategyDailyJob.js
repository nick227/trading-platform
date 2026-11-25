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

export async function runAiStrategyDailyJob({
  templateId = 'tmpl_ai_catalyst_momentum',
  session = null,
  force = false,
  dryRun = false,
  providerName = 'openai',
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
      const start = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
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
    activeSession = '2026-11-20' // safe fallback
  }

  console.log(`[ai_daily_job] Active session for research: ${activeSession}`)

  // 2. Idempotency check: did we already run this session for this bot?
  if (!force) {
    const existingEvents = await prismaClient.botEvent.findMany({
      where: {
        botId: bot.id,
        type: 'decision_made'
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    })

    const alreadyRun = existingEvents.some(e => e.metadata?.asOfSession === activeSession)
    if (alreadyRun) {
      console.log(`[ai_daily_job] Cycle for session ${activeSession} has already executed. Skipping. (use force=true to override)`)
      return {
        ok: true,
        skipped: true,
        session: activeSession,
        reason: 'already_executed_for_session'
      }
    }
  }

  // 3. Process pending executions targeting this completed session
  const fillResults = await processPendingAiExecutions(bot.id, {
    currentSession: activeSession,
    prismaClient,
    engine
  })
  if (fillResults.filledExecutions.length > 0) {
    console.log(`[ai_daily_job] Filled ${fillResults.filledExecutions.length} pending executions for session ${activeSession}`)
  }

  // 4. Run autonomous AI research and decision cycle
  const cycleResult = await executeAiStrategyCycle({
    botId: bot.id,
    session: activeSession,
    providerName,
    dryRun,
    prismaClient,
    engine
  })

  // 5. Compute forward portfolio equity & sync public strategy evidence
  const forwardEquity = await computeAiBotForwardEquity(bot.id, {
    asOfSession: activeSession,
    prismaClient,
    engine
  })

  // Sync public strategy evidence so the Forward window displays the latest equity curve
  try {
    await generateStrategyEvidence({ prismaClient, engine })
  } catch (err) {
    console.warn(`[ai_daily_job] Strategy evidence generation warning: ${err.message}`)
  }

  console.log(`[ai_daily_job] Completed autonomous AI daily job for session ${activeSession}. Equity: $${forwardEquity.currentEquity} (${forwardEquity.returnPct}%)`)

  return {
    ok: true,
    session: activeSession,
    fills: fillResults,
    cycle: cycleResult,
    forwardEquity
  }
}
