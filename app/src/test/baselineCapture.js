// Capture current performance baselines before any optimizations

export class BaselineCapture {
  constructor() {
    this.metrics = {
      componentRenderTimes: new Map(),
      memorySnapshots: [],
      apiResponseTimes: new Map(),
      userInteractions: []
    }
  }

  // Capture component render performance
  measureComponentRender(componentName, renderFn) {
    const start = performance.now()
    const result = renderFn()
    const end = performance.now()
    
    const renderTime = end - start
    this.metrics.componentRenderTimes.set(componentName, renderTime)
    
    console.log(`Baseline - ${componentName} render: ${renderTime.toFixed(2)}ms`)
    return result
  }

  // Capture memory usage
  captureMemoryUsage(label = 'baseline') {
    if (performance.memory) {
      const snapshot = {
        label,
        timestamp: Date.now(),
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit
      }
      
      this.metrics.memorySnapshots.push(snapshot)
      console.log(`Baseline - Memory (${label}): ${(snapshot.used / 1024 / 1024).toFixed(2)}MB`)
      
      return snapshot
    }
    
    return null
  }

  // Capture API response time
  measureApiCall(apiName, apiFn) {
    const start = performance.now()
    return apiFn().then(result => {
      const end = performance.now()
      const responseTime = end - start
      
      this.metrics.apiResponseTimes.set(apiName, responseTime)
      console.log(`Baseline - ${apiName} API: ${responseTime.toFixed(2)}ms`)
      
      return result
    }).catch(error => {
      const end = performance.now()
      const responseTime = end - start
      
      this.metrics.apiResponseTimes.set(apiName, responseTime)
      console.log(`Baseline - ${apiName} API (error): ${responseTime.toFixed(2)}ms`)
      
      throw error
    })
  }

  // Capture user interaction latency
  measureInteraction(interactionName, interactionFn) {
    const start = performance.now()
    const result = interactionFn()
    const end = performance.now()
    
    const interactionTime = end - start
    this.metrics.userInteractions.push({
      name: interactionName,
      time: interactionTime,
      timestamp: Date.now()
    })
    
    console.log(`Baseline - ${interactionName} interaction: ${interactionTime.toFixed(2)}ms`)
    return result
  }

  // Generate baseline report
  generateReport() {
    const renderTimes = Array.from(this.metrics.componentRenderTimes.entries())
    const apiTimes = Array.from(this.metrics.apiResponseTimes.entries())
    
    const report = {
      timestamp: new Date().toISOString(),
      renderPerformance: {
        average: renderTimes.reduce((sum, [_, time]) => sum + time, 0) / renderTimes.length,
        slowest: renderTimes.reduce((max, [_, time]) => Math.max(max, time), 0),
        components: renderTimes.map(([name, time]) => ({ name, time }))
      },
      apiPerformance: {
        average: apiTimes.reduce((sum, [_, time]) => sum + time, 0) / apiTimes.length,
        slowest: apiTimes.reduce((max, [_, time]) => Math.max(max, time), 0),
        apis: apiTimes.map(([name, time]) => ({ name, time }))
      },
      memoryUsage: {
        current: this.metrics.memorySnapshots[this.metrics.memorySnapshots.length - 1],
        peak: this.metrics.memorySnapshots.reduce((max, snapshot) => Math.max(max, snapshot.used), 0),
        snapshots: this.metrics.memorySnapshots
      },
      interactions: {
        average: this.metrics.userInteractions.reduce((sum, interaction) => sum + interaction.time, 0) / this.metrics.userInteractions.length,
        slowest: this.metrics.userInteractions.reduce((max, interaction) => Math.max(max, interaction.time), 0),
        total: this.metrics.userInteractions.length
      }
    }
    
    console.log('Baseline Report:', report)
    return report
  }

  // Clear all metrics
  clear() {
    this.metrics.componentRenderTimes.clear()
    this.metrics.memorySnapshots = []
    this.metrics.apiResponseTimes.clear()
    this.metrics.userInteractions = []
  }
}

// Specific baseline captures for trading platform
export class TradingPlatformBaseline extends BaselineCapture {
  constructor() {
    super()
    this.baselineData = {
      ordersPage: {},
      portfolioPage: {},
      marketDataGeneration: {},
      positionCalculation: {},
      searchOperations: {},
      chartRendering: {}
    }
  }

  // Capture Orders page performance
  captureOrdersPageBaseline() {
    console.log('Capturing Orders page baseline...')
    
    // Measure search performance
    const searchTest = () => {
      const stocks = Array.from({length: 100}, (_, i) => ({
        symbol: `STOCK${i}`,
        name: `Stock ${i}`,
        price: Math.random() * 500 + 50
      }))
      
      // Simulate search filtering
      return stocks.filter(stock => 
        stock.symbol.toLowerCase().includes('test') || 
        stock.name.toLowerCase().includes('test')
      )
    }
    
    this.measureInteraction('orders_search', searchTest)
    
    // Measure price history generation
    const priceHistoryTest = () => {
      const history = []
      let currentPrice = 100
      
      for (let i = 0; i < 30; i++) {
        currentPrice = currentPrice * (1 + (Math.random() - 0.5) * 0.02)
        history.push({
          date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          price: currentPrice,
          volume: Math.floor(Math.random() * 1000000) + 100000
        })
      }
      
      return history
    }
    
    this.measureInteraction('price_history_generation', priceHistoryTest)
    
    // Capture memory snapshot
    this.captureMemoryUsage('orders_page_after_load')
  }

  // Capture Portfolio page performance
  capturePortfolioPageBaseline() {
    console.log('Capturing Portfolio page baseline...')
    
    // Measure position calculation
    const positionCalculationTest = () => {
      const executions = Array.from({length: 1000}, (_, i) => ({
        id: `exec_${i}`,
        ticker: ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA'][i % 5],
        side: i % 2 === 0 ? 'BUY' : 'SELL',
        quantity: Math.random() * 100 + 1,
        price: Math.random() * 500 + 50,
        createdAt: Date.now() - (1000 - i) * 1000
      }))
      
      // Simulate position calculation
      const positions = {}
      const sortedExecutions = executions.sort((a, b) => a.createdAt - b.createdAt)
      
      for (const execution of sortedExecutions) {
        if (!positions[execution.ticker]) {
          positions[execution.ticker] = {
            ticker: execution.ticker,
            quantity: 0,
            totalCost: 0,
            buyTrades: []
          }
        }
        
        if (execution.side === 'BUY') {
          positions[execution.ticker].quantity += execution.quantity
          positions[execution.ticker].totalCost += execution.price * execution.quantity
        }
      }
      
      return Object.values(positions)
    }
    
    this.measureInteraction('position_calculation', positionCalculationTest)
    
    // Capture memory snapshot
    this.captureMemoryUsage('portfolio_page_after_calc')
  }

  // Capture market data generation performance
  captureMarketDataBaseline() {
    console.log('Capturing market data generation baseline...')
    
    const marketDataTest = () => {
      const stocks = []
      const predictions = {}
      
      // Generate stock data
      for (let i = 0; i < 8; i++) {
        const symbol = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'BRK.B'][i]
        stocks.push({
          symbol,
          name: `${symbol} Corporation`,
          price: Math.random() * 500 + 50,
          change: (Math.random() - 0.5) * 10
        })
        
        predictions[symbol] = {
          signal: Math.random() > 0.5 ? 'BUY' : 'SELL',
          confidence: Math.random() * 100,
          target: Math.random() * 600 + 100
        }
      }
      
      return { stocks, predictions }
    }
    
    this.measureInteraction('market_data_generation', marketDataTest)
    
    // Capture memory snapshot
    this.captureMemoryUsage('market_data_after_generation')
  }

  // Run complete baseline capture
  runCompleteBaseline() {
    console.log('Running complete baseline capture...')
    
    this.clear()
    
    // Capture initial state
    this.captureMemoryUsage('initial_state')
    
    // Capture each major component
    this.captureOrdersPageBaseline()
    this.capturePortfolioPageBaseline()
    this.captureMarketDataBaseline()
    
    // Wait a bit for any async operations
    setTimeout(() => {
      this.captureMemoryUsage('final_state')
      
      const report = this.generateReport()
      
      // Save baseline to localStorage for comparison
      localStorage.setItem('performance_baseline', JSON.stringify(report))
      
      console.log('Baseline capture complete. Report saved to localStorage.')
    }, 1000)
  }
}

// Export baseline capture instance
export const baselineCapture = new TradingPlatformBaseline()
