import { getMarketHours } from '../../market/calendar.js'

// config: { allowPremarket?: boolean, allowAfterHours?: boolean }
export function evaluateMarketHours(config) {
  const { isOpen } = getMarketHours()
  if (isOpen) return { pass: true }

  // Market is closed. Check if pre/after-hours are allowed by this bot.
  const now = new Date()
  const { marketOpen, marketClose } = getMarketHours()

  const isPremarket   = marketOpen  && now < marketOpen
  const isAfterHours  = marketClose && now > marketClose

  if (isPremarket  && config.allowPremarket)  return { pass: true }
  if (isAfterHours && config.allowAfterHours) return { pass: true }

  return { pass: false, reason: 'market_closed' }
}
