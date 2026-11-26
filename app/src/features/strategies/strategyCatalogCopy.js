/**
 * User-facing strategy explanations. Each purpose-first description is based on
 * the published template rules, not inferred from performance or market data.
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
    return window === 'forward'
      ? 'No performance results have been published since this strategy was introduced.'
      : 'This strategy cannot be evaluated using the available historical testing method.'
  }
  if (summary.status === 'awaiting_sessions') return 'There are not enough completed trading sessions to measure performance.'
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
  return 'Results unavailable'
}
