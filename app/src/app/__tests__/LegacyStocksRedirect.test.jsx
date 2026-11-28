import { describe, expect, it } from 'vitest'
import { resolveLegacyStockDestination } from '../LegacyStocksRedirect'

describe('legacy stock routes', () => {
  it('routes browsing links into public AI Trader', () => {
    expect(resolveLegacyStockDestination('')).toBe('/ai-stock-trader')
    expect(resolveLegacyStockDestination('?sector=Technology&theme=momentum')).toBe('/ai-stock-trader')
  })
  it('preserves ticker and strategy context when starting bot creation', () => {
    expect(resolveLegacyStockDestination('?symbol=aapl&strategy=some-template'))
      .toBe('/bots/new?ticker=AAPL&template=some-template')
    expect(resolveLegacyStockDestination('?ticker=msft')).toBe('/bots/new?ticker=MSFT')
  })
})
