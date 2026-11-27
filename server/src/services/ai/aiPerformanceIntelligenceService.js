/**
 * AI Performance Intelligence Service.
 *
 * Moves beyond raw profit-and-loss display to explain:
 * 1. Which AI decisions contributed to or detracted from paper results.
 * 2. Whether research hypotheses and abstentions held up against subsequent market prices.
 * 3. How the AI compares against SPY buy-and-hold and a deterministic technical screener
 *    over the identical observed session window (including net of model API costs).
 * 4. Data-grounded strengths, struggle areas, and explicit statistical sample-size caveats.
 */
import prisma from '../../loaders/prisma.js'
import { engineClient } from '../../clients/engine.js'
import { getExpectedCompletedExchangeSession } from '../../utils/marketCalendar.js'
import { calculateFifoAccounting, loadBotFills } from '../botAccountingService.js'
import { screenAiStockUniverse } from './stockScreener.js'
import { describeUniverseSymbol } from './stockUniverseCatalog.js'
import { createBroadBarsEngine } from './stockDiscoveryService.js'
import { AI_STOCK_TRADER_PLATFORM_BOT_ID } from './strategies/aiStockTraderStrategy.js'
import { DEFAULT_TRADABLE_SYMBOLS } from '../simulationService.js'

const DAY_MS = 86_400_000
const round = (n, d = 2) => Number.isFinite(Number(n)) ? Number(Number(n).toFixed(d)) : 0

export function synthesizeStrengthsAndWeaknesses({
  hasActivity,
  netReturnPct,
  spyReturnPct,
  deterministicReturnPct,
  winRatePct,
  thesisHitRatePct,
  avoidedDrawdownCount,
  missedUpsideCount,
  stopLossCount,
  takeProfitCount,
  modelCostUsd,
  allocatedCapital,
  meetsStatisticalSample
}) {
  const strengths = []
  const weaknesses = []

  if (!hasActivity) {
    weaknesses.push('No completed forward paper trades or multi-session AI decisions have been recorded yet; attribution will populate after live scheduled cycles execute.')
    return { strengths, weaknesses }
  }

  if (spyReturnPct != null) {
    const diff = round(netReturnPct - spyReturnPct, 2)
    if (diff > 0) {
      strengths.push(`Outperformed passive SPY benchmark by +${diff}% net of model API expenses over the active window.`)
    } else if (diff < 0) {
      weaknesses.push(`Trailed passive SPY benchmark by ${diff}% over the active window.`)
    }
  }

  if (deterministicReturnPct != null) {
    const diff = round(netReturnPct - deterministicReturnPct, 2)
    if (diff > 0) {
      strengths.push(`Added +${diff}% incremental return over the pure deterministic technical screener baseline.`)
    } else if (diff < 0) {
      weaknesses.push(`Underperformed the deterministic technical screener baseline by ${diff}%; qualitative filtering was more conservative or mistimed entries.`)
    }
  }

  if (thesisHitRatePct != null) {
    if (thesisHitRatePct >= 55) {
      strengths.push(`Directional AI theses held up on ${thesisHitRatePct}% of evaluated signals.`)
    } else if (thesisHitRatePct < 45) {
      weaknesses.push(`Directional thesis accuracy was ${thesisHitRatePct}%, indicating hypotheses struggled to follow through.`)
    }
  }

  if (avoidedDrawdownCount > 0 && avoidedDrawdownCount >= missedUpsideCount) {
    strengths.push(`Disciplined selectivity: abstaining/holding on ${avoidedDrawdownCount} shortlisted candidate(s) avoided subsequent price declines.`)
  } else if (missedUpsideCount > avoidedDrawdownCount && missedUpsideCount >= 2) {
    weaknesses.push(`High selectivity passed on ${missedUpsideCount} shortlisted candidate(s) that subsequently rallied >3%.`)
  }

  if (winRatePct != null) {
    if (winRatePct >= 55) strengths.push(`Closed-lot win rate of ${winRatePct}% across completed round-trip paper trades.`)
    else if (winRatePct < 45) weaknesses.push(`Closed-lot win rate is ${winRatePct}%; review entry timing and thesis conviction thresholds.`)
  }

  if (stopLossCount > takeProfitCount && stopLossCount >= 2) {
    weaknesses.push(`Close-triggered stop losses (${stopLossCount}) outnumbered take-profit exits (${takeProfitCount}).`)
  } else if (takeProfitCount > 0 && takeProfitCount >= stopLossCount) {
    strengths.push(`Protective exit discipline captured ${takeProfitCount} take-profit target(s) vs ${stopLossCount} stop-loss exit(s).`)
  }

  const costDragBps = allocatedCapital > 0 ? round((modelCostUsd / allocatedCapital) * 10000, 2) : 0
  if (costDragBps <= 15) {
    strengths.push(`Bounded two-call architecture kept total LLM inference cost to $${round(modelCostUsd, 4)} (${costDragBps} bps of capital).`)
  } else {
    weaknesses.push(`Cumulative LLM inference spend reached $${round(modelCostUsd, 2)} (${costDragBps} bps drag on paper capital).`)
  }

  if (!meetsStatisticalSample) {
    weaknesses.push('Sample size is below 60 sessions / 10 closed trades; results are descriptive forward observations rather than statistically significant alpha.')
  }

  return {
    strengths: strengths.slice(0, 5),
    weaknesses: weaknesses.slice(0, 5)
  }
}

function findCloseOnOrAfter(bars, sessionDate) {
  if (!Array.isArray(bars) || !bars.length) return null
  for (const b of bars) {
    if (b[0] >= sessionDate && Number.isFinite(Number(b[4]))) return Number(b[4])
  }
  return Number(bars.at(-1)?.[4]) || null
}

export async function evaluateAiPerformanceIntelligence({
  botId = AI_STOCK_TRADER_PLATFORM_BOT_ID,
  prismaClient = prisma,
  engine = engineClient,
  fillLoader = loadBotFills,
  accountant = calculateFifoAccounting,
  session = null,
  now = new Date()
} = {}) {
  const bot = await prismaClient.bot.findUnique({ where: { id: botId } })
  if (!bot || bot.deletedAt) {
    return { status: 'not_initialized', botId, simulated: true }
  }

  const allocatedCapital = Number(bot.config?.allocatedAmount) > 0 ? Number(bot.config.allocatedAmount) : 10000
  const expectedSession = session || getExpectedCompletedExchangeSession(now)
  const barsEngine = createBroadBarsEngine(engine)

  const [fills, decisionEvents, ruleEvents, usageCalls, audits] = await Promise.all([
    fillLoader(bot.id, { prismaClient }),
    prismaClient.botEvent.findMany({
      where: { botId: bot.id, type: 'decision_made' },
      orderBy: { createdAt: 'asc' },
      take: 200
    }),
    prismaClient.botEvent.findMany({
      where: { botId: bot.id, type: 'rule_triggered' },
      orderBy: { createdAt: 'desc' },
      take: 100
    }),
    prismaClient.aiUsageCall?.findMany
      ? prismaClient.aiUsageCall.findMany({
          where: { botId: bot.id, status: 'completed' }
        }).catch(() => [])
      : Promise.resolve([]),
    prismaClient.executionAudit?.findMany
      ? prismaClient.executionAudit.findMany({
          where: { userId: bot.userId, eventType: 'execution_created' },
          orderBy: { createdAt: 'desc' },
          take: 200
        }).catch(() => [])
      : Promise.resolve([])
  ])

  const completedCycles = decisionEvents.filter(
    e => e.metadata?.status === 'completed' && Array.isArray(e.metadata?.decision?.decisions)
  )

  // Determine earliest and latest observed sessions
  const sessionCandidates = []
  for (const c of completedCycles) {
    if (c.metadata?.decision?.asOfSession) sessionCandidates.push(c.metadata.decision.asOfSession)
  }
  for (const f of fills) {
    if (f.simSession) sessionCandidates.push(f.simSession)
    else if (f.filledAt) sessionCandidates.push(new Date(f.filledAt).toISOString().slice(0, 10))
  }
  sessionCandidates.sort()

  const hasActivity = fills.length > 0 || completedCycles.length > 0
  const firstSession = sessionCandidates[0] || null

  // Collect all symbols referenced in fills and decisions to fetch price series once
  const referencedSymbols = new Set(['SPY'])
  for (const f of fills) if (f.ticker) referencedSymbols.add(f.ticker)
  for (const c of completedCycles) {
    for (const d of c.metadata.decision.decisions) {
      if (d?.symbol) referencedSymbols.add(d.symbol)
    }
  }

  const lookbackStart = new Date(Date.parse(expectedSession + 'T00:00:00Z') - 220 * DAY_MS).toISOString().slice(0, 10)
  const barsBySymbol = new Map()
  await Promise.all([...referencedSymbols].slice(0, 40).map(async sym => {
    try {
      const res = await barsEngine.getDailyBars(sym, lookbackStart, expectedSession)
      if (Array.isArray(res?.bars) && res.bars.length > 0) {
        barsBySymbol.set(sym, res.bars)
      }
    } catch {
      // Ignore unavailable symbol bars
    }
  }))

  const spyBars = barsBySymbol.get('SPY') || []
  const latestSession = spyBars.at(-1)?.[0] || expectedSession

  // Current prices for open position marks
  const currentPrices = {}
  for (const [sym, b] of barsBySymbol.entries()) {
    const lastClose = Number(b.at(-1)?.[4])
    if (lastClose > 0) currentPrices[sym] = lastClose
  }
  const prelim = accountant(fills)
  for (const sym of Object.keys(prelim.openPositions || {})) {
    if (!currentPrices[sym] && typeof engine?.getSessionClose === 'function') {
      const q = await engine.getSessionClose(sym, latestSession).catch(() => null)
      if (Number(q?.close) > 0) currentPrices[sym] = Number(q.close)
    }
  }

  const accounting = accountant(fills, { currentPrices })
  const realizedPnl = Number(accounting.performance?.realizedPnl ?? 0)
  const unrealizedPnl = Number(accounting.performance?.unrealizedPnl ?? 0)
  const totalFees = Number(accounting.performance?.fees ?? 0)
  const totalPnl = accounting.hasFills ? round(realizedPnl + unrealizedPnl - totalFees, 2) : 0
  const grossReturnPct = round((totalPnl / allocatedCapital) * 100, 2)

  // Model API spend accounting (exclude smoke tests so strategy cost reflects actual research)
  const researchUsageCalls = usageCalls.filter(c => !String(c.jobKey || '').startsWith('flagship_beta_provider_smoke'))
  const modelCostCents = researchUsageCalls.reduce((sum, c) => sum + Number(c.actualCents ?? c.settledCents ?? 0), 0)
  const modelCostUsd = round(modelCostCents / 100, 4)
  const netPnlAfterModelCost = round(totalPnl - modelCostUsd, 2)
  const netReturnAfterModelCostPct = round((netPnlAfterModelCost / allocatedCapital) * 100, 2)

  // Per-symbol PnL attribution from realized executions + open positions
  const thesisBySymbol = new Map()
  for (const aud of audits) {
    const execTicker = fills.find(f => f.id === aud.executionId)?.ticker
    if (execTicker && aud.metadata?.thesis && !thesisBySymbol.has(execTicker)) {
      thesisBySymbol.set(execTicker, aud.metadata.thesis)
    }
  }
  for (const c of [...completedCycles].reverse()) {
    for (const d of c.metadata.decision.decisions) {
      if (d?.symbol && d?.thesis && !thesisBySymbol.has(d.symbol)) {
        thesisBySymbol.set(d.symbol, d.thesis)
      }
    }
  }

  const symbolPnlMap = new Map()
  for (const f of fills) {
    if (!f.ticker) continue
    if (!symbolPnlMap.has(f.ticker)) {
      const meta = describeUniverseSymbol(f.ticker)
      symbolPnlMap.set(f.ticker, {
        symbol: f.ticker,
        name: meta.name,
        sector: meta.sector,
        fillsCount: 0,
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0,
        contributionPctPoints: 0,
        thesis: thesisBySymbol.get(f.ticker) || null
      })
    }
    const row = symbolPnlMap.get(f.ticker)
    row.fillsCount += 1
    const execRealized = accounting.perExecutionPnl?.get?.(f.id)
    if (Number.isFinite(execRealized)) {
      row.realizedPnl = round(row.realizedPnl + execRealized, 2)
    }
  }

  for (const [sym, openPos] of Object.entries(accounting.openPositions || {})) {
    if (!symbolPnlMap.has(sym)) continue
    const row = symbolPnlMap.get(sym)
    row.unrealizedPnl = round(Number(openPos.unrealizedPnl ?? 0), 2)
  }

  const symbolAttributions = [...symbolPnlMap.values()].map(row => {
    const combined = round(row.realizedPnl + row.unrealizedPnl, 2)
    return {
      ...row,
      totalPnl: combined,
      contributionPctPoints: round((combined / allocatedCapital) * 100, 2)
    }
  }).sort((a, b) => b.totalPnl - a.totalPnl)

  const topContributors = symbolAttributions.filter(s => s.totalPnl > 0).slice(0, 5)
  const topDetractors = [...symbolAttributions].filter(s => s.totalPnl < 0).sort((a, b) => a.totalPnl - b.totalPnl).slice(0, 5)

  // Evaluate historical research hypotheses & abstentions against subsequent observed closes
  let directionalEvaluated = 0
  let directionalHits = 0
  let highConvictionEvaluated = 0
  let highConvictionHits = 0
  let avoidedDrawdownCount = 0
  let missedUpsideCount = 0
  let qualitativeCyclesCount = 0
  const hypothesisLedger = []

  for (const cycle of completedCycles) {
    const decSession = cycle.metadata.decision.asOfSession
    const toolsUsed = cycle.metadata?.investigation?.toolTrace?.map(t => t.toolId) || []
    const usedQualitative = toolsUsed.includes('get_research_evidence')
    if (usedQualitative) qualitativeCyclesCount += 1

    for (const d of cycle.metadata.decision.decisions) {
      const bars = barsBySymbol.get(d.symbol)
      if (!bars || decSession >= latestSession) continue
      const entryRef = findCloseOnOrAfter(bars, decSession)
      const latestRef = Number(bars.at(-1)?.[4])
      if (!(entryRef > 0) || !(latestRef > 0) || entryRef === latestRef) continue

      const forwardMovePct = round(((latestRef - entryRef) / entryRef) * 100, 2)
      const conf = Number(d.confidence ?? 0)

      if (d.action === 'BUY' || d.action === 'SELL') {
        directionalEvaluated += 1
        const hit = d.action === 'BUY' ? forwardMovePct > 0 : forwardMovePct < 0
        if (hit) directionalHits += 1
        if (conf >= 0.8) {
          highConvictionEvaluated += 1
          if (hit) highConvictionHits += 1
        }
        hypothesisLedger.push({
          asOfSession: decSession,
          symbol: d.symbol,
          action: d.action,
          confidence: conf || null,
          thesis: d.thesis || null,
          forwardMovePct,
          outcome: hit ? 'held_up' : 'struggled',
          qualitativeBacked: usedQualitative
        })
      } else if (d.action === 'HOLD') {
        if (forwardMovePct < -1.0) avoidedDrawdownCount += 1
        else if (forwardMovePct > 3.0) missedUpsideCount += 1
      }
    }
  }

  const thesisHitRatePct = directionalEvaluated > 0 ? round((directionalHits / directionalEvaluated) * 100, 1) : null
  const highConvictionHitRatePct = highConvictionEvaluated > 0
    ? round((highConvictionHits / highConvictionEvaluated) * 100, 1)
    : null

  // Benchmark & Deterministic Screener Comparison over identical [firstSession .. latestSession] window
  let spyReturnPct = null
  let deterministicReturnPct = null
  let deterministicSelections = []
  let activeSessionsCount = 0

  if (firstSession && spyBars.length > 0) {
    activeSessionsCount = spyBars.filter(b => b[0] >= firstSession && b[0] <= latestSession).length
    const spyStart = findCloseOnOrAfter(spyBars, firstSession)
    const spyEnd = Number(spyBars.at(-1)?.[4])
    if (spyStart > 0 && spyEnd > 0) {
      spyReturnPct = round(((spyEnd - spyStart) / spyStart) * 100, 2)
    }

    // Deterministic baseline: top 3 quantitative screener picks as-of firstSession (20% weight each = 60% invested, 40% cash)
    try {
      const baseScreen = await screenAiStockUniverse({
        engine: barsEngine,
        session: firstSession,
        symbols: bot.config?.universe?.symbols || DEFAULT_TRADABLE_SYMBOLS,
        shortlistLimit: 3
      })
      const topPicks = baseScreen.shortlist.filter(s => s.eligible && s.symbol !== 'SPY').slice(0, 3)
      if (topPicks.length > 0) {
        let weightedReturn = 0
        for (const pick of topPicks) {
          let pBars = barsBySymbol.get(pick.symbol)
          if (!pBars) {
            const fetched = await barsEngine.getDailyBars(pick.symbol, lookbackStart, latestSession).catch(() => null)
            pBars = fetched?.bars || []
          }
          const startPx = pick.indicators.price
          const endPx = Number(pBars.at(-1)?.[4]) || startPx
          const movePct = startPx > 0 ? ((endPx - startPx) / startPx) * 100 : 0
          weightedReturn += 0.20 * movePct // 20% deterministic position cap per pick
          deterministicSelections.push({ symbol: pick.symbol, movePct: round(movePct, 2) })
        }
        deterministicReturnPct = round(weightedReturn, 2)
      }
    } catch {
      deterministicReturnPct = null
    }
  }

  const stopLossCount = ruleEvents.filter(e => e.metadata?.exitType === 'stop_loss').length
  const takeProfitCount = ruleEvents.filter(e => e.metadata?.exitType === 'take_profit').length
  const closedTradesCount = Number(accounting.performance?.closedTrades ?? 0)
  const rawWinRate = accounting.performance?.winRate
  const winRatePct = rawWinRate != null && closedTradesCount > 0
    ? round(Number(rawWinRate) <= 1 ? Number(rawWinRate) * 100 : Number(rawWinRate), 1)
    : null
  const meetsStatisticalSample = activeSessionsCount >= 60 && closedTradesCount >= 10

  const { strengths, weaknesses } = synthesizeStrengthsAndWeaknesses({
    hasActivity,
    netReturnPct: netReturnAfterModelCostPct,
    spyReturnPct,
    deterministicReturnPct,
    winRatePct,
    thesisHitRatePct,
    avoidedDrawdownCount,
    missedUpsideCount,
    stopLossCount,
    takeProfitCount,
    modelCostUsd,
    allocatedCapital,
    meetsStatisticalSample
  })

  return {
    status: hasActivity ? 'ready' : 'awaiting_activity',
    simulated: true,
    botId: bot.id,
    window: {
      firstSession,
      latestSession,
      activeSessionsCount
    },
    comparison: {
      allocatedCapital,
      aiGrossReturnPct: hasActivity ? grossReturnPct : null,
      aiNetReturnPct: hasActivity ? netReturnAfterModelCostPct : null,
      totalPnl: hasActivity ? totalPnl : null,
      modelCostUsd,
      spyReturnPct,
      deterministicScreenerReturnPct: deterministicReturnPct,
      deterministicSelections,
      excessVsSpyPctPoints: hasActivity && spyReturnPct != null ? round(netReturnAfterModelCostPct - spyReturnPct, 2) : null,
      excessVsDeterministicPctPoints: hasActivity && deterministicReturnPct != null ? round(netReturnAfterModelCostPct - deterministicReturnPct, 2) : null
    },
    decisionQuality: {
      completedCyclesCount: completedCycles.length,
      qualitativeBackedCyclesCount: qualitativeCyclesCount,
      filledExecutionsCount: fills.length,
      closedTradesCount,
      winRatePct,
      directionalEvaluated,
      thesisHitRatePct,
      highConvictionHitRatePct,
      selectivity: {
        avoidedDrawdownCount,
        missedUpsideCount
      },
      protectiveExits: {
        stopLossCount,
        takeProfitCount
      }
    },
    attribution: {
      topContributors,
      topDetractors,
      recentHypotheses: hypothesisLedger.slice(-8).reverse()
    },
    diagnostics: {
      strengths,
      weaknesses
    },
    statisticalConfidence: {
      meetsThreshold: meetsStatisticalSample,
      activeSessionsCount,
      closedTradesCount,
      note: meetsStatisticalSample
        ? 'Meets 60-session and 10-closed-trade evaluation threshold.'
        : `Descriptive sample (${activeSessionsCount}/60 sessions, ${closedTradesCount}/10 closed trades). Treat comparisons as early forward paper evidence, not statistically significant alpha.`
    }
  }
}
