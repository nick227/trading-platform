// Shared Signal Cache Service for Multi-User Strategy Optimization
class SignalCacheService {
  constructor() {
    this.cache = new Map()
    this.subscribers = new Map() // strategyId -> Set of botIds
    this.updateIntervals = new Map() // strategyId -> intervalId
    this.lastUpdate = new Map() // strategyId -> timestamp
  }

  // Subscribe a bot to shared strategy signals
  subscribe(strategyId, botId, userConfig) {
    if (!this.subscribers.has(strategyId)) {
      this.subscribers.set(strategyId, new Set())
    }
    this.subscribers.get(strategyId).add({ botId, userConfig })
    
    // Start signal generation if not already running
    if (!this.updateIntervals.has(strategyId)) {
      this.startSignalGeneration(strategyId)
    }
    
    // Return cached signals if available
    return this.cache.get(strategyId) || null
  }

  // Unsubscribe bot from strategy signals
  unsubscribe(strategyId, botId) {
    const subscribers = this.subscribers.get(strategyId)
    if (subscribers) {
      subscribers.forEach(subscriber => {
        if (subscriber.botId === botId) {
          subscribers.delete(subscriber)
        }
      })
      
      // Stop signal generation if no subscribers
      if (subscribers.size === 0) {
        this.stopSignalGeneration(strategyId)
      }
    }
  }

  // Start generating signals for a strategy
  startSignalGeneration(strategyId) {
    const strategy = this.getStrategyConfig(strategyId)
    const interval = this.getUpdateInterval(strategy.metadata.cadence)
    
    // Generate initial signals
    this.generateSignals(strategyId)
    
    // Set up periodic updates
    const intervalId = setInterval(() => {
      this.generateSignals(strategyId)
    }, interval)
    
    this.updateIntervals.set(strategyId, intervalId)
  }

  // Stop generating signals for a strategy
  stopSignalGeneration(strategyId) {
    const intervalId = this.updateIntervals.get(strategyId)
    if (intervalId) {
      clearInterval(intervalId)
      this.updateIntervals.delete(strategyId)
    }
    this.cache.delete(strategyId)
    this.lastUpdate.delete(strategyId)
  }

  // Generate signals for all tickers in strategy
  async generateSignals(strategyId) {
    try {
      const strategy = this.getStrategyConfig(strategyId)
      const subscribers = this.subscribers.get(strategyId) || new Set()
      
      // Collect all unique tickers from all subscribers
      const allTickers = new Set()
      subscribers.forEach(({ userConfig }) => {
        userConfig.tickers?.forEach(ticker => allTickers.add(ticker))
      })
      
      // Single API call for all tickers
      const marketData = await this.fetchMarketData(Array.from(allTickers), strategy)
      
      // Generate signals once for all tickers
      const signals = await this.processSignals(strategy, marketData)
      
      // Cache the signals
      this.cache.set(strategyId, {
        signals,
        timestamp: Date.now(),
        tickers: Array.from(allTickers)
      })
      
      this.lastUpdate.set(strategyId, Date.now())
      
      // Notify all subscribers
      this.notifySubscribers(strategyId, signals)
      
    } catch (error) {
      console.error(`Failed to generate signals for ${strategyId}:`, error)
    }
  }

  // Fetch market data for multiple tickers efficiently
  async fetchMarketData(tickers, strategy) {
    // Batch API calls for all tickers
    const promises = tickers.map(async (ticker) => {
      const data = await this.getTickerData(ticker, strategy)
      return { ticker, data }
    })
    
    return Promise.all(promises)
  }

  // Get ticker data based on strategy requirements
  async getTickerData(ticker, strategy) {
    switch (strategy.algorithm?.type) {
      case 'statistical_arbitrage':
        return this.getPairsTradingData(ticker)
      case 'options_sentiment':
        return this.getOptionsFlowData(ticker)
      case 'sentiment_scoring':
        return this.getSentimentData(ticker)
      default:
        return this.getTechnicalData(ticker)
    }
  }

  // Process signals based on strategy algorithm
  async processSignals(strategy, marketData) {
    const signals = {}
    
    marketData.forEach(({ ticker, data }) => {
      signals[ticker] = this.calculateStrategySignals(strategy, data)
    })
    
    return signals
  }

  // Calculate strategy-specific signals
  calculateStrategySignals(strategy, data) {
    switch (strategy.algorithm?.type) {
      case 'statistical_arbitrage':
        return this.calculatePairsSignals(strategy.algorithm, data)
      case 'options_sentiment':
        return this.calculateOptionsSignals(strategy.algorithm, data)
      case 'sentiment_scoring':
        return this.calculateSentimentSignals(strategy.algorithm, data)
      default:
        return this.calculateTechnicalSignals(strategy, data)
    }
  }

  // Get cached signals for a specific bot
  getBotSignals(strategyId, botId) {
    const cached = this.cache.get(strategyId)
    if (!cached) return null
    
    const subscribers = this.subscribers.get(strategyId) || new Set()
    const subscriber = Array.from(subscribers).find(sub => sub.botId === botId)
    
    if (!subscriber) return null
    
    // Filter signals for this bot's specific tickers
    const botSignals = {}
    subscriber.userConfig.tickers?.forEach(ticker => {
      if (cached.signals[ticker]) {
        botSignals[ticker] = cached.signals[ticker]
      }
    })
    
    return botSignals
  }

  // Notify subscribers of new signals
  notifySubscribers(strategyId, signals) {
    const subscribers = this.subscribers.get(strategyId) || new Set()
    
    subscribers.forEach(({ botId, userConfig }) => {
      // Send signals to worker for this specific bot
      this.sendToWorker(botId, signals, userConfig)
    })
  }

  // Send signals to worker bot
  async sendToWorker(botId, signals, userConfig) {
    // Filter signals for this bot's tickers and apply user-specific limits
    const botSignals = {}
    let confidence = 0
    
    userConfig.tickers?.forEach(ticker => {
      if (signals[ticker]) {
        botSignals[ticker] = signals[ticker]
        confidence = Math.max(confidence, signals[ticker].confidence || 0)
      }
    })
    
    // Apply user's aggression/confidence settings
    const minConfidence = this.calculateMinConfidence(userConfig.aggression || 0.7)
    
    if (confidence >= minConfidence) {
      // Send to worker with user-specific configuration
      await this.workerService.executeBot(botId, {
        signals: botSignals,
        config: userConfig,
        timestamp: Date.now()
      })
    }
  }

  // Calculate minimum confidence from aggression
  calculateMinConfidence(aggression) {
    return Math.min(0.9, Math.max(0.3, 1.1 - aggression))
  }

  // Get update interval based on strategy cadence
  getUpdateInterval(cadence) {
    const intervals = {
      'Real-time': 1000,      // 1 second
      'Intraday': 60000,     // 1 minute
      'Hourly': 3600000,     // 1 hour
      'Daily': 86400000,     // 1 day
      'Weekly': 604800000    // 1 week
    }
    return intervals[cadence] || 60000
  }

  // Mock strategy config getter
  getStrategyConfig(strategyId) {
    // This would come from the tradingStrategies constants
    return { metadata: { cadence: 'Intraday' }, algorithm: {} }
  }

  // Mock implementations for data fetching
  async getPairsTradingData(ticker) { /* Implementation */ }
  async getOptionsFlowData(ticker) { /* Implementation */ }
  async getSentimentData(ticker) { /* Implementation */ }
  async getTechnicalData(ticker) { /* Implementation */ }
  async calculatePairsSignals(algorithm, data) { /* Implementation */ }
  async calculateOptionsSignals(algorithm, data) { /* Implementation */ }
  async calculateSentimentSignals(algorithm, data) { /* Implementation */ }
  async calculateTechnicalSignals(strategy, data) { /* Implementation */ }
}

export default new SignalCacheService()
