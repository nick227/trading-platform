// Web Worker for Heavy Trading Signal Calculations
// Offloads CPU-intensive computations from main thread

// Technical indicator calculations
const calculateSMA = (data, period) => {
  const sma = []
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    sma.push(sum / period)
  }
  return sma
}

const calculateRSI = (data, period = 14) => {
  const rsi = []
  let gains = 0
  let losses = 0
  
  for (let i = 1; i < data.length; i++) {
    const change = data[i] - data[i - 1]
    if (change > 0) {
      gains += change
    } else {
      losses -= change
    }
    
    if (i >= period) {
      const avgGain = gains / period
      const avgLoss = losses / period
      const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
      rsi.push(100 - (100 / (1 + rs)))
      
      // Remove oldest data point
      const oldChange = data[i - period + 1] - data[i - period]
      if (oldChange > 0) {
        gains -= oldChange
      } else {
        losses += oldChange
      }
    }
  }
  return rsi
}

const calculateBollingerBands = (data, period = 20, stdDev = 2) => {
  const bands = []
  const sma = calculateSMA(data, period)
  
  for (let i = 0; i < sma.length; i++) {
    const slice = data.slice(i, i + period)
    const mean = sma[i]
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period
    const standardDeviation = Math.sqrt(variance)
    
    bands.push({
      upper: mean + (standardDeviation * stdDev),
      middle: mean,
      lower: mean - (standardDeviation * stdDev)
    })
  }
  return bands
}

const calculateEMA = (data, period) => {
  const ema = []
  const multiplier = 2 / (period + 1)
  
  // Start with SMA for first EMA value
  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += data[i]
  }
  ema.push(sum / period)
  
  // Calculate EMA for remaining values
  for (let i = period; i < data.length; i++) {
    const emaValue = (data[i] * multiplier) + (ema[ema.length - 1] * (1 - multiplier))
    ema.push(emaValue)
  }
  
  return ema
}

const calculateMACD = (data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) => {
  const fastEMA = calculateEMA(data, fastPeriod)
  const slowEMA = calculateEMA(data, slowPeriod)
  
  const macdLine = []
  const startIndex = slowPeriod - fastPeriod
  
  for (let i = 0; i < fastEMA.length - startIndex; i++) {
    macdLine.push(fastEMA[i + startIndex] - slowEMA[i])
  }
  
  const signalLine = calculateEMA(macdLine, signalPeriod)
  const histogram = macdLine.slice(signalPeriod - 1).map((val, i) => val - signalLine[i])
  
  return {
    macd: macdLine.slice(signalPeriod - 1),
    signal: signalLine,
    histogram
  }
}

// Strategy signal calculations
const calculateMomentumSignals = (marketData) => {
  const { prices, volumes, timestamps } = marketData
  const signals = []
  
  // Calculate indicators
  const sma50 = calculateSMA(prices, 50)
  const rsi = calculateRSI(prices)
  const bollinger = calculateBollingerBands(prices)
  
  // Generate signals for each data point
  for (let i = 0; i < prices.length; i++) {
    if (i < 50) continue // Need enough data for SMA
    
    const currentPrice = prices[i]
    const currentSMA = sma50[i - 50 + 1]
    const currentRSI = rsi[i - 14 + 1]
    const currentBollinger = bollinger[i - 20 + 1]
    
    let signal = 'HOLD'
    let confidence = 0
    const reasons = []
    
    // SMA crossover signal
    if (currentPrice > currentSMA && currentRSI > 50) {
      signal = 'BUY'
      confidence += 0.6
      reasons.push('Price above SMA with RSI confirmation')
    } else if (currentPrice < currentSMA && currentRSI < 50) {
      signal = 'SELL'
      confidence += 0.6
      reasons.push('Price below SMA with RSI confirmation')
    }
    
    // Bollinger Bands signal
    if (currentPrice <= currentBollinger.lower) {
      if (signal === 'BUY') {
        confidence += 0.3
        reasons.push('Price at lower Bollinger Band')
      } else {
        signal = 'BUY'
        confidence = 0.4
        reasons.push('Price at lower Bollinger Band')
      }
    } else if (currentPrice >= currentBollinger.upper) {
      if (signal === 'SELL') {
        confidence += 0.3
        reasons.push('Price at upper Bollinger Band')
      } else {
        signal = 'SELL'
        confidence = 0.4
        reasons.push('Price at upper Bollinger Band')
      }
    }
    
    // Volume confirmation
    const avgVolume = volumes.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b, 0) / Math.min(20, i)
    if (volumes[i] > avgVolume * 1.5) {
      confidence += 0.1
      reasons.push('High volume confirmation')
    }
    
    signals.push({
      timestamp: timestamps[i],
      price: currentPrice,
      signal,
      confidence: Math.min(confidence, 1),
      indicators: {
        sma50: currentSMA,
        rsi: currentRSI,
        bollinger: currentBollinger
      },
      reasons
    })
  }
  
  return signals
}

const calculateMeanReversionSignals = (marketData) => {
  const { prices, volumes, timestamps } = marketData
  const signals = []
  
  // Calculate indicators
  const bollinger = calculateBollingerBands(prices)
  const rsi = calculateRSI(prices)
  
  for (let i = 0; i < prices.length; i++) {
    if (i < 20) continue // Need enough data for Bollinger Bands
    
    const currentPrice = prices[i]
    const currentBollinger = bollinger[i - 20 + 1]
    const currentRSI = rsi[i - 14 + 1]
    
    let signal = 'HOLD'
    let confidence = 0
    const reasons = []
    
    // Mean reversion signals
    if (currentPrice <= currentBollinger.lower && currentRSI < 30) {
      signal = 'BUY'
      confidence = 0.8
      reasons.push('Oversold condition at lower Bollinger Band')
    } else if (currentPrice >= currentBollinger.upper && currentRSI > 70) {
      signal = 'SELL'
      confidence = 0.8
      reasons.push('Overbought condition at upper Bollinger Band')
    } else if (currentPrice <= currentBollinger.lower) {
      signal = 'BUY'
      confidence = 0.6
      reasons.push('Price at lower Bollinger Band')
    } else if (currentPrice >= currentBollinger.upper) {
      signal = 'SELL'
      confidence = 0.6
      reasons.push('Price at upper Bollinger Band')
    }
    
    // Volume confirmation
    const avgVolume = volumes.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b, 0) / Math.min(20, i)
    if (volumes[i] > avgVolume * 1.2) {
      confidence += 0.1
      reasons.push('Volume confirmation')
    }
    
    signals.push({
      timestamp: timestamps[i],
      price: currentPrice,
      signal,
      confidence: Math.min(confidence, 1),
      indicators: {
        bollinger: currentBollinger,
        rsi: currentRSI
      },
      reasons
    })
  }
  
  return signals
}

const calculateBreakoutSignals = (marketData) => {
  const { prices, volumes, timestamps } = marketData
  const signals = []
  
  // Calculate moving averages for resistance/support
  const sma20 = calculateSMA(prices, 20)
  const ema12 = calculateEMA(prices, 12)
  const macd = calculateMACD(prices)
  
  for (let i = 0; i < prices.length; i++) {
    if (i < 26) continue // Need enough data for MACD
    
    const currentPrice = prices[i]
    const currentSMA20 = sma20[i - 20 + 1]
    const currentEMA12 = ema12[i - 12 + 1]
    const currentMACD = macd.macd[i - 26 + 1]
    const currentSignal = macd.signal[i - 26 + 1]
    
    let signal = 'HOLD'
    let confidence = 0
    const reasons = []
    
    // Breakout detection
    const recentHigh = Math.max(...prices.slice(Math.max(0, i - 10), i))
    const recentLow = Math.min(...prices.slice(Math.max(0, i - 10), i))
    
    if (currentPrice > recentHigh * 1.02) {
      signal = 'BUY'
      confidence = 0.7
      reasons.push('Price breakout above recent high')
    } else if (currentPrice < recentLow * 0.98) {
      signal = 'SELL'
      confidence = 0.7
      reasons.push('Price breakdown below recent low')
    }
    
    // MACD confirmation
    if (currentMACD > currentSignal) {
      if (signal === 'BUY') {
        confidence += 0.2
        reasons.push('MACD bullish confirmation')
      } else if (signal === 'HOLD') {
        signal = 'BUY'
        confidence = 0.3
        reasons.push('MACD bullish signal')
      }
    } else if (currentMACD < currentSignal) {
      if (signal === 'SELL') {
        confidence += 0.2
        reasons.push('MACD bearish confirmation')
      } else if (signal === 'HOLD') {
        signal = 'SELL'
        confidence = 0.3
        reasons.push('MACD bearish signal')
      }
    }
    
    // Volume confirmation (higher threshold for breakouts)
    const avgVolume = volumes.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b, 0) / Math.min(20, i)
    if (volumes[i] > avgVolume * 2) {
      confidence += 0.1
      reasons.push('High volume breakout confirmation')
    }
    
    signals.push({
      timestamp: timestamps[i],
      price: currentPrice,
      signal,
      confidence: Math.min(confidence, 1),
      indicators: {
        sma20: currentSMA20,
        ema12: currentEMA12,
        macd: currentMACD,
        signal: currentSignal
      },
      reasons
    })
  }
  
  return signals
}

// Main message handler
self.addEventListener('message', async (e) => {
  const { type, data, id } = e.data
  
  try {
    let result
    
    switch (type) {
      case 'CALCULATE_MOMENTUM_SIGNALS':
        result = calculateMomentumSignals(data)
        break
        
      case 'CALCULATE_MEAN_REVERSION_SIGNALS':
        result = calculateMeanReversionSignals(data)
        break
        
      case 'CALCULATE_BREAKOUT_SIGNALS':
        result = calculateBreakoutSignals(data)
        break
        
      case 'CALCULATE_INDICATORS':
        const { prices, indicators } = data
        result = {}
        
        if (indicators.includes('SMA')) {
          result.sma = calculateSMA(prices, 20)
        }
        if (indicators.includes('RSI')) {
          result.rsi = calculateRSI(prices)
        }
        if (indicators.includes('BOLLINGER')) {
          result.bollinger = calculateBollingerBands(prices)
        }
        if (indicators.includes('MACD')) {
          result.macd = calculateMACD(prices)
        }
        break
        
      default:
        throw new Error(`Unknown calculation type: ${type}`)
    }
    
    self.postMessage({
      id,
      type: 'SUCCESS',
      result
    })
    
  } catch (error) {
    self.postMessage({
      id,
      type: 'ERROR',
      error: error.message
    })
  }
})

// Error handling
self.addEventListener('error', (e) => {
  console.error('Worker error:', e.error)
})

self.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection in worker:', e.reason)
})
