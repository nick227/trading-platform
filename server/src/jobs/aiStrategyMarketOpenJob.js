/**
 * Autonomous AI Strategy Market Open Job
 * 
 * Scheduled to run daily on market open (9:45 AM ET, Mon–Fri, 15 minutes post-open).
 * 
 * Flow:
 * 1. Confirms today is an active US exchange trading day.
 * 2. Resolves current trading session.
 * 3. Identifies queued next_open executions eligible to fill today.
 * 4. Fills orders using genuine opening market data from Alpha Engine via SimulatedBroker.
 * 5. Reconciles portfolio cash, holdings, and mark-to-market balances.
 * 6. Records stage event for tracking.
 */
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'
import {
  getOrCreateCanonicalAiBot,
  processPendingAiExecutions,
  computeAiBotForwardEquity
} from '../services/ai/aiBotService.js'
import { isExchangeTradingDay } from '../utils/marketCalendar.js'
import { recordPipelineStage } from '../services/ai/aiPipelineTracker.js'

export async function runAiStrategyMarketOpenJob({
  templateId = 'tmpl_ai_catalyst_momentum',
  now = new Date(),
  prismaClient = prisma,
  engine = engineClient
} = {}) {
  const startMs = Date.now()
  const nyDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  console.log(`[ai_market_open_job] Starting market open execution check for ${templateId} on ${nyDateStr}...`)

  // 1. Check if today is a valid exchange trading day
  if (!isExchangeTradingDay(nyDateStr)) {
    console.log(`[ai_market_open_job] ${nyDateStr} is not an active exchange trading day (weekend/holiday). Skipping.`)
    return {
      ok: true,
      skipped: true,
      reason: 'not_trading_day',
      session: nyDateStr
    }
  }

  // 2. Locate canonical AI bot
  const { bot } = await getOrCreateCanonicalAiBot({ prismaClient })

  // 3. Find pending queued executions eligible for today (simSession <= nyDateStr)
  const pendingOrders = await prismaClient.execution.findMany({
    where: {
      botId: bot.id,
      status: 'queued',
      simSession: { lte: nyDateStr }
    },
    orderBy: { createdAt: 'asc' }
  })

  if (!pendingOrders.length) {
    console.log(`[ai_market_open_job] No pending executions queued for session ${nyDateStr}.`)
    await recordPipelineStage({
      botId: bot.id,
      portfolioId: bot.portfolioId,
      session: nyDateStr,
      stage: 'pending_order_execution',
      status: 'ok',
      details: { filledCount: 0, pendingRemaining: 0, note: 'no_orders_queued' },
      durationMs: Date.now() - startMs,
      prismaClient
    })
    return {
      ok: true,
      session: nyDateStr,
      filledCount: 0,
      pendingCount: 0
    }
  }

  console.log(`[ai_market_open_job] Found ${pendingOrders.length} pending execution(s) eligible for ${nyDateStr}. Processing fills...`)

  // 4. Process eligible fills
  let fillResults
  try {
    fillResults = await processPendingAiExecutions(bot.id, {
      currentSession: nyDateStr,
      prismaClient,
      engine
    })
  } catch (err) {
    console.error(`[ai_market_open_job] Error processing pending executions: ${err.message}`)
    await recordPipelineStage({
      botId: bot.id,
      portfolioId: bot.portfolioId,
      session: nyDateStr,
      stage: 'pending_order_execution',
      status: 'failed',
      error: err.message,
      durationMs: Date.now() - startMs,
      prismaClient
    })
    return {
      ok: false,
      error: err.message,
      session: nyDateStr
    }
  }

  // 5. Reconcile portfolio equity
  const equityRes = await computeAiBotForwardEquity(bot.id, {
    asOfSession: nyDateStr,
    prismaClient,
    engine
  })

  const filledCount = fillResults.filledExecutions?.length || 0
  const remainingPending = await prismaClient.execution.count({
    where: { botId: bot.id, status: 'queued' }
  })

  await recordPipelineStage({
    botId: bot.id,
    portfolioId: bot.portfolioId,
    session: nyDateStr,
    stage: 'pending_order_execution',
    status: 'ok',
    details: {
      filledCount,
      filledOrders: fillResults.filledExecutions,
      pendingRemaining: remainingPending,
      portfolioEquity: equityRes?.equity
    },
    durationMs: Date.now() - startMs,
    prismaClient
  })

  console.log(`[ai_market_open_job] Completed market open fills for ${nyDateStr}: ${filledCount} filled, ${remainingPending} remaining.`)

  return {
    ok: true,
    session: nyDateStr,
    filledCount,
    pendingCount: remainingPending,
    fills: fillResults.filledExecutions,
    portfolio: {
      equity: equityRes?.equity,
      cash: equityRes?.cash
    }
  }
}
