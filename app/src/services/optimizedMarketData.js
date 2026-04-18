// Performance-optimized market data service with caching and single-pass operations

// Cache for expensive calculations
const cache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Pre-computed stock data with indices for fast lookups
let stockIndex = null
let lastStockUpdate = 0

// Optimized stock data with search indices
export const getAvailableStocksOptimized = () => {
  const now = Date.now()
  
  // Rebuild index only if data changed or cache expired
  if (!stockIndex || now - lastStockUpdate > CACHE_TTL) {
    const stocks = [
      { symbol: 'NVDA', name: 'NVIDIA Corporation', price: 275.56, change: +2.4, volume: '52.3M', sector: 'Technology', marketCap: '6.8T', pe: '65.2' },
      { symbol: 'AAPL', name: 'Apple Inc.', price: 168.75, change: -1.2, volume: '48.7M', sector: 'Technology', marketCap: '2.6T', pe: '28.4' },
      { symbol: 'TSLA', name: 'Tesla, Inc.', price: 266.67, change: +3.8, volume: '112.4M', sector: 'Automotive', marketCap: '846B', pe: '68.9' },
      { symbol: 'MSFT', name: 'Microsoft Corporation', price: 378.92, change: +0.8, volume: '28.1M', sector: 'Technology', marketCap: '2.8T', pe: '32.1' },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 142.35, change: -0.5, volume: '31.2M', sector: 'Technology', marketCap: '1.8T', pe: '25.7' },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 145.78, change: +1.9, volume: '67.8M', sector: 'Consumer Discretionary', marketCap: '1.5T', pe: '45.3' },
      { symbol: 'META', name: 'Meta Platforms Inc.', price: 485.23, change: +2.1, volume: '18.9M', sector: 'Technology', marketCap: '1.2T', pe: '24.8' },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway', price: 425.12, change: +0.3, volume: '3.2M', sector: 'Financial', marketCap: '783B', pe: '9.2' }
    ]
    
    // Build search indices for O(1) lookups
    stockIndex = {
      stocks,
      bySymbol: new Map(stocks.map(s => [s.symbol, s])),
      byName: new Map(stocks.map(s => [s.name.toLowerCase(), s])),
      symbolList: stocks.map(s => s.symbol),
      nameList: stocks.map(s => s.name.toLowerCase())
    }
    
    lastStockUpdate = now
  }
  
  return stockIndex.stocks
}

// Optimized stock search with pre-built indices
export const searchStocks = (query) => {
  if (!query) return getAvailableStocksOptimized()
  
  const index = getAvailableStocksOptimized()
  const term = query.toLowerCase().trim()
  
  // Use indices for fast lookups
  const symbolMatch = index.bySymbol.get(term.toUpperCase())
  if (symbolMatch) return [symbolMatch]
  
  const nameMatch = index.byName.get(term)
  if (nameMatch) return [nameMatch]
  
  // Fallback to partial matches (still optimized)
  return index.stocks.filter(stock => 
    stock.symbol.toLowerCase().includes(term) || 
    stock.name.toLowerCase().includes(term)
  )
}

// Optimized price history with memoization
export const generatePriceHistoryOptimized = (basePrice, volatility = 0.02) => {
  const cacheKey = `price_history_${basePrice}_${volatility}`
  
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data
    }
  }
  
  const history = []
  let currentPrice = basePrice * (1 - volatility * 10)
  
  // Single loop with pre-allocated array
  for (let i = 0; i < 30; i++) {
    currentPrice = currentPrice * (1 + (Math.random() - 0.5) * volatility)
    history.push({
      date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      price: currentPrice,
      volume: Math.floor(Math.random() * 1000000) + 100000
    })
  }
  
  // Cache result
  cache.set(cacheKey, { data: history, timestamp: Date.now() })
  
  return history
}

// Optimized mini chart generation with single allocation
export const generateMiniChartOptimized = (basePrice, points = 15) => {
  const cacheKey = `mini_chart_${basePrice}_${points}`
  
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data
    }
  }
  
  // Pre-allocate array for better performance
  const data = new Array(points)
  let currentPrice = basePrice
  
  for (let i = 0; i < points; i++) {
    const change = (Math.random() - 0.5) * basePrice * 0.02
    currentPrice = Math.max(currentPrice + change, basePrice * 0.8)
    data[i] = Math.round(currentPrice * 100) / 100
  }
  
  // Cache result
  cache.set(cacheKey, { data, timestamp: Date.now() })
  
  return data
}

// Optimized featured assets with pre-computed mini charts
export const getFeaturedAssetsOptimized = () => {
  const cacheKey = 'featured_assets'
  
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data
    }
  }
  
  const assets = [
    {
      symbol: 'NVDA',
      name: 'NVIDIA Corporation',
      thesis: 'AI compute demand remains sticky with data center capex accelerating',
      prediction: 'Bullish 78%',
      entry: 482.15,
      stop: 458.90,
      target: 545.20,
      riskReward: '2.1:1',
      timeHorizon: '7d',
      conviction: 'HIGH',
      price: 485.50,
      change: '+2.4%',
      mini: generateMiniChartOptimized(485.50)
    },
    {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      thesis: 'Services margin keeps cash flow resilient despite hardware cyclicality',
      prediction: 'Neutral 54%',
      entry: 189.73,
      stop: 180.24,
      target: 198.72,
      riskReward: '1.2:1',
      timeHorizon: '5d',
      conviction: 'MEDIUM',
      price: 175.25,
      change: '-1.2%',
      mini: generateMiniChartOptimized(175.25)
    },
    {
      symbol: 'MSFT',
      name: 'Microsoft Corporation',
      thesis: 'Cloud acceleration supports multiple expansion with AI tailwinds',
      prediction: 'Bullish 72%',
      entry: 412.56,
      stop: 391.93,
      target: 453.82,
      riskReward: '1.8:1',
      timeHorizon: '7d',
      conviction: 'HIGH',
      price: 415.10,
      change: '+0.8%',
      mini: generateMiniChartOptimized(415.10)
    }
  ]
  
  // Cache result
  cache.set(cacheKey, { data: assets, timestamp: Date.now() })
  
  return assets
}

// Optimized alpha predictions with memoization
export const getAlphaPredictionsOptimized = () => {
  const cacheKey = 'alpha_predictions'
  
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data
    }
  }
  
  const predictions = {
    'NVDA': { signal: 'STRONG_BUY', confidence: 85, target: 295.00, timeframe: '30d', reasoning: 'AI demand surge, data center expansion' },
    'AAPL': { signal: 'HOLD', confidence: 62, target: 175.00, timeframe: '60d', reasoning: 'Stable earnings, moderate growth' },
    'TSLA': { signal: 'BUY', confidence: 73, target: 285.00, timeframe: '45d', reasoning: 'Production ramp-up, energy segment growth' },
    'MSFT': { signal: 'STRONG_BUY', confidence: 78, target: 410.00, timeframe: '30d', reasoning: 'Cloud dominance, AI integration' },
    'GOOGL': { signal: 'HOLD', confidence: 58, target: 150.00, timeframe: '60d', reasoning: 'Search market stability, regulatory concerns' },
    'AMZN': { signal: 'BUY', confidence: 69, target: 160.00, timeframe: '45d', reasoning: 'AWS growth, retail optimization' },
    'META': { signal: 'STRONG_BUY', confidence: 81, target: 520.00, timeframe: '30d', reasoning: 'Metaverse investments, ad revenue recovery' },
    'BRK.B': { signal: 'HOLD', confidence: 65, target: 440.00, timeframe: '90d', reasoning: 'Value investing, insurance stability' }
  }
  
  // Cache result
  cache.set(cacheKey, { data: predictions, timestamp: Date.now() })
  
  return predictions
}

// Clear cache utility for testing
export const clearCache = () => {
  cache.clear()
  stockIndex = null
  lastStockUpdate = 0
}

// Cache statistics for monitoring
export const getCacheStats = () => {
  return {
    size: cache.size,
    keys: Array.from(cache.keys())
  }
}
