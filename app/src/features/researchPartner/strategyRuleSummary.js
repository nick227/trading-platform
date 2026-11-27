/** Display-only translation of governed, deterministic strategy specifications. */
export const SIGNAL_NAMES = Object.freeze({
  return20dPct: '20-session price change',
  return5dPct: '5-session price change',
  volumeRatio: 'Trading volume compared with normal',
  price: 'Last recorded price',
  sma20: '20-session average price',
  sma50: '50-session average price'
})
export function summarizeRule(rule) {
  if (!rule || !Object.hasOwn(SIGNAL_NAMES, rule.field) ||
      !['gte', 'lte'].includes(rule.operator) ||
      typeof rule.value !== 'number' || !Number.isFinite(rule.value)) return 'Review unsupported rule'
  const units = rule.field.endsWith('Pct') ? '%' :
    ['price', 'sma20', 'sma50'].includes(rule.field) ? ' USD' : ''
  return `${SIGNAL_NAMES[rule.field]} ${rule.operator === 'gte' ? 'at least' : 'at most'} ${rule.value}${units}`
}
export function summarizeStrategy(definition) {
  const symbols = definition?.universe?.symbols || []
  return {
    universe: symbols.length ? symbols.join(', ') : 'Choose the stocks to evaluate',
    cadence: definition?.cadence === 'weekly' ? 'Once each week' : 'Each trading day',
    entries: (definition?.entryRules || []).map(summarizeRule),
    exits: (definition?.exitRules || []).map(summarizeRule),
    position: Number.isFinite(definition?.risk?.maxPositionPct)
      ? `${(definition.risk.maxPositionPct * 100).toLocaleString('en-US', {maximumFractionDigits: 2})}% of the paper account` : 'Not set',
    order: Number.isFinite(definition?.risk?.maxOrderNotional)
      ? `$${definition.risk.maxOrderNotional.toLocaleString('en-US')}` : 'Not set'
  }
}
