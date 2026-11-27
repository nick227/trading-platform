/**
 * Flagship AI Stock Trader: one post-close research cycle per completed session.
 * Explicit beta flags prevent code deployment from enabling paid AI calls.
 */
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'
import { getExpectedCompletedExchangeSession, isExchangeTradingDay } from '../utils/marketCalendar.js'
import { getOrCreatePlatformAiStockTrader } from '../services/ai/aiStockTraderBotService.js'
import { screenAiStockUniverse } from '../services/ai/stockScreener.js'
import { resolveTradableDiscoveryPromotions } from '../services/ai/stockDiscoveryService.js'
import { loadStockTraderPaperPortfolio } from '../services/ai/stockTraderPortfolio.js'
import { runStockTraderResearch } from '../services/ai/stockTraderResearchService.js'
import { queueStockTraderPaperOrders } from '../services/ai/stockTraderExecutionService.js'
import { createAiUsageGovernor } from '../services/ai/aiUsageGovernor.js'
import { loadBotFills, calculateFifoAccounting } from '../services/botAccountingService.js'
import { processPendingAiExecutions } from '../services/ai/aiBotService.js'

export function resolveDynamicDiscoveryConfig(bot, env = process.env) {
  const cfg = bot?.config?.universe?.dynamicDiscovery
  const envToggle = env.AI_STOCK_TRADER_DYNAMIC_DISCOVERY
  const enabled = envToggle === 'true'
    ? true
    : envToggle === 'false'
      ? false
      : Boolean(cfg?.enabled)
  const rawMax = Number(env.AI_STOCK_TRADER_MAX_DISCOVERY_PROMOTIONS ?? cfg?.maxPromotions ?? 5)
  const maxPromotions = Number.isInteger(rawMax) && rawMax >= 1 && rawMax <= 15 ? rawMax : 5
  return { enabled, maxPromotions }
}

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
  accountant = calculateFifoAccounting,
  externalEvidenceRegistry = null,
  discoveryPromoter = resolveTradableDiscoveryPromotions
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

  // Optional Dynamic Universe Expansion: promotes top beyond-watchlist discoveries
  // strictly verified against the live paper_daily execution feed (engine.getDailyBars).
  const dynamicCfg = resolveDynamicDiscoveryConfig(bot, env)
  let discoveryExpansion = {
    enabled: dynamicCfg.enabled,
    maxPromotions: dynamicCfg.maxPromotions,
    promotedSymbols: [],
    deferredSymbols: []
  }
  const baseSymbols = bot.config.universe.symbols
  let effectiveSymbols = baseSymbols
  let promotedMetaMap = new Map()

  if (dynamicCfg.enabled && typeof discoveryPromoter === 'function') {
    const promotion = await discoveryPromoter({
      engine,
      prismaClient,
      evidenceRegistry: externalEvidenceRegistry,
      session: asOfSession,
      baseSymbols,
      heldSymbols,
      maxPromotions: dynamicCfg.maxPromotions
    })
    const promotedList = Array.isArray(promotion?.promoted) ? promotion.promoted : []
    const promotedSymbols = promotedList.map(p => p.symbol)
    promotedMetaMap = new Map(promotedList.map(p => [p.symbol, p]))
    effectiveSymbols = [...new Set([...baseSymbols, ...promotedSymbols])]
    discoveryExpansion = {
      enabled: true,
      maxPromotions: dynamicCfg.maxPromotions,
      promotedSymbols,
      deferredSymbols: Array.isArray(promotion?.deferred) ? promotion.deferred.map(d => d.symbol) : []
    }
  }

  const shortlistLimit = Math.min(25, 15 + discoveryExpansion.promotedSymbols.length)
  const screening = await screenAiStockUniverse({
    engine,
    session: asOfSession,
    symbols: effectiveSymbols,
    heldSymbols,
    shortlistLimit
  })

  // Ensure verified promoted discoveries remain in the shortlist with provenance tags
  if (promotedMetaMap.size > 0) {
    for (const item of screening.shortlist) {
      const meta = promotedMetaMap.get(item.symbol)
      if (meta) {
        item.promotedByDiscovery = true
        item.discoverySector = meta.sector
        item.discoveryTheme = meta.theme
        item.discoveryScore = meta.discoveryScore
      }
    }
  }

  if (!screening.eligibleCount && !heldSymbols.length) {
    return { ok: true, skipped: true, reason: 'no_eligible_research_candidates', screening, discoveryExpansion, fills }
  }
  const portfolioSnapshot = await loadStockTraderPaperPortfolio({
    bot, screening, prismaClient, fillLoader: async () => existingFills, accountant
  })
  const governor = usageGovernor || createAiUsageGovernor({ prismaClient, env })
  const research = await runStockTraderResearch({
    bot, portfolio, screening, portfolioSnapshot, prismaClient, provider, usageGovernor: governor, engine, externalEvidenceRegistry
  })
  if (!research.ok) {
    return { ok: true, skipped: true, reason: research.reason, screening, discoveryExpansion, research, fills }
  }
  const orders = await queueStockTraderPaperOrders({
    bot, portfolio, research, screening, portfolioSnapshot, prismaClient,
    ...(riskEvaluator ? { riskEvaluator } : {})
  })
  return {
    ok: true, asOfSession, botId: bot.id,
    screening: {
      universeSize: screening.universeSize,
      eligibleCount: screening.eligibleCount,
      shortlist: screening.shortlist.map(s => s.symbol),
      discoveryExpansion
    },
    research: { eventId: research.eventId, cached: research.cached, decisionsCount: research.decision.decisions.length },
    orders, fills
  }
}
