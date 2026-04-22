import { priceCache } from '../../market/priceCache.js'

// config: { operator: 'above' | 'below', price: number }
export function evaluatePriceThreshold(config, ticker) {
  const quote = priceCache.getIfFresh(ticker)
  if (!quote) {
    return { pass: false, reason: 'stale_price_data', stale: true }
  }

  const current = quote.last ?? quote.ask

  if (current == null) {
    return { pass: false, reason: 'no_price_available' }
  }

  const passes =
    config.operator === 'above' ? current > config.price :
    config.operator === 'below' ? current < config.price :
    false

  return {
    pass: passes,
    reason: passes ? null : `price_${config.operator}_threshold_not_met`,
    current,
    threshold: config.price
  }
}
