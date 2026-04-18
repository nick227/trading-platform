// Memory-efficient data service with object pooling and buffer reuse

// Object pool for reusing objects
class ObjectPool {
  constructor(createFn, resetFn, maxSize = 100) {
    this.createFn = createFn
    this.resetFn = resetFn
    this.pool = []
    this.maxSize = maxSize
  }

  acquire() {
    if (this.pool.length > 0) {
      return this.pool.pop()
    }
    return this.createFn()
  }

  release(obj) {
    if (this.pool.length < this.maxSize) {
      this.resetFn(obj)
      this.pool.push(obj)
    }
  }

  clear() {
    this.pool.length = 0
  }
}

// Reusable buffers for calculations
class BufferPool {
  constructor(initialSize = 100) {
    this.buffers = new Map()
    this.initialSize = initialSize
  }

  getBuffer(size) {
    const key = size
    if (!this.buffers.has(key)) {
      this.buffers.set(key, new Array(size))
    }
    return this.buffers.get(key)
  }

  releaseBuffer(key) {
    // Keep buffer for reuse
  }

  clear() {
    this.buffers.clear()
  }
}

// Pre-allocated object pools
const positionPool = new ObjectPool(
  () => ({
    ticker: '',
    quantity: 0,
    totalCost: 0,
    avgCost: 0,
    buyTrades: []
  }),
  (obj) => {
    obj.ticker = ''
    obj.quantity = 0
    obj.totalCost = 0
    obj.avgCost = 0
    obj.buyTrades.length = 0
  },
  50
)

const pricePointPool = new ObjectPool(
  () => ({
    date: '',
    price: 0,
    volume: 0
  }),
  (obj) => {
    obj.date = ''
    obj.price = 0
    obj.volume = 0
  },
  100
)

const bufferPool = new BufferPool()

// Pre-computed date templates to avoid Date object creation
const DATE_TEMPLATES = (() => {
  const templates = new Array(30)
  const now = Date.now()
  
  for (let i = 0; i < 30; i++) {
    const date = new Date(now - (29 - i) * 24 * 60 * 60 * 1000)
    templates[i] = date.toISOString().split('T')[0]
  }
  
  return templates
})()

// Memory-efficient price history generation
export function generatePriceHistoryEfficient(basePrice, volatility = 0.02) {
  const history = bufferPool.getBuffer(30)
  let currentPrice = basePrice * (1 - volatility * 10)
  
  // Reuse objects from pool
  for (let i = 0; i < 30; i++) {
    currentPrice = currentPrice * (1 + (Math.random() - 0.5) * volatility)
    
    const point = pricePointPool.acquire()
    point.date = DATE_TEMPLATES[i]
    point.price = currentPrice
    point.volume = Math.floor(Math.random() * 1000000) + 100000
    
    history[i] = point
  }
  
  // Return copy to avoid pool contamination
  return history.slice()
}

// Memory-efficient mini chart generation
export function generateMiniChartEfficient(basePrice, points = 15) {
  const buffer = bufferPool.getBuffer(points)
  let currentPrice = basePrice
  
  // Pre-allocate and reuse buffer
  for (let i = 0; i < points; i++) {
    const change = (Math.random() - 0.5) * basePrice * 0.02
    currentPrice = Math.max(currentPrice + change, basePrice * 0.8)
    buffer[i] = Math.round(currentPrice * 100) / 100
  }
  
  // Return copy
  return buffer.slice(0, points)
}

// Memory-efficient position derivation
export function derivePositionsEfficient(executions) {
  const positions = new Map()
  const result = []
  
  // Sort executions once
  const sortedExecutions = executions.sort((a, b) => a.createdAt - b.createdAt)
  
  // Single pass with object reuse
  for (let i = 0; i < sortedExecutions.length; i++) {
    const execution = sortedExecutions[i]
    let position = positions.get(execution.ticker)
    
    if (!position) {
      position = positionPool.acquire()
      position.ticker = execution.ticker
      positions.set(execution.ticker, position)
    }
    
    if (execution.side === 'BUY') {
      position.quantity += execution.quantity
      position.totalCost += execution.price * execution.quantity
      
      // Reuse buyTrade objects
      if (!position.buyTrades) position.buyTrades = []
      position.buyTrades.push({
        quantity: execution.quantity,
        cost: execution.price * execution.quantity
      })
    } else if (execution.side === 'SELL') {
      let sharesToSell = execution.quantity
      
      // FIFO logic with minimal object creation
      while (sharesToSell > 0 && position.buyTrades.length > 0) {
        const oldestBuy = position.buyTrades[0]
        const sharesFromOldest = Math.min(sharesToSell, oldestBuy.quantity)
        
        const costToRemove = (oldestBuy.cost / oldestBuy.quantity) * sharesFromOldest
        position.totalCost -= costToRemove
        
        oldestBuy.quantity -= sharesFromOldest
        oldestBuy.cost -= costToRemove
        
        if (oldestBuy.quantity === 0) {
          position.buyTrades.shift()
        }
        
        sharesToSell -= sharesFromOldest
      }
      
      position.quantity -= execution.quantity
    }
    
    if (position.quantity > 0) {
      position.avgCost = position.totalCost / position.quantity
    }
  }
  
  // Build result array with minimal allocations
  for (const position of positions.values()) {
    if (position.quantity > 0) {
      result.push({
        ticker: position.ticker,
        quantity: position.quantity,
        avgCost: position.avgCost,
        totalCost: position.totalCost,
        marketValue: position.quantity * position.avgCost,
        buyTrades: position.buyTrades.slice() // Copy array
      })
      
      // Return object to pool
      positionPool.release(position)
    }
  }
  
  return result
}

// Memory-efficient stock search with reusable indices
class StockIndex {
  constructor() {
    this.stocks = []
    this.bySymbol = new Map()
    this.byName = new Map()
    this.symbolList = []
    this.nameList = []
    this.built = false
  }
  
  build(stockData) {
    if (this.built) return
    
    this.stocks = stockData
    this.bySymbol.clear()
    this.byName.clear()
    
    // Pre-allocate arrays
    this.symbolList = new Array(stockData.length)
    this.nameList = new Array(stockData.length)
    
    // Single pass to build all indices
    for (let i = 0; i < stockData.length; i++) {
      const stock = stockData[i]
      this.bySymbol.set(stock.symbol, stock)
      this.byName.set(stock.name.toLowerCase(), stock)
      this.symbolList[i] = stock.symbol
      this.nameList[i] = stock.name.toLowerCase()
    }
    
    this.built = true
  }
  
  search(query) {
    if (!this.built) return []
    
    const term = query.toLowerCase().trim()
    
    // O(1) exact matches
    const symbolMatch = this.bySymbol.get(term.toUpperCase())
    if (symbolMatch) return [symbolMatch]
    
    const nameMatch = this.byName.get(term)
    if (nameMatch) return [nameMatch]
    
    // Fallback to partial matches
    const results = []
    for (let i = 0; i < this.stocks.length; i++) {
      const stock = this.stocks[i]
      if (stock.symbol.toLowerCase().includes(term) || 
          stock.name.toLowerCase().includes(term)) {
        results.push(stock)
      }
    }
    
    return results
  }
  
  clear() {
    this.built = false
    this.bySymbol.clear()
    this.byName.clear()
    this.symbolList.length = 0
    this.nameList.length = 0
  }
}

// Singleton stock index
const stockIndex = new StockIndex()

// Memory-efficient stock operations
export function getAvailableStocksEfficient() {
  if (!stockIndex.built) {
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
    
    stockIndex.build(stocks)
  }
  
  return stockIndex.stocks
}

export function searchStocksEfficient(query) {
  getAvailableStocksEfficient() // Ensure index is built
  return stockIndex.search(query)
}

// Memory cleanup utilities
export function clearMemoryPools() {
  positionPool.clear()
  pricePointPool.clear()
  bufferPool.clear()
  stockIndex.clear()
}

// Memory statistics for monitoring
export function getMemoryStats() {
  return {
    positionPoolSize: positionPool.pool.length,
    pricePointPoolSize: pricePointPool.pool.length,
    bufferPoolSize: bufferPool.buffers.size,
    stockIndexBuilt: stockIndex.built
  }
}
