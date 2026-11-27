import { get } from '../../api/client'

/** TradeLoom's standardized strategy evidence (public; no login needed). */
export const loadPublicStrategies = () => get('/public/strategies')
export const loadPublicStrategy = (templateId, version = null) => get(`/public/strategies/${encodeURIComponent(templateId)}`, version ? { version } : {})
export const loadStrategyLeaderboard = async ({ track = 'overview', category = 'all', sortBy = 'risk_adjusted' } = {}) => {
  const res = await get(`/public/strategies/leaderboard?track=${encodeURIComponent(track)}&category=${encodeURIComponent(category)}&sortBy=${encodeURIComponent(sortBy)}`)
  return res && !Array.isArray(res) && Array.isArray(res.entries) ? res : null
}

export const WINDOW_LABELS = { '5Y': '5 years', '1Y': 'Last year', forward: 'Since published', development: 'Initial historical test', holdout: 'Later historical test' }

export const pctText = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`)

/** One line for a window summary — states non-results plainly. */
export function summaryLine(w) {
  if (!w) return 'No results yet'
  if (w.status === 'not_backtestable') return 'Not backtestable'
  if (w.status === 'awaiting_sessions') return 'Awaiting new sessions'
  if (w.status !== 'ok') return 'No results yet'
  if (w.symbolsTraded === 0) return `Didn’t trade on any of ${w.symbolsTested} symbols`
  return `${pctText(w.medianReturnPct)} median vs ${pctText(w.medianBuyAndHoldPct)} buy & hold`
}
