/** Shared, factual display helpers for strategy details. No trading logic. */
export const STRATEGY_COPY = Object.freeze({
  results: 'Results',
  decisions: 'Decisions',
  settings: 'Settings',
  details: 'Details',
  noDecisions: 'No decisions yet.',
  noResults: 'No results yet.',
})

export function strategyWindowOptions(windows = [], design = {}, { forwardOnly = false } = {}) {
  if (forwardOnly) return ['forward']
  return windows.filter((w) => !['development', 'holdout'].includes(w) || Boolean(design?.developmentEnd))
}

export function decisionCounts(evaluations = []) {
  return evaluations.reduce((counts, item) => {
    counts.evaluated += 1
    if (item.action === 'BUY' || item.action === 'SELL') counts.actionable += 1
    return counts
  }, { evaluated: 0, actionable: 0 })
}

export function decisionLabel(action) {
  return ['BUY', 'SELL', 'HOLD'].includes(action) ? action : '—'
}

/** Legacy template ID is retained; display current verified strategy name. */
export function strategyDisplayName(strategy) {
  if (strategy?.templateId === 'tmpl_ai_catalyst_momentum') return 'AI Momentum & Technical Breakout'
  return strategy?.name ?? 'Strategy'
}
