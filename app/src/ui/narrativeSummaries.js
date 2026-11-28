/**
 * Deterministic Plain-English Narrative Summaries (MR 4).
 *
 * Generates calm, plain-English 1–2 sentence takeaways strictly from verified
 * application numbers (portfolio valuation, stock discovery breadth, leaderboard
 * rankings, bot status, and flagship attribution).
 *
 * Architectural invariant: NEVER invokes an LLM, NEVER invents missing metrics,
 * and NEVER formats null/unavailable balances as $0.00.
 */
import { money, moneyWhole, pct, plural, sessionDate, signedMoney, signedPct } from './format'

/**
 * Primary Surface 1 — Portfolio (`/`)
 * Answers: "How is my portfolio performing, and does anything need my attention?"
 */
export function buildPortfolioNarrativeSummary({
  valuation = null,
  bots = [],
  actionableProposalsCount = 0
} = {}) {
  if (!valuation || valuation.source === 'none' || valuation.equity === null || valuation.equity === undefined) {
    return null
  }

  const runningCount = Array.isArray(bots) ? bots.filter((b) => b.running).length : 0
  const errorCount = Array.isArray(bots) ? bots.filter((b) => b.status === 'error').length : 0
  const modePrefix = valuation.simulated ? 'Your simulated portfolio' : 'Your portfolio'

  let perfSentence
  if (!valuation.fillCount || valuation.fillCount === 0) {
    perfSentence = `${modePrefix} holds ${money(valuation.cash ?? valuation.equity)} in uninvested cash with no completed trades yet.`
  } else if (valuation.totalPnl !== null && valuation.totalPnl !== undefined) {
    const directionWord = valuation.totalPnl > 0 ? 'up' : valuation.totalPnl < 0 ? 'down' : 'flat at'
    const changeText = valuation.totalPnl === 0
      ? '$0.00 (0.00%)'
      : `${signedMoney(valuation.totalPnl)} (${signedPct(valuation.totalPnlPct)})`
    const holdingsCount = Array.isArray(valuation.positions) ? valuation.positions.length : 0
    perfSentence = `${modePrefix} is valued at ${money(valuation.equity)} (${directionWord} ${changeText} from ${moneyWhole(valuation.startingCash)}), with ${money(valuation.cash)} in cash and ${plural(holdingsCount, 'open holding')}.`
  } else {
    perfSentence = `${modePrefix} is valued at ${money(valuation.equity)} across ${plural(valuation.positions?.length ?? 0, 'open holding')}.`
  }

  let attentionSentence
  if (errorCount > 0 && actionableProposalsCount > 0) {
    attentionSentence = `${plural(actionableProposalsCount, 'AI trade proposal')} and ${plural(errorCount, 'bot')} with an error need your review.`
  } else if (actionableProposalsCount > 0) {
    attentionSentence = `${plural(actionableProposalsCount, 'simulated trade proposal')} ${actionableProposalsCount === 1 ? 'needs' : 'need'} your review before the NYSE deadline.`
  } else if (errorCount > 0) {
    attentionSentence = `${plural(errorCount, 'bot')} stopped.`
  } else if (runningCount > 0) {
    attentionSentence = `${plural(runningCount, 'automated bot')} ${runningCount === 1 ? 'is' : 'are'} running normally.`
  } else {
    attentionSentence = ''
  }

  return `${perfSentence} ${attentionSentence}`
}

/**
 * Deterministic "Since you last checked" portfolio delta briefing (zero LLM calls).
 * Returns null if there is no prior check-in or no meaningful change to report.
 */
export function buildSinceLastCheckedBriefing(valuation, previousCheckIn = null) {
  if (!valuation || valuation.source === 'none' || valuation.equity == null || !previousCheckIn) {
    return null
  }
  const prevEquity = Number(previousCheckIn.equity)
  const prevFills = Number(previousCheckIn.fillCount ?? 0)
  if (!Number.isFinite(prevEquity)) return null

  const deltaEquity = Math.round((valuation.equity - prevEquity) * 100) / 100
  const newFills = Math.max(0, (valuation.fillCount ?? 0) - prevFills)
  if (Math.abs(deltaEquity) < 0.01 && newFills === 0) return null

  const parts = []
  if (Math.abs(deltaEquity) >= 0.01) {
    parts.push(`Portfolio value moved ${signedMoney(deltaEquity)} since your last visit`)
  } else {
    parts.push('Portfolio value is unchanged since your last visit')
  }
  if (newFills > 0) {
    parts.push(`with ${plural(newFills, 'new simulated fill')} recorded`)
  }
  return `${parts.join(' ')}.`
}

/**
 * Primary Surface 2 — Stocks (`/opportunities`)
 * Answers: "What investment opportunities are available?"
 */
export function buildStocksNarrativeSummary(discovery) {
  if (!discovery || !Number.isFinite(Number(discovery.eligibleCompaniesCount))) {
    return null
  }
  const eligible = discovery.eligibleCompaniesCount
  const sectorsCount = discovery.sectorsCount ?? (discovery.sectors?.length || 0)
  const topSector = discovery.sectors?.[0] || null
  const topCandidate = discovery.discoveries?.[0] || null
  const spyRet = discovery.benchmark?.return20dPct
  const regime = discovery.benchmark?.regime

  const parts = []
  if (topSector) {
    parts.push(
      `Out of ${eligible} qualified companies across ${sectorsCount} sectors, ${topSector.sector} leads with ${topSector.breadthPct}% positive 20-day breadth (led by ${topSector.leaderSymbol}).`
    )
  } else {
    parts.push(`${eligible} companies qualified across ${sectorsCount} sectors in the latest daily-close scan.`)
  }

  if (topCandidate && Number.isFinite(Number(spyRet))) {
    parts.push(
      `Top-ranked candidate is ${topCandidate.symbol} (${topCandidate.themeLabel}), while the S&P 500 benchmark (SPY) is ${signedPct(spyRet)} over 20 sessions${regime ? ` (${regime} regime)` : ''}.`
    )
  }

  return parts.join(' ')
}

/**
 * Primary Surface 4 — My Bots (`/bots`)
 * Answers: "What automated systems have I configured, and what are they doing?"
 */
export function buildBotsNarrativeSummary(bots = []) {
  if (!Array.isArray(bots) || bots.length === 0) return null
  const running = bots.filter((b) => b.running).length
  const paused = bots.filter((b) => b.status === 'paused').length
  const errored = bots.filter((b) => b.status === 'error').length

  if (errored > 0) {
    return `You have ${plural(bots.length, 'configured bot')}: ${running} running, ${paused} paused, and ${errored} needing attention due to a recent error.`
  }
  return `You have ${plural(bots.length, 'configured bot')} (${running} running, ${paused} paused), checking market conditions on completed daily closes.`
}

/**
 * Contextual Surface — Flagship AI Stock Trader (`/ai-stock-trader`)
 */
export function buildFlagshipNarrativeSummary(data) {
  if (!data || data.status === 'not_initialized') return null
  const statusText = data.status === 'enabled' ? 'actively scheduled in paper mode' : 'paused in paper mode'
  const latestCycle = data.research?.[0] || null
  const openCount = data.positions?.length ?? 0

  if (data.performance?.totalPnl != null) {
    return `The Flagship AI Stock Trader is ${statusText} on ${moneyWhole(data.capitalAllocated)} simulated capital, currently at ${signedMoney(data.performance.totalPnl)} total P&L across ${plural(openCount, 'open position')}${latestCycle?.asOfSession ? ` (latest research ${sessionDate(latestCycle.asOfSession, { year: true })})` : ''}.`
  }

  return `The Flagship AI Stock Trader is ${statusText} with ${moneyWhole(data.capitalAllocated)} in simulated capital and ${plural(openCount, 'open position')}${latestCycle?.asOfSession ? `; latest research completed for ${sessionDate(latestCycle.asOfSession, { year: true })}` : ' while awaiting its first recorded paper fills'}.`
}

export function buildPortfolioIntelNarrative(intelligence) {
  if (!intelligence || intelligence.status === 'not_initialized') return null
  const s = intelligence.summary
  const proposalCount = intelligence.allocationProposals?.length ?? 0
  if (!s) return null
  return `${pct(s.grossExposurePct)} of paper equity (${money(s.investedValue)}) is invested across ${plural(s.openPositionsCount ?? 0, 'holding')} with ${money(s.availableCash)} in deployable cash, and ${proposalCount === 0 ? 'no rebalance adjustments are needed right now' : `${plural(proposalCount, 'risk-checked allocation adjustment')} ${proposalCount === 1 ? 'is' : 'are'} suggested`}.`
}

export function buildPerformanceIntelNarrative(intelligence) {
  if (!intelligence || intelligence.status === 'not_initialized') return null
  if (intelligence.status === 'awaiting_activity') {
    return 'Forward attribution will compare AI net returns against SPY buy-and-hold and deterministic screening once multi-session paper fills accumulate.'
  }
  const c = intelligence.comparison
  if (!c) return null
  const vsSpyWord = c.excessVsSpyPctPoints >= 0 ? 'ahead of' : 'behind'
  return `Net of $${(c.modelCostUsd ?? 0).toFixed(4)} in model API spend, the AI paper portfolio returned ${signedPct(c.aiNetReturnPct)} (${signedPct(c.excessVsSpyPctPoints)} ${vsSpyWord} SPY buy-and-hold and ${signedPct(c.excessVsDeterministicPctPoints)} vs deterministic screening).`
}
