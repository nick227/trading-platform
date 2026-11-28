/**
 * User-facing strategy explanations and standardized card metrics.
 * Each purpose-first description is based on the published template rules,
 * not inferred from performance or market data.
 */
export const STRATEGY_EXPLANATIONS = {
  tmpl_ai_catalyst_momentum: 'This strategy looks for potential stock trades using AI analysis. It reviews available market information, including price trends and trading volume, before proposing trades.',
  tmpl_alpha_research: 'This strategy follows research published by TradeLoom’s Alpha Engine. It considers trades only when the research is recent and meets its confidence and price requirements.',
  tmpl_dca_accumulator: 'This strategy builds a position gradually instead of buying all at once. It invests a fixed $1,000 every 30 days, regardless of short-term price movements.',
  tmpl_loss_guard: 'This strategy buys shares regularly and limits losses on the position. It sells when the price falls 10% below the average purchase cost and waits before buying again.',
  tmpl_momentum_buy: 'This strategy attempts to buy stocks after their prices rise above a defined level. It also applies trading-hour restrictions, position limits, and a waiting period between orders.',
  tmpl_momentum_sell: 'This strategy aims to participate in rising stock prices while limiting losses. It buys after sustained price gains and sells when the trend reverses or a loss limit is reached.',
  tmpl_spy_trend_filter: 'This strategy follows the longer-term direction of SPY, a fund tracking the S&P 500. It holds shares during an upward trend and sells when the trend turns downward.',
}

const round = (n, d = 2) => (
  n !== null && n !== undefined && Number.isFinite(Number(n))
    ? Number(Number(n).toFixed(d))
    : null
)

export function catalogOverview(strategy) {
  const templateId = strategy?.templateId
  if (Object.prototype.hasOwnProperty.call(STRATEGY_EXPLANATIONS, templateId)) {
    return STRATEGY_EXPLANATIONS[templateId]
  }
  const published = String(strategy?.description || strategy?.design?.objective || '').trim()
  return published || 'A description of how this strategy works is not available.'
}

export function catalogPeriod(window) {
  return ({
    '5Y': 'Historical test · Five years',
    '1Y': 'Historical test · One year',
    holdout: 'Historical test · Later period',
    forward: 'Simulated trading · Since publication',
  })[window] || 'Published strategy results'
}

/** Distinguish an unavailable measurement from a real return of zero. */
export function catalogResult(summary, window) {
  if (!summary) return 'No performance results have been published for this period.'
  if (summary.status === 'not_backtestable') {
    if (summary.reason?.includes('not configured')) return summary.reason
    return window === 'forward'
      ? 'No performance results have been published since this strategy was introduced.'
      : 'This strategy cannot be evaluated using the available historical testing method.'
  }
  if (summary.status === 'awaiting_sessions') {
    return summary.reason || 'This strategy has not recorded any qualifying forward paper trades. Performance results will become available when sufficient verified trading activity exists.'
  }
  if (summary.status === 'insufficient_data') return 'The available market data is insufficient to calculate performance.'
  if (summary.status !== 'ok') return 'Performance results have not been published for this period.'
  if (summary.symbolsTraded === 0) return 'This strategy did not place any trades during the selected test.'
  if (!Number.isFinite(summary.medianReturnPct) || !Number.isFinite(summary.medianBuyAndHoldPct)) {
    return 'Trading activity is recorded, but comparable return figures are not available.'
  }
  return null
}

export function catalogResultHeading(summary) {
  if (summary?.status === 'ok' && summary?.symbolsTraded === 0) return 'No trades recorded'
  if (summary?.status === 'awaiting_sessions') return 'Results pending'
  if (summary?.reason?.includes('not configured')) return 'Evaluation not configured'
  return 'Results unavailable'
}

/** Strategy family and operating mode badges surfaced at the top of each catalog card. */
export function strategyCategoryMeta(strategy) {
  const tags = Array.isArray(strategy?.tags) ? strategy.tags : []
  if (tags.includes('ai') || strategy?.templateId === 'tmpl_ai_catalyst_momentum') {
    return { family: 'Autonomous AI', mode: 'Forward paper', isAiOrResearch: true }
  }
  if (tags.includes('research') || strategy?.templateId === 'tmpl_alpha_research') {
    return { family: 'Research signal', mode: 'Paper only', isAiOrResearch: true }
  }
  return {
    family: 'Rule-based',
    mode: strategy?.workshopAvailable === false ? 'Standardized rules' : 'Customizable',
    isAiOrResearch: false,
  }
}

/** Return % divided by Max Drawdown % (with a 0.50% floor to prevent near-zero denominator distortion). */
export function computeRiskAdjustedScore(returnPct, maxDrawdownPct, tradesCount = 0) {
  if (returnPct === null || returnPct === undefined || !Number.isFinite(Number(returnPct))) return null
  if (!(tradesCount > 0)) return null
  const dd = maxDrawdownPct !== null && maxDrawdownPct !== undefined && Number.isFinite(Number(maxDrawdownPct))
    ? Math.max(0.5, Math.abs(Number(maxDrawdownPct)))
    : null
  if (dd === null) return null
  return round(Number(returnPct) / dd, 2)
}

/** Standardized sample-depth classification across backtests and forward paper runs. */
export function classifySampleSize({ sessionsCount = 0, tradesCount = 0, symbolsTested = null, status = 'ok' } = {}) {
  const s = Number(sessionsCount) || 0
  const t = Number(tradesCount) || 0
  if (status === 'awaiting_sessions') {
    return { tier: 'awaiting', label: 'Awaiting trades', sessionsCount: s, tradesCount: 0, symbolsTested }
  }
  if (status === 'not_backtestable') {
    return { tier: 'unverified', label: 'Unverified', sessionsCount: s, tradesCount: 0, symbolsTested }
  }
  if (status !== 'ok') {
    return { tier: 'unavailable', label: 'Unavailable', sessionsCount: s, tradesCount: 0, symbolsTested }
  }
  if (t === 0) {
    return { tier: 'awaiting', label: '0 trades', sessionsCount: s, tradesCount: 0, symbolsTested }
  }
  if (s >= 60 && t >= 10) {
    return { tier: 'substantive', label: 'Substantive sample', sessionsCount: s, tradesCount: t, symbolsTested }
  }
  if (s >= 15 && t >= 3) {
    return { tier: 'developing', label: 'Developing sample', sessionsCount: s, tradesCount: t, symbolsTested }
  }
  return { tier: 'early', label: 'Early sample', sessionsCount: s, tradesCount: t, symbolsTested }
}

/** Derives standardized benchmark edge, drawdown, Return/DD ratio, and sample depth for a card window. */
export function deriveCardEvidenceMetrics(summary, window) {
  const approxSessions = window === '5Y' ? 1260 : window === '1Y' ? 252 : Number(summary?.sessionsCount) || 0
  const explicitTrades = summary?.trades !== null && summary?.trades !== undefined && Number.isFinite(Number(summary.trades))
    ? Number(summary.trades)
    : null
  const inferredTrades = explicitTrades !== null
    ? explicitTrades
    : (Number(summary?.symbolsTraded) > 0 ? Number(summary.symbolsTraded) : 0)

  const sampleSize = classifySampleSize({
    sessionsCount: approxSessions,
    tradesCount: inferredTrades,
    symbolsTested: summary?.symbolsTested ?? null,
    status: summary?.status ?? 'unavailable',
  })

  const hasComparable = summary?.status === 'ok' && summary?.symbolsTraded !== 0 &&
    Number.isFinite(summary?.medianReturnPct) && Number.isFinite(summary?.medianBuyAndHoldPct)

  const excessVsBenchmarkPct = hasComparable
    ? round(summary.medianReturnPct - summary.medianBuyAndHoldPct, 2)
    : null

  const rawDd = summary?.medianDrawdownPct ?? summary?.worstDrawdownPct ?? null
  const drawdownPct = hasComparable && rawDd !== null && Number.isFinite(Number(rawDd)) && Number(rawDd) > 0
    ? round(Math.abs(Number(rawDd)), 2)
    : (hasComparable && rawDd === 0 ? 0 : null)

  const riskAdjustedScore = hasComparable && drawdownPct !== null
    ? computeRiskAdjustedScore(summary.medianReturnPct, drawdownPct, inferredTrades)
    : null

  let sampleDetailText = '—'
  if (explicitTrades !== null && Number.isFinite(Number(summary?.symbolsTested))) {
    if (Number.isFinite(Number(summary?.beatBuyAndHold))) {
      sampleDetailText = `${explicitTrades} ${explicitTrades === 1 ? 'trade' : 'trades'} · ${summary.beatBuyAndHold}/${summary.symbolsTested} beat`
    } else {
      sampleDetailText = `${explicitTrades} ${explicitTrades === 1 ? 'trade' : 'trades'} · ${summary.symbolsTested} ${summary.symbolsTested === 1 ? 'stock' : 'stocks'}`
    }
  } else if (explicitTrades !== null) {
    sampleDetailText = `${explicitTrades} ${explicitTrades === 1 ? 'trade' : 'trades'}`
  } else if (Number.isFinite(Number(summary?.symbolsTested))) {
    if (Number.isFinite(Number(summary?.beatBuyAndHold))) {
      sampleDetailText = `${summary.beatBuyAndHold}/${summary.symbolsTested} beat bench`
    } else {
      sampleDetailText = `${summary.symbolsTested} ${summary.symbolsTested === 1 ? 'stock' : 'stocks'} tested`
    }
  }

  return {
    comparable: hasComparable,
    excessVsBenchmarkPct,
    excessTone: excessVsBenchmarkPct > 0 ? 'is-pos' : excessVsBenchmarkPct < 0 ? 'is-neg' : 'is-flat',
    drawdownPct,
    drawdownText: drawdownPct !== null ? (drawdownPct === 0 ? '0.00%' : `−${drawdownPct.toFixed(2)}%`) : '—',
    riskAdjustedScore,
    riskAdjustedText: riskAdjustedScore !== null ? `${riskAdjustedScore.toFixed(2)}x` : '—',
    scoreTone: riskAdjustedScore > 0 ? 'tl-pos' : riskAdjustedScore < 0 ? 'tl-neg' : '',
    sampleSize,
    sampleDetailText,
  }
}
