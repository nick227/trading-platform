// Price service for market value calculations
// TODO: Replace with real market data API

export function getPrice(ticker) {
  // Temporary stub - return fixed price for demo
  const stubPrices = {
    'NVDA': 485.50,
    'AAPL': 175.25,
    'TSLA': 245.80,
    'AMD': 125.30,
    'MSFT': 415.10
  }
  
  return stubPrices[ticker] || 100.00
}

export function getMarketValue({ ticker, quantity }) {
  return getPrice(ticker) * quantity
}
