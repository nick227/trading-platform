// Price map layer for holdings valuation
export const priceMap = {
  'NVDA': { price: 482.50, updatedAt: 1713347700000 },
  'AMD': { price: 178.80, updatedAt: 1713348000000 },
  'SMCI': { price: 615.00, updatedAt: 1713348300000 },
  'PLTR': { price: 24.67, updatedAt: 1713348258000 },
  'TSLA': { price: 238.91, updatedAt: 1713348449000 },
  'AAPL': { price: 165.00, updatedAt: 1713365400000 },
  'MSFT': { price: 378.92, updatedAt: 1713365400000 },
  'GOOGL': { price: 142.35, updatedAt: 1713365400000 },
  'AMZN': { price: 145.78, updatedAt: 1713365400000 },
  'META': { price: 485.23, updatedAt: 1713365400000 },
  'BRK.B': { price: 425.12, updatedAt: 1713365400000 }
}

export function getCurrentPrice(ticker) {
  const priceData = priceMap[ticker]
  return priceData ? priceData.price : 100.00
}

export function updatePrice(ticker, price) {
  if (priceMap[ticker]) {
    priceMap[ticker].price = price
    priceMap[ticker].updatedAt = Date.now()
  }
  return priceMap[ticker]?.price || 100.00
}

export function getAllPrices() {
  return Object.keys(priceMap).reduce((acc, ticker) => {
    acc[ticker] = priceMap[ticker].price
    return acc
  }, {})
}
