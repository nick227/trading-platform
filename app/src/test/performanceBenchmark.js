// Performance benchmarking with actual measurements

export class PerformanceBenchmark {
  constructor() {
    this.results = new Map()
  }

  // Benchmark function with multiple iterations
  async benchmark(name, fn, iterations = 1000) {
    console.log(`Benchmarking ${name}...`)
    
    const times = []
    const memoryBefore = this.getMemoryUsage()
    
    // Warm up
    for (let i = 0; i < 10; i++) {
      fn()
    }
    
    // Actual benchmark
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      fn()
      const end = performance.now()
      times.push(end - start)
    }
    
    const memoryAfter = this.getMemoryUsage()
    
    const stats = {
      name,
      iterations,
      average: times.reduce((sum, time) => sum + time, 0) / times.length,
      min: Math.min(...times),
      max: Math.max(...times),
      median: this.median(times),
      p95: this.percentile(times, 95),
      memoryDelta: memoryAfter - memoryBefore,
      times
    }
    
    this.results.set(name, stats)
    console.log(`${name} Results:`, stats)
    return stats
  }

  // Compare before/after implementations
  async compare(name, beforeFn, afterFn, iterations = 1000) {
    console.log(`Comparing ${name}...`)
    
    const beforeStats = await this.benchmark(`${name}_before`, beforeFn, iterations)
    const afterStats = await this.benchmark(`${name}_after`, afterFn, iterations)
    
    const improvement = {
      timeImprovement: ((beforeStats.average - afterStats.average) / beforeStats.average) * 100,
      memoryImprovement: ((beforeStats.memoryDelta - afterStats.memoryDelta) / Math.abs(beforeStats.memoryDelta)) * 100,
      p95Improvement: ((beforeStats.p95 - afterStats.p95) / beforeStats.p95) * 100
    }
    
    console.log(`${name} Comparison:`, improvement)
    return { beforeStats, afterStats, improvement }
  }

  // Memory usage measurement
  getMemoryUsage() {
    if (performance.memory) {
      return performance.memory.usedJSHeapSize
    }
    return 0
  }

  // Statistical helpers
  median(arr) {
    const sorted = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 
      ? (sorted[mid - 1] + sorted[mid]) / 2 
      : sorted[mid]
  }

  percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b)
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[index]
  }

  // Generate report
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      benchmarks: Array.from(this.results.entries()).map(([name, stats]) => ({
        name,
        ...stats
      }))
    }
    
    console.log('Performance Benchmark Report:', report)
    return report
  }

  // Clear results
  clear() {
    this.results.clear()
  }
}

// Test data generators
export const TestData = {
  // Generate test executions
  generateExecutions(count = 1000) {
    const executions = []
    const tickers = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA']
    const sides = ['BUY', 'SELL']
    
    for (let i = 0; i < count; i++) {
      executions.push({
        id: `exec_${i}`,
        ticker: tickers[i % tickers.length],
        side: sides[i % sides.length],
        quantity: Math.random() * 100 + 1,
        price: Math.random() * 500 + 50,
        createdAt: Date.now() - (count - i) * 1000
      })
    }
    
    return executions
  },

  // Generate test price history
  generatePriceHistory(basePrice = 100, points = 30) {
    const history = []
    let currentPrice = basePrice
    
    for (let i = 0; i < points; i++) {
      currentPrice = currentPrice * (1 + (Math.random() - 0.5) * 0.02)
      history.push({
        date: new Date(Date.now() - (points - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        price: currentPrice,
        volume: Math.floor(Math.random() * 1000000) + 100000
      })
    }
    
    return history
  },

  // Generate test stocks
  generateStocks(count = 100) {
    const stocks = []
    const names = ['Apple', 'Google', 'Microsoft', 'Tesla', 'NVIDIA', 'Amazon', 'Meta', ' Berkshire']
    
    for (let i = 0; i < count; i++) {
      stocks.push({
        symbol: `SYMBOL${i}`,
        name: `${names[i % names.length]} ${i}`,
        price: Math.random() * 500 + 50,
        change: (Math.random() - 0.5) * 10,
        volume: `${Math.floor(Math.random() * 100)}M`
      })
    }
    
    return stocks
  }
}

// Benchmark tests
export async function runPerformanceBenchmarks() {
  const benchmark = new PerformanceBenchmark()
  
  console.log('Starting Performance Benchmarks...')
  
  // Test 1: Price history generation
  await benchmark.compare(
    'price_history_generation',
    () => {
      // Before: Original implementation
      const basePrice = 100
      const history = []
      let currentPrice = basePrice * 0.8
      
      for (let i = 0; i < 30; i++) {
        currentPrice = currentPrice * (1 + (Math.random() - 0.5) * 0.02)
        history.push({
          date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          price: currentPrice,
          volume: Math.floor(Math.random() * 1000000) + 100000
        })
      }
      return history
    },
    () => {
      // After: Pre-allocated with templates
      const basePrice = 100
      const history = new Array(30)
      const dateTemplates = Array.from({length: 30}, (_, i) => 
        new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      )
      let currentPrice = basePrice * 0.8
      
      for (let i = 0; i < 30; i++) {
        currentPrice = currentPrice * (1 + (Math.random() - 0.5) * 0.02)
        history[i] = {
          date: dateTemplates[i],
          price: currentPrice,
          volume: Math.floor(Math.random() * 1000000) + 100000
        }
      }
      return history
    }
  )
  
  // Test 2: Position derivation
  const testExecutions = TestData.generateExecutions(1000)
  
  await benchmark.compare(
    'position_derivation',
    () => {
      // Before: Original implementation
      const positions = {}
      const sortedExecutions = [...testExecutions].sort((a, b) => a.createdAt - b.createdAt)
      
      sortedExecutions.forEach(execution => {
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
          positions[execution.ticker].buyTrades.push({
            quantity: execution.quantity,
            cost: execution.price * execution.quantity
          })
        }
      })
      
      return Object.values(positions).filter(p => p.quantity > 0)
    },
    () => {
      // After: Single pass
      const positions = new Map()
      const sortedExecutions = [...testExecutions].sort((a, b) => a.createdAt - b.createdAt)
      
      for (let i = 0; i < sortedExecutions.length; i++) {
        const execution = sortedExecutions[i]
        let position = positions.get(execution.ticker)
        
        if (!position) {
          position = {
            ticker: execution.ticker,
            quantity: 0,
            totalCost: 0,
            buyTrades: []
          }
          positions.set(execution.ticker, position)
        }
        
        if (execution.side === 'BUY') {
          position.quantity += execution.quantity
          position.totalCost += execution.price * execution.quantity
          position.buyTrades.push({
            quantity: execution.quantity,
            cost: execution.price * execution.quantity
          })
        }
      }
      
      const result = []
      for (const position of positions.values()) {
        if (position.quantity > 0) {
          result.push(position)
        }
      }
      return result
    }
  )
  
  // Test 3: Array operations
  const testStocks = TestData.generateStocks(1000)
  
  await benchmark.compare(
    'array_operations',
    () => {
      // Before: Multiple passes
      return testStocks
        .filter(stock => stock.price > 100)
        .map(stock => ({ ...stock, processed: true }))
        .slice(0, 100)
    },
    () => {
      // After: Single pass
      const results = []
      let count = 0
      
      for (let i = 0; i < testStocks.length && count < 100; i++) {
        const stock = testStocks[i]
        if (stock.price > 100) {
          results.push({ ...stock, processed: true })
          count++
        }
      }
      
      return results
    }
  )
  
  return benchmark.generateReport()
}

// Validation tests for correctness
export function validateCorrectness() {
  console.log('Validating optimization correctness...')
  
  // Test 1: Position derivation correctness
  const testExecutions = TestData.generateExecutions(100)
  
  const originalResult = (() => {
    const positions = {}
    const sortedExecutions = [...testExecutions].sort((a, b) => a.createdAt - b.createdAt)
    
    sortedExecutions.forEach(execution => {
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
        positions[execution.ticker].buyTrades.push({
          quantity: execution.quantity,
          cost: execution.price * execution.quantity
        })
      }
    })
    
    return Object.values(positions).filter(p => p.quantity > 0)
  })()
  
  const optimizedResult = (() => {
    const positions = new Map()
    const sortedExecutions = [...testExecutions].sort((a, b) => a.createdAt - b.createdAt)
    
    for (let i = 0; i < sortedExecutions.length; i++) {
      const execution = sortedExecutions[i]
      let position = positions.get(execution.ticker)
      
      if (!position) {
        position = {
          ticker: execution.ticker,
          quantity: 0,
          totalCost: 0,
          buyTrades: []
        }
        positions.set(execution.ticker, position)
      }
      
      if (execution.side === 'BUY') {
        position.quantity += execution.quantity
        position.totalCost += execution.price * execution.quantity
        position.buyTrades.push({
          quantity: execution.quantity,
          cost: execution.price * execution.quantity
        })
      }
    }
    
    const result = []
    for (const position of positions.values()) {
      if (position.quantity > 0) {
        result.push(position)
      }
    }
    return result
  })()
  
  // Compare results
  const isCorrect = JSON.stringify(originalResult) === JSON.stringify(optimizedResult)
  console.log(`Position derivation correctness: ${isCorrect ? 'PASS' : 'FAIL'}`)
  
  if (!isCorrect) {
    console.error('Original result:', originalResult)
    console.error('Optimized result:', optimizedResult)
  }
  
  return isCorrect
}
