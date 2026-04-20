// Consolidated market data service
// Now using Alpha Engine API for real market data

import alphaEngineService from '../api/services/alphaEngineService.js'

// Fallback static data for when alpha-engine is unavailable.
// Exported so callers that need a synchronous stock list can import this directly
// instead of calling the async getAvailableStocks().
export const FALLBACK_STOCKS = [
  { symbol: 'NVDA', name: 'NVIDIA Corporation', price: 275.56, change: +2.4, volume: '52.3M', sector: 'Technology', marketCap: '6.8T', pe: '65.2' },
  { symbol: 'AAPL', name: 'Apple Inc.', price: 168.75, change: -1.2, volume: '48.7M', sector: 'Technology', marketCap: '2.6T', pe: '28.4' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', price: 266.67, change: +3.8, volume: '112.4M', sector: 'Automotive', marketCap: '846B', pe: '68.9' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', price: 378.92, change: +0.8, volume: '28.1M', sector: 'Technology', marketCap: '2.8T', pe: '32.1' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 142.35, change: -0.5, volume: '31.2M', sector: 'Technology', marketCap: '1.8T', pe: '25.7' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 145.78, change: +1.9, volume: '67.8M', sector: 'Consumer Discretionary', marketCap: '1.5T', pe: '45.3' },
  { symbol: 'META', name: 'Meta Platforms Inc.', price: 485.23, change: +2.1, volume: '18.9M', sector: 'Technology', marketCap: '1.2T', pe: '24.8' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway', price: 425.12, change: +0.3, volume: '3.2M', sector: 'Financial', marketCap: '783B', pe: '9.2' }
]

// Stock reference data from Alpha Engine
export const getAvailableStocks = async () => {
  try {
    const tickers = await alphaEngineService.getTickers()

    // Normalise shapes: backend may return either an array or an envelope like { tickers: [...] }.
    const list = Array.isArray(tickers)
      ? tickers
      : (Array.isArray(tickers?.tickers) ? tickers.tickers : [])

    if (!Array.isArray(list) || list.length === 0) return FALLBACK_STOCKS

    // Ensure we always return an array of enriched ticker objects.
    return list.map(ticker => {
      const symbol = typeof ticker === 'string' ? ticker : ticker.symbol
      const name = typeof ticker === 'string' ? ticker : (ticker.name || ticker.symbol)
      return {
        symbol,
        name,
        price:     ticker?.price      || ticker?.c           || 0,
        change:    ticker?.change     || ticker?.dayChangePct || 0,
        volume:    ticker?.volume     || 'N/A',
        sector:    ticker?.sector     || 'Unknown',
        marketCap: ticker?.marketCap  || 'N/A',
        pe:        ticker?.pe         || 'N/A',
      }
    })
  } catch (error) {
    console.warn('Alpha Engine unavailable, using fallback stocks:', error.message)
    return FALLBACK_STOCKS
  }
}

// Alpha engine predictions from Alpha Engine API
export const getAlphaPredictions = async () => {
  try {
    // Get top rankings to have predictions for multiple stocks
    const rankingsData = await alphaEngineService.getTopRankings(20)
    const predictions = {}
    
    if (rankingsData.rankings && Array.isArray(rankingsData.rankings)) {
      for (const ranking of rankingsData.rankings) {
        try {
          const explainability = await alphaEngineService.getTickerExplainability(ranking.symbol)
          // Convert explainability to match expected format
          if (explainability && explainability.explanation) {
            const confidence = Math.round((explainability.confidence || 0) * 100)
            const signal = confidence >= 80 ? 'STRONG_BUY' : confidence >= 60 ? 'BUY' : confidence >= 40 ? 'HOLD' : 'SELL'
            
            predictions[ranking.symbol] = {
              signal,
              confidence,
              target: null, // Alpha engine may not provide price targets
              timeframe: '30d',
              reasoning: explainability.explanation || 'No reasoning available'
            }
          }
        } catch (error) {
          // Skip if explainability fails for this symbol
          continue
        }
      }
    }
    
    return predictions
  } catch (error) {
    console.warn('Alpha Engine predictions unavailable, using fallback:', error.message)
    // Return fallback predictions
    return {
      'NVDA': { signal: 'STRONG_BUY', confidence: 85, target: 295.00, timeframe: '30d', reasoning: 'AI demand surge, data center expansion' },
      'AAPL': { signal: 'HOLD', confidence: 62, target: 175.00, timeframe: '60d', reasoning: 'Stable earnings, moderate growth' },
      'TSLA': { signal: 'BUY', confidence: 73, target: 285.00, timeframe: '45d', reasoning: 'Production ramp-up, energy segment growth' },
      'MSFT': { signal: 'STRONG_BUY', confidence: 78, target: 410.00, timeframe: '30d', reasoning: 'Cloud dominance, AI integration' },
      'GOOGL': { signal: 'HOLD', confidence: 58, target: 150.00, timeframe: '60d', reasoning: 'Search market stability, regulatory concerns' },
      'AMZN': { signal: 'BUY', confidence: 69, target: 160.00, timeframe: '45d', reasoning: 'AWS growth, retail optimization' },
      'META': { signal: 'STRONG_BUY', confidence: 81, target: 520.00, timeframe: '30d', reasoning: 'Metaverse investments, ad revenue recovery' },
      'BRK.B': { signal: 'HOLD', confidence: 65, target: 440.00, timeframe: '90d', reasoning: 'Value investing, insurance stability' }
    }
  }
}

// Live trading signals - should come from real signal service
export const getLiveSignals = () => [
  { symbol: 'NVDA', strategy: 'Volatility Breakout', confidence: 0.84, entry: 482.15, stop: 458.90, target: 545.20, timestamp: '09:32:15' },
  { symbol: 'AMD', strategy: 'Sniper Coil', confidence: 0.79, entry: 178.42, stop: 169.50, target: 198.30, timestamp: '09:35:42' },
  { symbol: 'SMCI', strategy: 'Silent Compounder', confidence: 0.91, entry: 612.88, stop: 582.24, target: 698.15, timestamp: '09:41:03' },
  { symbol: 'PLTR', strategy: 'Narrative Lag', confidence: 0.73, entry: 24.67, stop: 23.44, target: 28.12, timestamp: '09:44:18' },
  { symbol: 'TSLA', strategy: 'Ownership Vacuum', confidence: 0.68, entry: 238.91, stop: 227.96, target: 267.23, timestamp: '09:47:29' }
]

// Simple in-memory cache for price history
const priceHistoryCache = new Map()

// Price history from Alpha Engine API
export const generatePriceHistory = async (ticker, range = '1Y', interval = '1D') => {
  try {
    const history = await alphaEngineService.getHistory(ticker, range, interval)
    return history
  } catch (error) {
    console.warn(`Alpha Engine history unavailable for ${ticker}, using fallback:`, error.message)
    
    // Generate fallback price history
    const history = []
    const basePrice = 275.56 // Default fallback price
    const volatility = 0.02
    let currentPrice = basePrice * (1 - volatility * 10)
    
    const points = range === '1Y' ? 252 : range === '3M' ? 63 : 30
    
    for (let i = 0; i < points; i++) {
      currentPrice = currentPrice * (1 + (Math.random() - 0.5) * volatility)
      history.push({
        date: new Date(Date.now() - (points - 1 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        price: currentPrice,
        volume: Math.floor(Math.random() * 1000000) + 100000
      })
    }
    
    return history
  }
}

// Market pulse data - should come from real market analysis
export const getMarketPulse = () => ({
  regime: 'UNKNOWN',
  signalBreadth: 0,
  volatility: 0,
  momentum: 0,
  lastUpdate: new Date().toISOString()
})

// Featured assets with mini chart data - should come from real portfolio service
export const getFeaturedAssets = () => [
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
    mini: [475, 480, 478, 482, 485, 483, 486, 484, 487, 485, 488, 485, 483, 486, 488]
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
    mini: [178, 176, 177, 175, 174, 176, 175, 173, 174, 175, 176, 175, 174, 175, 176]
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
    mini: [410, 412, 414, 413, 415, 416, 414, 415, 417, 416, 415, 414, 416, 418, 415]
  }
]

// Generate mini chart data for any stock
export const generateMiniChart = (basePrice, points = 15) => {
  const data = []
  let currentPrice = basePrice
  
  for (let i = 0; i < points; i++) {
    const change = (Math.random() - 0.5) * basePrice * 0.02 // ±2% variation
    currentPrice = Math.max(currentPrice + change, basePrice * 0.8) // Don't go below 80%
    data.push(Math.round(currentPrice * 100) / 100)
  }
  
  return data
}
