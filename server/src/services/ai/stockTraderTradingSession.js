import { isExchangeTradingDay } from '../../utils/marketCalendar.js'

/** Next actual exchange session, skipping weekends and US market holidays. */
export function nextStockTraderSession(session) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session) ||
      Number.isNaN(Date.parse(session + 'T12:00:00Z')) ||
      !isExchangeTradingDay(session)) {
    throw new Error('Completed exchange session required for paper execution')
  }
  const baseline = Date.parse(session + 'T12:00:00Z')
  for (let days = 1; days <= 15; days++) {
    const next = new Date(baseline + days * 86_400_000).toISOString().slice(0, 10)
    if (isExchangeTradingDay(next)) return next
  }
  throw new Error('Next exchange trading session could not be determined')
}
