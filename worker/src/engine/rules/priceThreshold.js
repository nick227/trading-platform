import { priceCache } from '../../market/priceCache.js'

// config: { operator?: 'above' | 'below', direction?: 'above' | 'below', price: number }
export function evaluatePriceThreshold(config, ticker) {
  const quote = priceCache.getIfFresh(ticker)
  if (!quote) {
    return { pass: false, reason: 'stale_price_data', stale: true }
  }
  return priceThresholdDecision(config, quote.last ?? quote.ask)
}

/** Pure decision over an observed price (live: fresh quote; backtest: the session close). */
export function priceThresholdDecision(config, current) {
  if (current == null) {
    return { pass: false, reason: 'no_price_available' }
  }

  const operator = config.operator || config.direction || 'above'
  const threshold = Number(config.price ?? 0)

  const passes =
    operator === 'above' ? current > threshold :
    operator === 'below' ? current < threshold :
    false

  return {
    pass: passes,
    reason: passes ? null : `price_${operator}_threshold_not_met`,
    current,
    threshold
  }
}
