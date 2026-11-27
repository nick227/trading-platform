/**
 * Intelligent Portfolio Management Service.
 *
 * Continuously evaluates paper holdings, sector and single-name concentration,
 * changing investment theses, protective exit proximity, and risk-validated
 * allocation adjustments strictly within deterministic risk limits.
 *
 * Read-only advisory evaluation: never places orders or overrides risk caps.
 */
import prisma from '../../loaders/prisma.js'
import { engineClient } from '../../clients/engine.js'
import { getExpectedCompletedExchangeSession } from '../../utils/marketCalendar.js'
import { calculateFifoAccounting, loadBotFills } from '../botAccountingService.js'
import { STOCK_TRADER_ACTIVE_ORDER_STATUSES, summarizeStockTraderReservations } from './stockTraderAccounting.js'
import { evaluateStockTraderPaperProposal } from './stockTraderRiskPolicy.js'
import { scoreStockBars } from './stockScreener.js'
import { createProductionExternalEvidenceRegistry } from './evidence/productionEvidenceFetchers.js'
import { describeUniverseSymbol } from './stockUniverseCatalog.js'
import { createBroadBarsEngine, discoverAutonomousOpportunities } from './stockDiscoveryService.js'
import { AI_STOCK_TRADER_PLATFORM_BOT_ID } from './strategies/aiStockTraderStrategy.js'

const DAY_MS = 86_400_000
const round = (n, d = 2) => Number.isFinite(Number(n)) ? Number(Number(n).toFixed(d)) : 0

export function evaluateHoldingThesisHealth({
  returnPct,
  weightPct,
  maxPositionPct = 20,
  stopLossPct = null,
  takeProfitPct = null,
  indicators = null,
  latestAiDecision = null
}) {
  if (latestAiDecision?.action === 'SELL') {
    return {
      status: 'action_required',
      label: 'Thesis invalidated (AI SELL)',
      reason: `Latest AI research cycle issued SELL: ${latestAiDecision.thesis || 'thesis no longer supported'}.`
    }
  }
  if (stopLossPct && returnPct <= -stopLossPct) {
    return {
      status: 'action_required',
      label: 'Stop threshold crossed',
      reason: `Position return (${round(returnPct, 2)}%) breached the -${round(stopLossPct, 2)}% close-triggered stop threshold.`
    }
  }
  if (takeProfitPct && returnPct >= takeProfitPct) {
    return {
      status: 'action_required',
      label: 'Profit target reached',
      reason: `Position return (+${round(returnPct, 2)}%) reached the +${round(takeProfitPct, 2)}% take-profit threshold.`
    }
  }
  if (weightPct > maxPositionPct + 2) {
    return {
      status: 'action_required',
      label: 'Over position cap',
      reason: `Position weight (${round(weightPct, 1)}%) appreciated past the ${round(maxPositionPct, 1)}% single-stock limit.`
    }
  }
  if (stopLossPct && returnPct <= -(stopLossPct - 1.25)) {
    return {
      status: 'weakening',
      label: 'Near stop threshold',
      reason: `Within ${round(returnPct - (-stopLossPct), 2)}% of protective stop (-${round(stopLossPct, 2)}%).`
    }
  }
  if (indicators && indicators.excess20Pct < -2.5) {
    return {
      status: 'weakening',
      label: 'Momentum weakening',
      reason: `Trading ${round(indicators.excess20Pct, 2)}% below its 20-day moving average; monitor thesis durability.`
    }
  }
  if (returnPct >= 2 && indicators && indicators.excess20Pct > 0 && indicators.excess50Pct > 0) {
    return {
      status: 'strengthening',
      label: 'Thesis strengthening',
      reason: `Up +${round(returnPct, 2)}% from cost basis with constructive trend above 20d and 50d averages.`
    }
  }
  return {
    status: 'intact',
    label: 'Thesis intact',
    reason: 'Price action and position sizing remain within expected thesis and risk parameters.'
  }
}

export function computeConcentrationMetrics({ positions = [], totalEquity = 10000, maxPositionPct = 20 }) {
  const safeEquity = totalEquity > 0 ? totalEquity : 10000
  const sectorMap = new Map()
  let hhiSum = 0
  const alerts = []

  for (const pos of positions) {
    const weightPct = pos.marketValue != null ? round((pos.marketValue / safeEquity) * 100, 2) : 0
    const share = weightPct / 100
    hhiSum += share * share

    if (!sectorMap.has(pos.sector)) {
      sectorMap.set(pos.sector, { sector: pos.sector, marketValue: 0, weightPct: 0, symbols: [] })
    }
    const bucket = sectorMap.get(pos.sector)
    bucket.marketValue = round(bucket.marketValue + (pos.marketValue || 0), 2)
    bucket.symbols.push(pos.symbol)

    if (weightPct > maxPositionPct) {
      alerts.push({
        severity: 'high',
        code: 'position_over_cap',
        symbol: pos.symbol,
        message: `${pos.symbol} represents ${weightPct}% of paper equity, exceeding the ${maxPositionPct}% single-position cap.`
      })
    } else if (weightPct >= maxPositionPct * 0.85) {
      alerts.push({
        severity: 'medium',
        code: 'position_near_cap',
        symbol: pos.symbol,
        message: `${pos.symbol} is at ${weightPct}% of paper equity, approaching the ${maxPositionPct}% single-position cap.`
      })
    }
  }

  const sectorExposure = [...sectorMap.values()]
    .map(s => ({
      ...s,
      weightPct: round((s.marketValue / safeEquity) * 100, 2)
    }))
    .sort((a, b) => b.weightPct - a.weightPct)

  for (const sec of sectorExposure) {
    if (sec.weightPct > 35) {
      alerts.push({
        severity: 'medium',
        code: 'sector_concentration',
        sector: sec.sector,
        message: `${sec.sector} accounts for ${sec.weightPct}% of total equity (${sec.symbols.join(', ')}); consider cross-sector diversification.`
      })
    }
  }

  return {
    hhi: round(hhiSum, 4),
    diversificationStatus: positions.length === 0
      ? 'all_cash'
      : alerts.some(a => a.severity === 'high')
        ? 'concentrated'
        : alerts.length > 0
          ? 'watch'
          : 'balanced',
    sectorExposure,
    alerts
  }
}

export async function evaluatePaperPortfolioIntelligence({
  botId = AI_STOCK_TRADER_PLATFORM_BOT_ID,
  prismaClient = prisma,
  engine = engineClient,
  evidenceRegistry = null,
  fillLoader = loadBotFills,
  accountant = calculateFifoAccounting,
  discoveryProvider = discoverAutonomousOpportunities,
  session = null,
  now = new Date()
} = {}) {
  const bot = await prismaClient.bot.findUnique({ where: { id: botId } })
  if (!bot || bot.deletedAt) {
    return { status: 'not_initialized', botId, simulated: true }
  }

  const allocatedCapital = Number(bot.config?.allocatedAmount) > 0 ? Number(bot.config.allocatedAmount) : 10000
  const executionLimits = {
    maxPositionPct: Number(bot.config?.execution?.maxPositionPct) || 0.20,
    maxOrderNotional: Number(bot.config?.execution?.maxOrderNotional) || 2000,
    maxOrdersPerCycle: Number(bot.config?.execution?.maxOrdersPerCycle) || 2
  }
  const maxPositionPctWhole = round(executionLimits.maxPositionPct * 100, 1)

  const barsEngine = createBroadBarsEngine(engine)
  const expectedSession = session || getExpectedCompletedExchangeSession(now)

  const [fills, activeOrders, recentDecisionEvents] = await Promise.all([
    fillLoader(bot.id, { prismaClient }),
    prismaClient.execution.findMany({
      where: {
        botId: bot.id,
        status: { in: STOCK_TRADER_ACTIVE_ORDER_STATUSES }
      }
    }),
    prismaClient.botEvent.findMany({
      where: { botId: bot.id, type: 'decision_made' },
      orderBy: { createdAt: 'desc' },
      take: 20
    })
  ])

  const prelim = accountant(fills)
  const heldTickers = Object.keys(prelim.openPositions || {})
    .filter(sym => Number(prelim.openPositions[sym]?.quantity) > 0)
    .sort()

  // Resolve entry audits for open lots to inspect entry thesis and exitRule thresholds
  const lotIds = heldTickers.flatMap(sym => (prelim.openPositions[sym]?.lots || []).map(l => l.id)).filter(Boolean)
  const entryAudits = lotIds.length && prismaClient.executionAudit?.findMany
    ? await prismaClient.executionAudit.findMany({
        where: { executionId: { in: lotIds }, eventType: 'execution_created' },
        orderBy: { createdAt: 'desc' }
      })
    : []
  const auditByExecId = new Map()
  for (const aud of entryAudits) {
    if (!auditByExecId.has(aud.executionId)) auditByExecId.set(aud.executionId, aud)
  }

  // Map latest AI decisions per symbol
  const latestAiBySymbol = new Map()
  for (const ev of recentDecisionEvents) {
    const decs = ev.metadata?.decision?.decisions
    if (ev.metadata?.status !== 'completed' || !Array.isArray(decs)) continue
    for (const d of decs) {
      if (d?.symbol && !latestAiBySymbol.has(d.symbol)) {
        latestAiBySymbol.set(d.symbol, {
          asOfSession: ev.metadata.decision.asOfSession,
          action: d.action,
          confidence: Number.isFinite(Number(d.confidence)) ? Number(d.confidence) : null,
          thesis: d.thesis || null
        })
      }
    }
  }

  // Market regime & technicals for held symbols
  const lookbackStart = new Date(Date.parse(expectedSession + 'T00:00:00Z') - 150 * DAY_MS).toISOString().slice(0, 10)
  let asOfSession = expectedSession
  let marketRegime = { regime: 'unknown', spyReturn20dPct: 0, spyExcess20Pct: 0, spyExcess50Pct: 0 }
  try {
    const spyBars = await barsEngine.getDailyBars('SPY', lookbackStart, expectedSession)
    const lastDate = spyBars?.bars?.at(-1)?.[0]
    if (lastDate) asOfSession = lastDate
    const spyScored = scoreStockBars('SPY', spyBars?.bars || [], asOfSession)
    if (spyScored.eligible) {
      const ind = spyScored.indicators
      marketRegime = {
        regime: ind.excess20Pct > 0 && ind.excess50Pct > 0 ? 'constructive' : ind.excess50Pct < 0 ? 'defensive' : 'cautious',
        spyReturn20dPct: ind.return20dPct,
        spyExcess20Pct: ind.excess20Pct,
        spyExcess50Pct: ind.excess50Pct
      }
    }
  } catch {
    // Keep default regime if bars unavailable
  }

  const currentPrices = {}
  const indicatorsBySymbol = new Map()
  await Promise.all(heldTickers.map(async sym => {
    try {
      const barsRes = await barsEngine.getDailyBars(sym, lookbackStart, asOfSession)
      const scored = scoreStockBars(sym, barsRes?.bars || [], asOfSession)
      if (scored.eligible) {
        currentPrices[sym] = scored.indicators.price
        indicatorsBySymbol.set(sym, scored.indicators)
        return
      }
    } catch {
      // Fallback to getSessionClose
    }
    try {
      const close = await engine.getSessionClose(sym, asOfSession)
      if (Number(close?.close) > 0) currentPrices[sym] = Number(close.close)
    } catch {
      // Unpriced position handled conservatively
    }
  }))

  const accounting = accountant(fills, { currentPrices })
  let netCashFlow = 0
  for (const f of fills) {
    const qty = Number(f.filledQuantity ?? f.quantity ?? 0)
    const px = Number(f.filledPrice ?? f.price ?? 0)
    const fees = Number(f.fees ?? 0) + Number(f.commission ?? 0)
    const dir = String(f.direction || '').toLowerCase()
    if (dir === 'buy') netCashFlow -= (qty * px + fees)
    else if (dir === 'sell') netCashFlow += (qty * px - fees)
  }
  const cash = round(Math.max(0, allocatedCapital + netCashFlow), 2)
  const reservations = summarizeStockTraderReservations(activeOrders)
  const availableCash = round(Math.max(0, cash - reservations.totalBuyNotional), 2)

  // Fetch fresh qualitative disclosures on held symbols
  const disclosuresBySymbol = new Map(heldTickers.map(s => [s, []]))
  if (heldTickers.length > 0) {
    try {
      const activeReg = evidenceRegistry || createProductionExternalEvidenceRegistry()
      const evSnap = await activeReg.assemble({
        sourceIds: ['news', 'filings'],
        asOfSession,
        maxItems: 20,
        input: { portfolio: { positions: heldTickers.map(symbol => ({ symbol })) } }
      })
      for (const rec of evSnap.records || []) {
        const issuer = rec.content?.data?.issuer
        if (issuer && disclosuresBySymbol.has(issuer)) {
          disclosuresBySymbol.get(issuer).push({
            id: rec.id,
            sourceId: rec.sourceId,
            filingType: rec.content?.data?.filingType || null,
            title: rec.title,
            summary: rec.content?.text || (typeof rec.content === 'string' ? rec.content : rec.title),
            publishedAt: rec.publishedAt,
            url: rec.url
          })
        }
      }
    } catch {
      // Non-fatal
    }
  }

  const rawOpenPositions = Object.values(accounting.openPositions || {}).filter(p => Number(p.quantity) > 0)
  const investedValue = round(rawOpenPositions.reduce((sum, p) => {
    const px = currentPrices[p.ticker]
    return sum + (Number.isFinite(px) ? p.quantity * px : p.quantity * p.avgPrice)
  }, 0), 2)
  const totalEquity = round(cash + investedValue, 2)

  const holdings = rawOpenPositions.map(p => {
    const meta = describeUniverseSymbol(p.ticker)
    const currentPrice = Number.isFinite(currentPrices[p.ticker]) ? currentPrices[p.ticker] : null
    const marketValue = currentPrice != null ? round(p.quantity * currentPrice, 2) : null
    const weightPct = marketValue != null && totalEquity > 0 ? round((marketValue / totalEquity) * 100, 2) : 0
    const returnPct = currentPrice != null && p.avgPrice > 0 ? round(((currentPrice - p.avgPrice) / p.avgPrice) * 100, 2) : 0

    // Extract entry thesis & protective exitRule from open lot audits
    const lotAudits = (p.lots || []).map(l => auditByExecId.get(l.id)).filter(Boolean)
    const primaryAudit = lotAudits[0]?.metadata || null
    const stopLossPct = Number(primaryAudit?.exitRule?.stopLossPct) > 0 ? Number(primaryAudit.exitRule.stopLossPct) : null
    const takeProfitPct = Number(primaryAudit?.exitRule?.takeProfitPct) > 0 ? Number(primaryAudit.exitRule.takeProfitPct) : null
    const stopPrice = stopLossPct ? round(p.avgPrice * (1 - stopLossPct / 100), 2) : null
    const takeProfitPrice = takeProfitPct ? round(p.avgPrice * (1 + takeProfitPct / 100), 2) : null

    const indicators = indicatorsBySymbol.get(p.ticker) || null
    const latestAiDecision = latestAiBySymbol.get(p.ticker) || null
    const thesisHealth = evaluateHoldingThesisHealth({
      returnPct,
      weightPct,
      maxPositionPct: maxPositionPctWhole,
      stopLossPct,
      takeProfitPct,
      indicators,
      latestAiDecision
    })

    return {
      symbol: p.ticker,
      name: meta.name,
      sector: meta.sector,
      quantity: p.quantity,
      averageCost: round(p.avgPrice, 2),
      currentPrice,
      marketValue,
      weightPct,
      unrealizedPnl: p.unrealizedPnl != null ? round(p.unrealizedPnl, 2) : null,
      returnPct,
      entryThesis: primaryAudit?.thesis || latestAiDecision?.thesis || null,
      protectiveRules: {
        stopLossPct,
        takeProfitPct,
        stopPrice,
        takeProfitPrice,
        distanceToStopPct: stopLossPct != null ? round(returnPct - (-stopLossPct), 2) : null,
        distanceToTakeProfitPct: takeProfitPct != null ? round(takeProfitPct - returnPct, 2) : null
      },
      thesisHealth,
      latestAiDecision,
      recentDisclosures: (disclosuresBySymbol.get(p.ticker) || []).slice(0, 2)
    }
  }).sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))

  const concentration = computeConcentrationMetrics({
    positions: holdings,
    totalEquity,
    maxPositionPct: maxPositionPctWhole
  })

  const cashWeightPct = totalEquity > 0 ? round((cash / totalEquity) * 100, 2) : 100
  if (cashWeightPct >= 70 && marketRegime.regime === 'constructive') {
    concentration.alerts.push({
      severity: 'low',
      code: 'high_cash_reserve',
      message: `${cashWeightPct}% of paper equity is idle in cash during a constructive market regime.`
    })
  }

  // Build deterministic risk-validated allocation adjustment proposals
  const portfolioForRiskCheck = {
    allocatedCapital: Math.max(allocatedCapital, totalEquity),
    cash,
    positions: holdings.filter(h => h.marketValue != null).map(h => ({
      symbol: h.symbol,
      quantity: h.quantity,
      marketValue: h.marketValue
    }))
  }

  const proposals = []

  // 1. Evaluate exits or trims on existing holdings
  for (const h of holdings) {
    if (!h.currentPrice) continue
    if (h.thesisHealth.status === 'action_required') {
      const check = evaluateStockTraderPaperProposal({
        intent: { symbol: h.symbol, action: 'SELL' },
        price: h.currentPrice,
        portfolio: portfolioForRiskCheck,
        activeOrders,
        executionLimits
      })
      if (check.allowed) {
        proposals.push({
          type: 'EXIT_POSITION',
          action: 'SELL',
          symbol: h.symbol,
          sector: h.sector,
          quantity: check.quantity,
          estimatedNotional: round(check.notional, 2),
          currentWeightPct: h.weightPct,
          targetWeightPct: 0,
          riskPolicyVerified: true,
          rationale: h.thesisHealth.reason
        })
      }
    } else if (h.thesisHealth.status === 'strengthening' && h.weightPct < maxPositionPctWhole * 0.65) {
      const targetAlloc = Math.min(executionLimits.maxPositionPct, round((h.weightPct + 6) / 100, 3))
      const check = evaluateStockTraderPaperProposal({
        intent: { symbol: h.symbol, action: 'BUY', confidence: 0.78, targetAllocationPct: targetAlloc },
        price: h.currentPrice,
        portfolio: portfolioForRiskCheck,
        activeOrders,
        executionLimits
      })
      if (check.allowed) {
        proposals.push({
          type: 'ADD_TO_WINNER',
          action: 'BUY',
          symbol: h.symbol,
          sector: h.sector,
          quantity: check.quantity,
          estimatedNotional: round(check.notional, 2),
          currentWeightPct: h.weightPct,
          targetWeightPct: round(((h.marketValue + check.notional) / totalEquity) * 100, 1),
          riskPolicyVerified: true,
          rationale: `${h.symbol} thesis is strengthening (+${h.returnPct}% return) with ${round(maxPositionPctWhole - h.weightPct, 1)}% headroom under the ${maxPositionPctWhole}% position cap.`
        })
      }
    }
  }

  // 2. If deployable cash >= $1,000 and proposals < 3, suggest sector-diversifying discoveries
  if (availableCash >= 1000 && proposals.length < 3 && typeof discoveryProvider === 'function') {
    try {
      const disc = await discoveryProvider({ engine, prismaClient, evidenceRegistry, session: asOfSession, limit: 12 })
      const heldSet = new Set(holdings.map(h => h.symbol))
      const overexposedSectors = new Set(
        concentration.sectorExposure.filter(s => s.weightPct >= 30).map(s => s.sector)
      )
      for (const cand of disc?.discoveries || []) {
        if (proposals.length >= 3) break
        if (heldSet.has(cand.symbol)) continue
        if (overexposedSectors.has(cand.sector)) continue
        if (!(cand.indicators?.price > 0) || cand.rs20dPct <= 0) continue

        const targetAlloc = Math.min(executionLimits.maxPositionPct, 0.15)
        const check = evaluateStockTraderPaperProposal({
          intent: { symbol: cand.symbol, action: 'BUY', confidence: 0.75, targetAllocationPct: targetAlloc },
          price: cand.indicators.price,
          portfolio: portfolioForRiskCheck,
          activeOrders,
          executionLimits
        })
        if (check.allowed) {
          proposals.push({
            type: 'DIVERSIFY_CASH',
            action: 'BUY',
            symbol: cand.symbol,
            name: cand.name,
            sector: cand.sector,
            quantity: check.quantity,
            estimatedNotional: round(check.notional, 2),
            currentWeightPct: 0,
            targetWeightPct: round((check.notional / totalEquity) * 100, 1),
            riskPolicyVerified: true,
            rationale: `Deploys idle paper cash into underrepresented ${cand.sector} leader (${cand.themeLabel}, +${cand.rs20dPct}% 20d vs SPY) within $${executionLimits.maxOrderNotional} order cap.`
          })
        }
      }
    } catch {
      // Discovery suggestions are optional enrichment
    }
  }

  return {
    status: 'ready',
    simulated: true,
    botId: bot.id,
    asOfSession,
    marketRegime,
    summary: {
      allocatedCapital,
      totalEquity,
      cash,
      availableCash,
      reservedBuyCash: round(reservations.totalBuyNotional, 2),
      investedValue,
      cashWeightPct,
      grossExposurePct: totalEquity > 0 ? round((investedValue / totalEquity) * 100, 2) : 0,
      openPositionsCount: holdings.length,
      maxPositionPct: maxPositionPctWhole,
      maxOrderNotional: executionLimits.maxOrderNotional
    },
    concentration,
    holdings,
    allocationProposals: proposals
  }
}
