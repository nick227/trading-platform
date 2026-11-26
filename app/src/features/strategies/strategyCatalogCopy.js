/**
 * Plain-language descriptions are reviewed against the published seed strategy
 * rules. The backend remains authoritative for all results and configurations.
 */
export const STRATEGY_EXPLANATIONS = {
  tmpl_ai_catalyst_momentum: 'An AI model reviews stock price trends, trading volume, and other market information to identify possible trades.',
  tmpl_alpha_research: 'This strategy follows recent Alpha Engine research signals. It skips a trade when the research is outdated or does not meet its conditions.',
  tmpl_dca_accumulator: 'This strategy invests $1,000 at regular 30-day intervals rather than investing the full amount at once.',
  tmpl_loss_guard: 'This strategy buys at regular intervals and sells its holdings if their price falls 10% below the average purchase price.',
  tmpl_momentum_buy: 'This strategy buys when a stock price rises above a set level, subject to trading limits and a waiting period between orders.',
  tmpl_momentum_sell: 'This strategy buys after a sustained price increase and sells if the trend reverses or the position reaches its loss limit.',
  tmpl_spy_trend_filter: 'This strategy holds SPY while its longer-term price trend is positive and sells when that trend turns downward.',
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
    '5Y': 'Five-year historical test',
    '1Y': 'One-year historical test',
    holdout: 'Later historical test',
    forward: 'Results since publication',
  })[window] || 'Available test results'
}

/** When the API does not publish a return, distinguish that from a zero return. */
export function catalogResult(summary, window) {
  if (!summary) return 'No results have been published for this period.'
  if (summary.status === 'not_backtestable') {
    return window === 'forward'
      ? 'Performance results since publication are not available.'
      : 'This strategy does not have results from the available historical tests.'
  }
  if (summary.status === 'awaiting_sessions') return 'There are not yet enough completed trading sessions to report performance.'
  if (summary.status === 'insufficient_data') return 'There is not enough market data to calculate the result.'
  if (summary.status !== 'ok') return 'Performance results are currently unavailable.'
  if (summary.symbolsTraded === 0) return 'This strategy did not place any trades during this test.'
  if (!Number.isFinite(summary.medianReturnPct) || !Number.isFinite(summary.medianBuyAndHoldPct)) {
    return 'Trades were recorded, but comparable returns have not been published.'
  }
  return null
}
