/**
 * Flagship AI Stock Trader: one post-close research cycle per completed session.
 * Explicit beta flags prevent code deployment from enabling paid AI calls.
 */
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'
import { getExpectedCompletedExchangeSession, isExchangeTradingDay } from '../utils/marketCalendar.js'
import { getOrCreatePlatformAiStockTrader } from '../services/ai/aiStockTraderBotService.js'
import { screenAiStockUniverse } from '../services/ai/stockScreener.js'
import { loadStockTraderPaperPortfolio } from '../services/ai/stockTraderPortfolio.js'
import { runStockTraderResearch } from '../services/ai/stockTraderResearchService.js'
import { queueStockTraderPaperOrders } from '../services/ai/stockTraderExecutionService.js'
import { createAiUsageGovernor } from '../services/ai/aiUsageGovernor.js'
import { loadBotFills, calculateFifoAccounting } from '../services/botAccountingService.js'
import { processPendingAiExecutions } from '../services/ai/aiBotService.js'

export async function runStockTraderDailyJob({
  env = process.env,
  now = new Date(),
  session = null,
  prismaClient = prisma,
  engine = engineClient,
  provider = null,
  riskEvaluator = undefined,
  botLoader = getOrCreatePlatformAiStockTrader,
  usageGovernor = null,
  pendingProcessor = processPendingAiExecutions,
  fillLoader = loadBotFills,
  accountant = calculateFifoAccounting
} = {}) {
  if (env.ENABLE_FLAGSHIP_STOCK_TRADER !== 'true' || env.ENABLE_AI_PAID_CALLS !== 'true') {
    return { ok: true, skipped: true, reason: 'flagship_not_enabled' }
  }

  const { bot, portfolio } = await botLoader({ prismaClient })
  if (!bot?.enabled || bot.config?.mode !== 'paper') {
    return { ok: true, skipped: true, reason: 'paper_bot_disabled' }
  }

  const expected = getExpectedCompletedExchangeSession(now)
  const asOfSession = session || expected
  if (asOfSession !== expected || !isExchangeTradingDay(asOfSession)) {
    return { ok: true, skipped: true, reason: 'not_current_completed_exchange_session', expected, asOfSession }
  }
  // Stale engine feeds must never produce a paid decision.
  const start = new Date(Date.parse(asOfSession + 'T00:00:00Z') - 7 * 86_400_000).toISOString().slice(0, 10)
  const benchmark = await engine.getDailyBars('SPY', start, asOfSession)
  const lastSession = benchmark?.bars?.at(-1)?.[0]
  if (lastSession !== asOfSession) {
    return { ok: true, skipped: true, reason: 'market_data_not_fresh', expected: asOfSession, lastSession }
  }

  // Process already queued paper orders irrespective of new research outcome.
  const fills = await pendingProcessor(bot.id, { currentSession: asOfSession, prismaClient, engine })
  const existingFills = await fillLoader(bot.id, { prismaClient })
  if (!Array.isArray(existingFills)) throw new Error('Paper fills unavailable')
  const accounting = accountant(existingFills)
  if (!accounting || typeof accounting !== 'object') throw new Error('Paper accounting unavailable')
  const positions = accounting.openPositions || accounting.positions || {}
  const heldSymbols = Object.entries(positions).filter(([, p]) => Number(p.quantity) > 0).map(([symbol]) => symbol)

  const screening = await screenAiStockUniverse({
    engine, session: asOfSession, symbols: bot.config.universe.symbols, heldSymbols
  })
  if (!screening.eligibleCount && !heldSymbols.length) {
    return { ok: true, skipped: true, reason: 'no_eligible_research_candidates', screening, fills }
  }
  const portfolioSnapshot = await loadStockTraderPaperPortfolio({
    bot, screening, prismaClient, fillLoader: async () => existingFills, accountant
  })
  const governor = usageGovernor || createAiUsageGovernor({ prismaClient, env })
  const research = await runStockTraderResearch({
    bot, portfolio, screening, portfolioSnapshot, prismaClient, provider, usageGovernor: governor, engine
  })
  if (!research.ok) return { ok: true, skipped: true, reason: research.reason, screening, research, fills }
  const orders = await queueStockTraderPaperOrders({
    bot, portfolio, research, screening, portfolioSnapshot, prismaClient,
    ...(riskEvaluator ? { riskEvaluator } : {})
  })
  return {
    ok: true, asOfSession, botId: bot.id,
    screening: { universeSize: screening.universeSize, eligibleCount: screening.eligibleCount, shortlist: screening.shortlist.map(s => s.symbol) },
    research: { eventId: research.eventId, cached: research.cached, decisionsCount: research.decision.decisions.length },
    orders, fills
  }
}
