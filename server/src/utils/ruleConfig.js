/**
 * Validates a bot rule's config for the rule types the bot engine evaluates. Returns an error
 * message, or null when valid. Keeps the engine from receiving rules it would evaluate
 * against nonsense (e.g. "buy above $0").
 */
const pos = (v) => Number.isFinite(Number(v)) && Number(v) > 0
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function ruleConfigError(type, config = {}) {
  const c = config && typeof config === 'object' ? config : {}
  switch (type) {
    case 'price_threshold': {
      if (!pos(c.price)) return 'Trigger price must be greater than 0.'
      const op = c.operator ?? c.direction
      if (op !== undefined && op !== 'above' && op !== 'below') return 'Trigger must be "above" or "below".'
      return null
    }
    case 'cooldown': {
      const ms = c.windowMs ?? (c.cooldownHours != null ? Number(c.cooldownHours) * 3_600_000 : c.minutes != null ? Number(c.minutes) * 60_000 : null)
      return pos(ms) ? null : 'Cooldown must be longer than 0.'
    }
    case 'position_limit':
      for (const k of ['maxShares', 'maxQuantity', 'maxPositions']) if (c[k] !== undefined && !pos(c[k])) return 'Position limit must be greater than 0.'
      return c.maxShares === undefined && c.maxQuantity === undefined && c.maxPositions === undefined ? 'Position limit needs a maximum.' : null
    case 'daily_loss':
      if (c.maxLoss !== undefined && !pos(c.maxLoss)) return 'Daily loss limit must be greater than $0.'
      if (c.maxDailyLossPct !== undefined && !(pos(c.maxDailyLossPct) && Number(c.maxDailyLossPct) <= 100)) return 'Daily loss % must be between 0 and 100.'
      return c.maxLoss === undefined && c.maxDailyLossPct === undefined ? 'Daily loss limit needs an amount.' : null
    case 'time_window':
      return HHMM.test(String(c.start ?? '')) && HHMM.test(String(c.end ?? '')) && c.start < c.end ? null : 'Trading window needs a start before its end (HH:MM).'
    case 'market_hours':
      for (const k of ['allowPremarket', 'allowAfterHours']) if (c[k] !== undefined && typeof c[k] !== 'boolean') return 'Market-hours options must be true or false.'
      return null
    case 'trend_filter':
      return typeof (c.symbol ?? 'SPY') === 'string' ? null : 'Trend filter needs a symbol.'
    default:
      return `Unknown rule type: ${type}`
  }
}
