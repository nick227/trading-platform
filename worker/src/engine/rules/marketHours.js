import { getMarketHours } from '../../market/calendar.js'

// config: { allowPremarket?: boolean, allowAfterHours?: boolean }
export function evaluateMarketHours(config) {
  return marketHoursDecision(config, { ...getMarketHours(), now: new Date() })
}

/** Pure decision over a market-hours state ({ isOpen, marketOpen, marketClose }) at `now`. */
export function marketHoursDecision(config, { isOpen, marketOpen, marketClose, now }) {
  if (isOpen) return { pass: true }

  const isPremarket   = marketOpen  && now < marketOpen
  const isAfterHours  = marketClose && now > marketClose

  if (isPremarket  && config.allowPremarket)  return { pass: true }
  if (isAfterHours && config.allowAfterHours) return { pass: true }

  return { pass: false, reason: 'market_closed' }
}
