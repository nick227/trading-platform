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

/**
 * Calculates the expected completed trading session (America/New_York)
 * based on wall-clock market close (16:30 ET).
 */
export function getExpectedCompletedTradingSession(now = new Date()) {
  const nyDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const nyHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit' }), 10)
  const nyMinutes = parseInt(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }), 10)

  const d = new Date(nyDateStr + 'T12:00:00Z')
  const dayOfWeek = d.getUTCDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const isPostClose = nyHour > 16 || (nyHour === 16 && nyMinutes >= 30)

  let daysToSubtract = 0
  if (dayOfWeek === 0) { // Sunday -> Friday
    daysToSubtract = 2
  } else if (dayOfWeek === 6) { // Saturday -> Friday
    daysToSubtract = 1
  } else if (!isPostClose) {
    daysToSubtract = (dayOfWeek === 1) ? 3 : 1
  }

  const expectedDate = new Date(d.getTime() - daysToSubtract * 86_400_000)
  return expectedDate.toISOString().slice(0, 10)
}

export async function runAiStrategyDailyJob({
  templateId = 'tmpl_ai_catalyst_momentum',
  session = null,
  force = false,
  dryRun = false,
  providerName = 'openai',
  now = new Date(),
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

  // Market Data Freshness Validation: In autonomous forward mode, verify bar recency
  if (!session && !force) {
    const expectedSession = getExpectedCompletedTradingSession(now)
    const expectedTime = new Date(expectedSession + 'T12:00:00Z').getTime()
    const activeTime = new Date(activeSession + 'T12:00:00Z').getTime()
    const ageDiffDays = Math.round((expectedTime - activeTime) / 86_400_000)

    if (ageDiffDays > 4) {
      console.warn(`[ai_daily_job] Market data is stale (latest bar is ${activeSession}, expected ${expectedSession}, ${ageDiffDays} days old). Skipping daily research cycle.`)
      return {
        ok: true,
        skipped: true,
        reason: 'stale_market_data',
        latestBarDate: activeSession,
        expectedSession,
        ageDiffDays
      }
    }
  }

  console.log(`[ai_daily_job] Active session for research & execution: ${activeSession}`)

  // 2. ALWAYS process pending eligible executions targeting this completed session FIRST
  // Runs even if the research cycle was skipped or already completed for this session
  const fillResults = await processPendingAiExecutions(bot.id, {
    currentSession: activeSession,
    prismaClient,
    engine
  })
  if (fillResults.filledExecutions.length > 0) {
    console.log(`[ai_daily_job] Filled ${fillResults.filledExecutions.length} pending executions for session ${activeSession}`)
  }

  // 3. Idempotency check: did we already run this session for this bot?
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

  // 4. Run autonomous AI research and decision cycle if not skipped
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
    researchSkipped,
    skipReason,
    cycle: cycleResult,
    forwardEquity
  }
}
