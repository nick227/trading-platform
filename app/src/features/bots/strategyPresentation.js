import { describeAction } from '../../ui/describeBot'

/**
 * Names describe the behavior a person can configure, never a marketing nickname.
 * Preserve canonical names/IDs in the API; this mapping is presentation-only.
 */
const TITLES = {
  tmpl_dca: 'Scheduled Stock Purchases',
  tmpl_research: 'Trade Using Alpha Engine Research',
  tmpl_ai_catalyst_momentum: 'AI Research-Based Stock Trading',
  tmpl_spy_trend_filter: 'Buy When the Market Trend Is Up',
  tmpl_price_scout: 'Buy When a Stock Reaches a Price',
  tmpl_loss_guard: 'Buy With a Daily Loss Limit',
  tmpl_momentum_exit: 'Sell When a Stock Reaches a Price',
}

export function strategyPresentation(f) {
  const id = String(f.id ?? '').toLowerCase()
  const rawName = String(f.name ?? '').trim()
  const rules = Array.isArray(f.rules) ? f.rules : []
  const types = new Set(rules.map(r => r.type))
  const isAi = f.botType === 'strategy_based' || /ai[_-]|ai_catalyst/.test(id) || f.config?.signalSource === 'ai_catalyst_momentum'
  const direction = f.config?.direction === 'sell' ? 'sell' : 'buy'
  const name = TITLES[id] ?? (
    isAi ? 'AI-Assisted Stock Trading' :
    f.config?.signalSource === 'alpha_research' ? 'Trade Using Alpha Engine Research' :
    types.has('trend_filter') ? 'Buy When the Market Trend Is Up' :
    types.has('price_threshold') ? (direction === 'sell' ? 'Sell at a Set Price' : 'Buy at a Set Price') :
    types.has('daily_loss') ? 'Buy With a Daily Loss Limit' :
    types.has('cooldown') ? 'Scheduled Stock Purchases' : rawName || 'Trading Strategy'
  )
  const description = isAi
    ? 'Uses AI-assisted research and predefined risk checks to evaluate potential stock trades.'
    : describeAction(f, { template: true })
  return { name, description, isAi }
}
