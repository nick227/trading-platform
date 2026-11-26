/**
 * Copy for the public strategy catalog. Values are descriptions of published
 * evidence only; this module does not rank, infer, or alter trading strategies.
 */
import { pctText } from './strategiesApi'

export function catalogOverview(strategy) {
  const text = String(strategy?.description || strategy?.design?.objective || '').trim()
  if (text) return text
  return 'The trading approach for this strategy has not yet been described.'
}

export function catalogPeriod(window) {
  return ({
    '5Y': 'Historical results · Five years',
    '1Y': 'Historical results · One year',
    holdout: 'Historical results · Later market data',
    forward: 'Simulated results · Since publication',
  })[window] || 'Published strategy test'
}

export function catalogResult(summary, window) {
  if (!summary) return 'There are no published results for this period.'
  if (summary.status === 'not_backtestable') return 'Historical results are unavailable because this strategy cannot be tested using the available historical method.'
  if (summary.status === 'awaiting_sessions') return 'This strategy has not completed enough simulated trading sessions to show performance results.'
  if (summary.status === 'insufficient_data') return 'There is not enough historical market data to calculate a result for this period.'
  if (summary.status !== 'ok') return 'Results for this period are not available.'
  if (summary.symbolsTraded === 0) {
    return Number.isFinite(summary.symbolsTested)
      ? `This strategy did not place a trade on any of the ${summary.symbolsTested} stocks tested.`
      : 'This strategy did not place a trade during this test.'
  }
  if (summary.medianReturnPct == null || summary.medianBuyAndHoldPct == null) {
    return 'Trading activity has been recorded, but comparable return figures are unavailable.'
  }
  return `The typical strategy return was ${pctText(summary.medianReturnPct)}, compared with ${pctText(summary.medianBuyAndHoldPct)} from buying and holding the same investments.`
}
