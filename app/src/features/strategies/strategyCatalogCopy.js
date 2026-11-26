/**
 * Copy for the public strategy catalog. Values are descriptions of published
 * evidence only; this module does not rank, infer, or alter trading strategies.
 */
import { pctText } from './strategiesApi'

export function catalogOverview(strategy) {
  const text = String(strategy?.description || strategy?.design?.objective || '').trim()
  if (text) return text
  return 'A description of this strategy’s trading approach has not yet been published.'
}

export function catalogPeriod(window) {
  return ({
    '5Y': 'Five-year historical test',
    '1Y': 'One-year historical test',
    holdout: 'Historical test using later market data',
    forward: 'Simulated trading after publication',
  })[window] || 'Published strategy test'
}

export function catalogResult(summary, window) {
  if (!summary) return 'There are no published results for this period.'
  if (summary.status === 'not_backtestable') return 'This strategy cannot be evaluated with the available historical test.'
  if (summary.status === 'awaiting_sessions') return 'There are not yet enough completed trading sessions to report a result.'
  if (summary.status === 'insufficient_data') return 'There is not enough market data to report a result for this period.'
  if (summary.status !== 'ok') return 'Results for this period are not available.'
  if (summary.symbolsTraded === 0) {
    return Number.isFinite(summary.symbolsTested)
      ? `This strategy did not place a trade on any of the ${summary.symbolsTested} stocks tested.`
      : 'This strategy did not place a trade during this test.'
  }
  if (summary.medianReturnPct == null || summary.medianBuyAndHoldPct == null) {
    return 'The strategy has published trading activity, but comparable return figures are not available.'
  }
  return `The typical strategy return was ${pctText(summary.medianReturnPct)}, compared with ${pctText(summary.medianBuyAndHoldPct)} from buying and holding the same investments.`
}
