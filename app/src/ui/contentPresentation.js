/** Human-facing presentation only. Never used for order or risk evaluation. */
export const EVIDENCE_LABELS = Object.freeze({
  forward: 'Simulated results since publication',
  '5Y': 'Historical test · five years',
  '1Y': 'Historical test · last year',
  holdout: 'Historical test on later data',
})

export function evidenceLabel(window) {
  return EVIDENCE_LABELS[window] ?? 'Trading results'
}

/** Distinguishes missing evidence from zero performance. */
export function evidenceState(summary, window = 'forward') {
  if (summary?.status === 'ok') return null
  if (summary?.status === 'awaiting_sessions' || (!summary && window === 'forward')) {
    return {
      title: 'No completed simulated sessions yet',
      description: 'Results will appear after the strategy completes trading sessions. No performance can be assessed yet.',
    }
  }
  if (summary?.status === 'not_backtestable') return {
    title: 'Historical results are not available',
    description: 'This strategy cannot be evaluated using the standard historical test.',
  }
  if (summary?.status === 'insufficient_data') return {
    title: 'Not enough market data',
    description: 'There is not enough evidence to show a reliable result for this period.',
  }
  return { title: 'Results unavailable', description: 'The requested performance information could not be shown.' }
}

export function decisionState(status, count) {
  if (status === 'loading') return { title: 'Loading decisions', description: 'Retrieving the strategy’s recorded evaluations.' }
  if (status === 'error') return { title: 'Decisions unavailable', description: 'Recorded decisions could not be loaded. This does not mean the strategy made no decisions.' }
  if (!count) return { title: 'No recorded decisions yet', description: 'When the strategy records evaluations, the decisions and supporting evidence will appear here.' }
  return null
}

/** Explain real structured facts; never infer a strategy's trading conditions. */
export function strategyOverview(strategy) {
  const isAi = strategy?.tags?.includes('ai') || strategy?.templateId === 'tmpl_ai_catalyst_momentum'
  if (isAi) {
    return 'Reviews market information after each trading day and evaluates possible stock trades using AI. Results shown here use simulated trades, not real money.'
  }
  const raw = String(strategy?.description ?? strategy?.design?.objective ?? '').trim()
  return raw || 'Review how this strategy is configured and what its recorded results show.'
}

export function uniqueStatements(items) {
  const seen = new Set()
  return (items ?? []).filter(item => {
    const value = String(item ?? '').trim()
    const normalized = value.toLocaleLowerCase().replace(/[.\s]+$/g, '')
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

export function describeEvaluationTiming(config = {}, { isAi = false } = {}) {
  if (isAi) return 'After each trading-day close'
  if (config.schedule?.frequency === 'daily') return 'Every trading day'
  return null
}
