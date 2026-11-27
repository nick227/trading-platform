import { ResearchPartnerInputError } from './mandate.js'

const SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/
const FIELDS = new Set(['price', 'sma20', 'sma50', 'volumeRatio', 'return5dPct', 'return20dPct'])
const OPERATORS = new Set(['gte', 'lte'])
const KEYS = new Set(['name', 'universe', 'entryRules', 'exitRules', 'risk', 'cadence', 'mode'])
const fail = field => { throw new ResearchPartnerInputError('Invalid paper strategy: ' + field) }
const object = (v, field) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(field)
  return v
}
const exact = (v, names, field) => {
  for (const key of Object.keys(v)) if (!names.has(key)) fail(field + '.' + key)
}
function rule(input, group) {
  const v = object(input, group)
  exact(v, new Set(['field', 'operator', 'value']), group)
  if (!FIELDS.has(v.field) || !OPERATORS.has(v.operator) || typeof v.value !== 'number' ||
      !Number.isFinite(v.value) || Math.abs(v.value) > 1_000_000) fail(group)
  return { field: v.field, operator: v.operator, value: v.value }
}
export function validatePaperStrategy(input) {
  const v = object(input, 'definition')
  exact(v, KEYS, 'definition')
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 120) fail('name')
  if (v.mode !== 'paper' || !['daily', 'weekly'].includes(v.cadence)) fail('execution mode or cadence')
  const universe = object(v.universe, 'universe')
  exact(universe, new Set(['type','symbols']), 'universe')
  if (universe.type !== 'watchlist' || !Array.isArray(universe.symbols) || !universe.symbols.length || universe.symbols.length > 40) fail('universe')
  const symbols = universe.symbols.map(s => typeof s === 'string' ? s.trim().toUpperCase() : '')
  if (symbols.some(s => !SYMBOL.test(s)) || new Set(symbols).size !== symbols.length) fail('symbols')
  if (!Array.isArray(v.entryRules) || !v.entryRules.length || v.entryRules.length > 8 ||
      !Array.isArray(v.exitRules) || v.exitRules.length > 8) fail('rules')
  const risk = object(v.risk, 'risk')
  exact(risk, new Set(['maxPositionPct','maxOrderNotional','maxOrdersPerCycle']), 'risk')
  if (typeof risk.maxPositionPct !== 'number' || risk.maxPositionPct <= 0 || risk.maxPositionPct > 0.2 ||
      !Number.isFinite(risk.maxOrderNotional) || risk.maxOrderNotional <= 0 || risk.maxOrderNotional > 2000 ||
      !Number.isInteger(risk.maxOrdersPerCycle) || risk.maxOrdersPerCycle < 1 || risk.maxOrdersPerCycle > 2) fail('risk')
  return {
    name: v.name.trim(), mode: 'paper', cadence: v.cadence,
    universe: { type: 'watchlist', symbols },
    entryRules: v.entryRules.map(r => rule(r, 'entryRules')),
    exitRules: v.exitRules.map(r => rule(r, 'exitRules')),
    risk: { maxPositionPct: risk.maxPositionPct, maxOrderNotional: risk.maxOrderNotional,
      maxOrdersPerCycle: risk.maxOrdersPerCycle }
  }
}
/** Only evaluates provided deterministic indicators. Never creates orders. */
export function evaluatePaperStrategyCandidate(definition, row) {
  const spec = validatePaperStrategy(definition)
  if (!row || typeof row.symbol !== 'string' || !spec.universe.symbols.includes(row.symbol) ||
      row.eligible !== true) return { eligible: false, entry: false, exit: false, reason: 'not_eligible' }
  const indicators = { ...(row.indicators || {}) }
  // "price" is already a verified screener indicator, never a model supplied quote.
  const compare = r => Number.isFinite(indicators[r.field]) &&
    (r.operator === 'gte' ? indicators[r.field] >= r.value : indicators[r.field] <= r.value)
  return { eligible: true, entry: spec.entryRules.every(compare),
    exit: spec.exitRules.length > 0 && spec.exitRules.every(compare), reason: 'deterministic_preview_only' }
}
