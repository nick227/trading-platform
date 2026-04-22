import { getMarketHours } from '../../market/calendar.js'

// config: { allowPremarket?: boolean, allowAfterHours?: boolean }
export function evaluateMarketHours(config) {
  const { isOpen, marketOpen, marketClose } = getMarketHours()
  if (isOpen) return { pass: true }

  const now = new Date()

  const isPremarket   = marketOpen  && now < marketOpen
  const isAfterHours  = marketClose && now > marketClose

  if (isPremarket  && config.allowPremarket)  return { pass: true }
  if (isAfterHours && config.allowAfterHours) return { pass: true }

  return { pass: false, reason: 'market_closed' }
}
