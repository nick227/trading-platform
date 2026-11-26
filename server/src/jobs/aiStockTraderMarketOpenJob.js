/** Flagship-only opening-session processing of already approved paper orders. */
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'
import { isExchangeTradingDay } from '../utils/marketCalendar.js'
import { getOrCreatePlatformAiStockTrader } from '../services/ai/aiStockTraderBotService.js'
import { processPendingAiExecutions } from '../services/ai/aiBotService.js'

export async function runStockTraderMarketOpenJob({
  env = process.env,
  now = new Date(),
  prismaClient = prisma,
  engine = engineClient,
  botLoader = getOrCreatePlatformAiStockTrader,
  pendingProcessor = processPendingAiExecutions
} = {}) {
  if (env.ENABLE_FLAGSHIP_STOCK_TRADER !== 'true') {
    return { ok: true, skipped: true, reason: 'flagship_not_enabled' }
  }
  const session = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  if (!isExchangeTradingDay(session)) {
    return { ok: true, skipped: true, reason: 'market_closed', session }
  }
  const { bot } = await botLoader({ prismaClient })
  if (!bot.enabled || bot.config?.mode !== 'paper') {
    return { ok: true, skipped: true, reason: 'paper_bot_disabled', session }
  }
  const pending = await prismaClient.execution.findMany({
    where: { botId: bot.id, status: 'queued', simSession: { lte: session } },
    select: { id: true }
  })
  if (!pending.length) return { ok: true, session, filledCount: 0 }
  const result = await pendingProcessor(bot.id, { currentSession: session, prismaClient, engine })
  return {
    ok: true, session,
    filledCount: result.filledExecutions?.length || 0,
    failedCount: result.failedExecutions?.length || 0,
    pendingCount: pending.length
  }
}
