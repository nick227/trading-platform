/**
 * Cross-Strategy Leaderboard Service.
 *
 * Ranks rule-based platform strategies, Research Partner forward paper strategies,
 * and the Flagship AI Stock Trader side-by-side on standardized risk-adjusted
 * metrics, drawdowns, excess benchmark returns, and explicit sample-size tiers.
 *
 * Never conflates historical backtests with live forward paper trading: every row
 * declares its exact evaluation horizon, and pending/untraded strategies receive
 * `rank: null` instead of synthetic 0% rankings.
 */
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'
import { listPublicStrategies } from './strategyEvidenceService.js'
import { evaluateAiPerformanceIntelligence } from './ai/aiPerformanceIntelligenceService.js'
import { calculateFifoAccounting, loadBotFills } from './botAccountingService.js'
import { AI_STOCK_TRADER_PLATFORM_BOT_ID, AI_STOCK_TRADER_STRATEGY_ID } from './ai/strategies/aiStockTraderStrategy.js'

const DAY_MS = 86_400_000
const round = (n, d = 2) => (n !== null && n !== undefined && Number.isFinite(Number(n)) ? Number(Number(n).toFixed(d)) : null)

export const LEADERBOARD_TRACKS = Object.freeze([
  {
    id: 'overview',
    label: 'All Strategies (Best Verified Horizon)',
    description: 'Displays every strategy alongside its primary verified evidence horizon (Forward Paper for autonomous AI and Research Partner strategies; standardized 5Y/1Y backtests for rule-based templates).'
  },
  {
    id: 'forward',
    label: 'Forward Paper (Apples-to-Apples)',
    description: 'Strictly post-publication forward paper sessions across Flagship AI, Research Partner strategies, and published rule-based strategies.'
  },
  {
    id: '1Y',
    label: '1-Year Standardized Test',
    description: '1-year historical next-open simulation ($10,000 per symbol). Autonomous AI strategies remain marked Forward-Only to prevent historical prompt look-ahead.'
  },
  {
    id: '5Y',
    label: '5-Year Standardized Test',
    description: '5-year historical next-open simulation ($10,000 per symbol) across bull and bear market regimes.'
  }
])

export function computeRiskAdjustedScore(returnPct, maxDrawdownPct, tradesCount = 0) {
  if (returnPct === null || returnPct === undefined || !Number.isFinite(Number(returnPct))) return null
  if (!(tradesCount > 0)) return null
  const dd = maxDrawdownPct !== null && maxDrawdownPct !== undefined && Number.isFinite(Number(maxDrawdownPct))
    ? Math.max(0.5, Math.abs(Number(maxDrawdownPct)))
    : null
  if (dd === null) return null
  return round(Number(returnPct) / dd, 2)
}

export function classifySampleSize({ sessionsCount = 0, tradesCount = 0, symbolsTested = null }) {
  const s = Number(sessionsCount) || 0
  const t = Number(tradesCount) || 0
  if (t === 0) {
    return {
      tier: 'awaiting',
      label: 'Awaiting trades',
      sessionsCount: s,
      tradesCount: t,
      symbolsTested
    }
  }
  if (s >= 60 && t >= 10) {
    return {
      tier: 'substantive',
      label: 'Substantive sample',
      sessionsCount: s,
      tradesCount: t,
      symbolsTested
    }
  }
  if (s >= 15 && t >= 3) {
    return {
      tier: 'developing',
      label: 'Developing sample',
      sessionsCount: s,
      tradesCount: t,
      symbolsTested
    }
  }
  return {
    tier: 'early',
    label: 'Early sample',
    sessionsCount: s,
    tradesCount: t,
    symbolsTested
  }
}

function computePeakToTroughDrawdownFromFills(fills = [], allocatedCapital = 10000) {
  if (!Array.isArray(fills) || fills.length === 0) return 0
  let runningCash = allocatedCapital
  const heldQty = new Map()
  const lastPx = new Map()
  let peak = allocatedCapital
  let maxDdPct = 0

  for (const f of fills) {
    const sym = f.ticker
    const qty = Number(f.filledQuantity ?? f.quantity ?? 0)
    const px = Number(f.filledPrice ?? f.price ?? 0)
    const fees = Number(f.fees ?? 0) + Number(f.commission ?? 0)
    if (!(qty > 0) || !(px > 0) || !sym) continue
    const dir = String(f.direction || '').toLowerCase()
    if (dir === 'buy') {
      runningCash -= (qty * px + fees)
      heldQty.set(sym, (heldQty.get(sym) || 0) + qty)
    } else if (dir === 'sell') {
      runningCash += (qty * px - fees)
      heldQty.set(sym, Math.max(0, (heldQty.get(sym) || 0) - qty))
    }
    lastPx.set(sym, px)
    let mv = 0
    for (const [hSym, hQ] of heldQty.entries()) {
      if (hQ > 0) mv += hQ * (lastPx.get(hSym) || px)
    }
    const eq = runningCash + mv
    if (eq > peak) peak = eq
    if (peak > 0) {
      const dd = ((peak - eq) / peak) * 100
      if (dd > maxDdPct) maxDdPct = dd
    }
  }
  return round(maxDdPct, 2) ?? 0
}

export function rankLeaderboardEntries(entries = [], sortBy = 'risk_adjusted') {
  const evaluable = []
  const unranked = []

  for (const entry of entries) {
    if (entry.evaluationStatus === 'evaluated' && entry.returnPct !== null && (entry.sampleSize?.tradesCount || 0) > 0) {
      evaluable.push({ ...entry })
    } else {
      unranked.push({ ...entry, rank: null })
    }
  }

  evaluable.sort((a, b) => {
    if (sortBy === 'total_return') {
      return (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity) ||
        (b.riskAdjustedScore ?? -Infinity) - (a.riskAdjustedScore ?? -Infinity)
    }
    if (sortBy === 'excess_return') {
      return (b.excessVsBenchmarkPct ?? -Infinity) - (a.excessVsBenchmarkPct ?? -Infinity) ||
        (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity)
    }
    if (sortBy === 'lowest_drawdown') {
      const ddA = a.maxDrawdownPct ?? Infinity
      const ddB = b.maxDrawdownPct ?? Infinity
      return ddA - ddB || (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity)
    }
    // Default: risk_adjusted (Return / Max Drawdown ratio)
    return (b.riskAdjustedScore ?? -Infinity) - (a.riskAdjustedScore ?? -Infinity) ||
      (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity) ||
      (a.maxDrawdownPct ?? Infinity) - (b.maxDrawdownPct ?? Infinity)
  })

  const ranked = evaluable.map((item, index) => ({
    ...item,
    rank: index + 1
  }))

  return [...ranked, ...unranked]
}

function buildRuleStrategyEntry(strategy, track) {
  const isAiTemplate = strategy.tags?.includes('ai') || strategy.version?.backtestable === false
  let chosenWindowKey = track
  if (track === 'overview') {
    if (isAiTemplate) {
      chosenWindowKey = 'forward'
    } else if (strategy.windows?.forward?.status === 'ok' && strategy.windows.forward.symbolsTraded > 0) {
      chosenWindowKey = 'forward'
    } else if (strategy.windows?.['5Y']?.status === 'ok') {
      chosenWindowKey = '5Y'
    } else if (strategy.windows?.['1Y']?.status === 'ok') {
      chosenWindowKey = '1Y'
    } else {
      chosenWindowKey = 'forward'
    }
  }

  // On historical 1Y/5Y tracks, non-backtestable AI templates state why they are forward-only
  if ((track === '1Y' || track === '5Y') && isAiTemplate) {
    return {
      id: `platform:${strategy.templateId}`,
      name: strategy.name,
      category: 'ai_strategy',
      categoryLabel: 'Autonomous AI',
      href: `/strategies/${encodeURIComponent(strategy.templateId)}`,
      horizon: 'Forward-only',
      horizonType: 'forward_only',
      evaluationStatus: 'forward_only',
      statusNote: 'Evaluated strictly on post-publication forward paper sessions to prevent historical prompt look-ahead.',
      returnPct: null,
      benchmarkReturnPct: null,
      excessVsBenchmarkPct: null,
      maxDrawdownPct: null,
      worstSymbolDrawdownPct: null,
      winRatePct: null,
      riskAdjustedScore: null,
      sampleSize: classifySampleSize({ sessionsCount: 0, tradesCount: 0 })
    }
  }

  const w = strategy.windows?.[chosenWindowKey]
  const approxSessions = chosenWindowKey === '5Y' ? 1260 : chosenWindowKey === '1Y' ? 252 : 0
  const horizonLabel = chosenWindowKey === 'forward'
    ? 'Forward Paper'
    : chosenWindowKey === '5Y'
      ? 'Historical 5Y'
      : 'Historical 1Y'

  if (!w || w.status !== 'ok') {
    const statusNote = w?.status === 'awaiting_sessions'
      ? 'Awaiting qualifying forward paper sessions since publication.'
      : w?.reason || 'No completed evaluation results for this horizon yet.'
    return {
      id: `platform:${strategy.templateId}`,
      name: strategy.name,
      category: isAiTemplate ? 'ai_strategy' : 'rule_based',
      categoryLabel: isAiTemplate ? 'Autonomous AI' : 'Rule-Based',
      href: `/strategies/${encodeURIComponent(strategy.templateId)}`,
      horizon: horizonLabel,
      horizonType: chosenWindowKey === 'forward' ? 'forward_paper' : 'historical_backtest',
      evaluationStatus: 'pending',
      statusNote,
      returnPct: null,
      benchmarkReturnPct: null,
      excessVsBenchmarkPct: null,
      maxDrawdownPct: null,
      worstSymbolDrawdownPct: null,
      winRatePct: null,
      riskAdjustedScore: null,
      sampleSize: classifySampleSize({ sessionsCount: 0, tradesCount: 0, symbolsTested: w?.symbolsTested ?? null })
    }
  }

  const tradesCount = Number(w.trades) || 0
  const returnPct = tradesCount > 0 ? round(w.medianReturnPct, 2) : null
  const benchPct = round(w.medianBuyAndHoldPct, 2)
  const excessPct = returnPct !== null && benchPct !== null ? round(returnPct - benchPct, 2) : null
  const drawdownPct = tradesCount > 0 ? round(w.medianDrawdownPct ?? w.worstDrawdownPct ?? 0, 2) : null
  const worstDdPct = tradesCount > 0 ? round(w.worstDrawdownPct ?? drawdownPct, 2) : null

  return {
    id: `platform:${strategy.templateId}`,
    name: strategy.name,
    category: isAiTemplate ? 'ai_strategy' : 'rule_based',
    categoryLabel: isAiTemplate ? 'Autonomous AI' : 'Rule-Based',
    href: `/strategies/${encodeURIComponent(strategy.templateId)}`,
    horizon: horizonLabel,
    horizonType: chosenWindowKey === 'forward' ? 'forward_paper' : 'historical_backtest',
    evaluationStatus: tradesCount > 0 ? 'evaluated' : 'no_trades',
    statusNote: tradesCount > 0
      ? `Median across ${w.symbolsTested} standardized symbol tests (${w.beatBuyAndHold}/${w.symbolsTested} beat buy-and-hold).`
      : `Rules did not trigger any trades across ${w.symbolsTested} tested symbols in this window.`,
    returnPct,
    benchmarkReturnPct: benchPct,
    excessVsBenchmarkPct: excessPct,
    maxDrawdownPct: drawdownPct,
    worstSymbolDrawdownPct: worstDdPct,
    winRatePct: null,
    riskAdjustedScore: computeRiskAdjustedScore(returnPct, drawdownPct, tradesCount),
    sampleSize: classifySampleSize({
      sessionsCount: approxSessions,
      tradesCount,
      symbolsTested: w.symbolsTested
    })
  }
}

async function buildFlagshipLeaderboardEntry({ track, prismaClient, engine, fillLoader, perfEvaluator }) {
  if (track === '1Y' || track === '5Y') {
    return {
      id: 'flagship:bot_platform_ai_stock_trader_v1',
      name: 'Flagship AI Stock Trader v2',
      category: 'flagship_ai',
      categoryLabel: 'Flagship AI',
      href: '/ai-stock-trader',
      horizon: 'Forward-only',
      horizonType: 'forward_only',
      evaluationStatus: 'forward_only',
      statusNote: 'Evaluated strictly on live forward paper sessions (net of LLM token costs) to prevent historical look-ahead bias.',
      returnPct: null,
      benchmarkReturnPct: null,
      excessVsBenchmarkPct: null,
      maxDrawdownPct: null,
      worstSymbolDrawdownPct: null,
      winRatePct: null,
      riskAdjustedScore: null,
      sampleSize: classifySampleSize({ sessionsCount: 0, tradesCount: 0 })
    }
  }

  const [perf, fills] = await Promise.all([
    perfEvaluator({ botId: AI_STOCK_TRADER_PLATFORM_BOT_ID, prismaClient, engine, fillLoader }).catch(() => null),
    fillLoader(AI_STOCK_TRADER_PLATFORM_BOT_ID, { prismaClient }).catch(() => [])
  ])

  if (!perf || perf.status === 'not_initialized' || perf.status === 'awaiting_activity' || !fills.length) {
    return {
      id: 'flagship:bot_platform_ai_stock_trader_v1',
      name: 'Flagship AI Stock Trader v2',
      category: 'flagship_ai',
      categoryLabel: 'Flagship AI',
      href: '/ai-stock-trader',
      horizon: 'Forward Paper',
      horizonType: 'forward_paper',
      evaluationStatus: 'pending',
      statusNote: 'Initialized in paper mode; awaiting live scheduled forward fills.',
      returnPct: null,
      benchmarkReturnPct: perf?.comparison?.spyReturnPct ?? null,
      excessVsBenchmarkPct: null,
      maxDrawdownPct: null,
      worstSymbolDrawdownPct: null,
      winRatePct: null,
      riskAdjustedScore: null,
      sampleSize: classifySampleSize({
        sessionsCount: perf?.window?.activeSessionsCount ?? 0,
        tradesCount: 0
      })
    }
  }

  const allocatedCapital = perf.comparison?.allocatedCapital || 10000
  const maxDrawdownPct = computePeakToTroughDrawdownFromFills(fills, allocatedCapital)
  const returnPct = round(perf.comparison?.aiNetReturnPct, 2)
  const tradesCount = Number(perf.decisionQuality?.filledExecutionsCount ?? fills.length)
  const sessionsCount = Number(perf.window?.activeSessionsCount ?? 0)

  return {
    id: 'flagship:bot_platform_ai_stock_trader_v1',
    name: 'Flagship AI Stock Trader v2',
    category: 'flagship_ai',
    categoryLabel: 'Flagship AI',
    href: '/ai-stock-trader',
    horizon: `Forward Paper (${sessionsCount}d)`,
    horizonType: 'forward_paper',
    evaluationStatus: tradesCount > 0 ? 'evaluated' : 'pending',
    statusNote: `Net of $${(perf.comparison?.modelCostUsd ?? 0).toFixed(4)} settled LLM API spend across ${perf.decisionQuality?.completedCyclesCount ?? 0} research cycle(s).`,
    returnPct,
    benchmarkReturnPct: round(perf.comparison?.spyReturnPct, 2),
    excessVsBenchmarkPct: round(perf.comparison?.excessVsSpyPctPoints, 2),
    maxDrawdownPct,
    worstSymbolDrawdownPct: maxDrawdownPct,
    winRatePct: round(perf.decisionQuality?.winRatePct, 1),
    riskAdjustedScore: computeRiskAdjustedScore(returnPct, maxDrawdownPct, tradesCount),
    sampleSize: classifySampleSize({ sessionsCount, tradesCount })
  }
}

async function buildResearchPartnerForwardEntries({ track, prismaClient, engine }) {
  if (!prismaClient?.researchPaperActivation?.findMany) return []
  let activations = []
  try {
    activations = await prismaClient.researchPaperActivation.findMany({
      include: { strategy: true },
      orderBy: { updatedAt: 'desc' },
      take: 25
    })
  } catch {
    return []
  }

  if (!activations.length) return []

  if (track === '1Y' || track === '5Y') {
    return activations.map(act => ({
      id: `rp:${act.strategyId}`,
      name: `Research Partner · ${act.strategy?.name || 'Custom Strategy'} (v${act.version})`,
      category: 'research_partner',
      categoryLabel: 'Research Partner',
      href: '/research-partners',
      horizon: 'Forward-only',
      horizonType: 'forward_only',
      evaluationStatus: 'forward_only',
      statusNote: 'User-mandated Research Partner strategy tracked on post-approval forward paper sessions.',
      returnPct: null,
      benchmarkReturnPct: null,
      excessVsBenchmarkPct: null,
      maxDrawdownPct: null,
      worstSymbolDrawdownPct: null,
      winRatePct: null,
      riskAdjustedScore: null,
      sampleSize: classifySampleSize({ sessionsCount: 0, tradesCount: 0 })
    }))
  }

  // Fetch SPY bars once if needed to compute benchmark comparison for active RP forward runs
  let spyBars = []
  const earliestInit = activations.map(a => a.initialSession).filter(Boolean).sort()[0]
  const latestEnd = activations.map(a => a.lastSession).filter(Boolean).sort().at(-1)
  if (earliestInit && latestEnd && typeof engine?.getDailyBars === 'function') {
    const from = new Date(Date.parse(earliestInit + 'T00:00:00Z') - 10 * DAY_MS).toISOString().slice(0, 10)
    const res = await engine.getDailyBars('SPY', from, latestEnd).catch(() => null)
    spyBars = Array.isArray(res?.bars) ? res.bars : []
  }

  return activations.map(act => {
    const state = act.state && typeof act.state === 'object' ? act.state : {}
    const initialCapital = Number(state.initialCapital) > 0 ? Number(state.initialCapital) : 10000
    const curve = Array.isArray(state.equityCurve) ? state.equityCurve : []
    const fills = Array.isArray(state.fills) ? state.fills : []
    const sessionsCount = curve.length
    const tradesCount = fills.length
    const endingEquity = Number(curve.at(-1)?.equity ?? initialCapital)
    const returnPct = sessionsCount > 0 && tradesCount > 0
      ? round(((endingEquity / initialCapital) - 1) * 100, 2)
      : null
    const maxDrawdownPct = tradesCount > 0 ? round(Number(state.maxDrawdownPct ?? 0), 2) : null

    let spyReturnPct = null
    if (act.initialSession && act.lastSession && spyBars.length > 0) {
      const startBar = spyBars.find(b => b[0] >= act.initialSession)
      const endBar = [...spyBars].reverse().find(b => b[0] <= act.lastSession)
      if (startBar?.[4] > 0 && endBar?.[4] > 0) {
        spyReturnPct = round(((endBar[4] - startBar[4]) / startBar[4]) * 100, 2)
      }
    }

    const fifo = fills.length > 0 ? calculateFifoAccounting(fills) : null
    const closedTrades = Number(fifo?.performance?.closedTrades ?? 0)
    const rawWin = fifo?.performance?.winRate
    const winRatePct = rawWin != null && closedTrades > 0
      ? round(Number(rawWin) <= 1 ? Number(rawWin) * 100 : Number(rawWin), 1)
      : null

    return {
      id: `rp:${act.strategyId}`,
      name: `Research Partner · ${act.strategy?.name || 'Custom Strategy'} (v${act.version})`,
      category: 'research_partner',
      categoryLabel: 'Research Partner',
      href: '/research-partners',
      horizon: sessionsCount > 0 ? `Forward Paper (${sessionsCount}d)` : 'Forward Paper',
      horizonType: 'forward_paper',
      evaluationStatus: tradesCount > 0 && sessionsCount > 0 ? 'evaluated' : 'pending',
      statusNote: tradesCount > 0
        ? `Forward paper run (${act.status}) since ${act.initialSession}.`
        : `Approved forward paper strategy (${act.status}); awaiting qualifying entry signals.`,
      returnPct,
      benchmarkReturnPct: spyReturnPct,
      excessVsBenchmarkPct: returnPct !== null && spyReturnPct !== null ? round(returnPct - spyReturnPct, 2) : null,
      maxDrawdownPct,
      worstSymbolDrawdownPct: maxDrawdownPct,
      winRatePct,
      riskAdjustedScore: computeRiskAdjustedScore(returnPct, maxDrawdownPct, tradesCount),
      sampleSize: classifySampleSize({ sessionsCount, tradesCount })
    }
  })
}

export async function buildCrossStrategyLeaderboard({
  track = 'overview',
  category = 'all',
  sortBy = 'risk_adjusted',
  prismaClient = prisma,
  engine = engineClient,
  publicStrategiesLoader = listPublicStrategies,
  perfEvaluator = evaluateAiPerformanceIntelligence,
  fillLoader = loadBotFills
} = {}) {
  const validTrack = LEADERBOARD_TRACKS.some(t => t.id === track) ? track : 'overview'
  const validSort = ['risk_adjusted', 'total_return', 'excess_return', 'lowest_drawdown'].includes(sortBy)
    ? sortBy
    : 'risk_adjusted'

  const [publicStrategies, flagshipEntry, rpEntries] = await Promise.all([
    publicStrategiesLoader({ prismaClient }),
    buildFlagshipLeaderboardEntry({ track: validTrack, prismaClient, engine, fillLoader, perfEvaluator }),
    buildResearchPartnerForwardEntries({ track: validTrack, prismaClient, engine })
  ])

  const ruleAndAiEntries = (Array.isArray(publicStrategies) ? publicStrategies : [])
    .filter(s => s.templateId !== AI_STOCK_TRADER_STRATEGY_ID) // Represented by rich Flagship entry
    .map(s => buildRuleStrategyEntry(s, validTrack))

  let combined = [flagshipEntry, ...rpEntries, ...ruleAndAiEntries].filter(Boolean)
  if (category && category !== 'all') {
    combined = combined.filter(e => e.category === category)
  }

  const ranked = rankLeaderboardEntries(combined, validSort)
  const evaluatedCount = ranked.filter(e => e.rank !== null).length

  return {
    track: validTrack,
    sortBy: validSort,
    category: category || 'all',
    generatedAt: new Date().toISOString(),
    tracks: LEADERBOARD_TRACKS,
    summary: {
      totalStrategies: ranked.length,
      evaluatedCount,
      pendingOrForwardOnlyCount: ranked.length - evaluatedCount,
      countsByCategory: {
        ruleBased: ranked.filter(e => e.category === 'rule_based').length,
        flagshipAi: ranked.filter(e => e.category === 'flagship_ai').length,
        researchPartner: ranked.filter(e => e.category === 'research_partner').length,
        aiStrategy: ranked.filter(e => e.category === 'ai_strategy').length
      }
    },
    entries: ranked,
    methodologyNote: 'Risk-adjusted score = Return % ÷ Max Drawdown % (0.50% minimum drawdown floor). Forward paper results and historical backtests are explicitly badged; untraded or pending strategies are unranked (—) rather than assigned synthetic 0% scores.'
  }
}
