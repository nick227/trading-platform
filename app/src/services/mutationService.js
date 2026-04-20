// Mutation Service - Handles cache invalidation and optimistic updates after trades
// Critical for maintaining data consistency across the application

import { invalidationRules, invalidateByPattern, getCacheKey, getCacheItem, setCacheItem, getCacheMetrics, cacheKeys, CACHE_NAMESPACES } from '../utils/sharedCache.js'

class MutationService {
  constructor() {
    this.mutationQueue = []
    this.isProcessing = false
  }

  // Trade execution mutation (confirmed fill)
  async afterTradeExecution(tradeData) {
    const { symbol, side, quantity, price, orderId, executionId } = tradeData
    
    console.log(`Processing confirmed trade execution: ${side} ${quantity} ${symbol} @ ${price}`)
    
    // 1. Remove from pending orders
    this.removeFromPendingOrders(orderId)
    
    // 2. Release reserved cash
    this.releaseReservedCash(tradeData)
    
    // 3. Update actual holdings (no longer optimistic)
    this.updateActualHoldings(tradeData)
    
    // 4. Invalidate relevant caches
    invalidationRules.afterTrade(symbol, side)
    
    // 5. Trigger portfolio refresh
    this.schedulePortfolioRefresh()
    
    // 6. Log mutation for debugging
    this.logMutation('TRADE_EXECUTION', tradeData)
  }
  
  // Remove from pending orders
  removeFromPendingOrders(orderId) {
    const pendingKey = cacheKeys.portfolio.pendingOrders()
    const pendingOrders = getCacheItem(pendingKey)
    
    if (pendingOrders && pendingOrders.orders) {
      pendingOrders.orders = pendingOrders.orders.filter(order => order.orderId !== orderId)
      setCacheItem(pendingKey, pendingOrders, 60_000)
    }
  }
  
  // Release reserved cash
  releaseReservedCash(tradeData) {
    const { side, quantity, price } = tradeData
    const balanceKey = cacheKeys.portfolio.balance()
    const balance = getCacheItem(balanceKey)
    
    if (balance && side === 'BUY') {
      const reservedAmount = quantity * price
      const updatedBalance = {
        ...balance,
        buyingPower: balance.buyingPower + reservedAmount,
        reservedCash: Math.max(0, (balance.reservedCash || 0) - reservedAmount),
        pendingOrders: Math.max(0, (balance.pendingOrders || 0) - 1)
      }
      setCacheItem(balanceKey, updatedBalance, 30_000)
    }
  }
  
  // Update actual holdings (confirmed fill)
  updateActualHoldings(tradeData) {
    const { symbol, side, quantity, price } = tradeData
    
    try {
      const holdingsKey = cacheKeys.portfolio.holdings()
      const holdings = getCacheItem(holdingsKey)
      
      if (holdings && holdings.positions) {
        const updatedHoldings = { ...holdings }
        const existingPosition = updatedHoldings.positions.find(p => p.symbol === symbol)
        
        if (existingPosition) {
          // Update existing position
          const quantityChange = side === 'BUY' ? quantity : -quantity
          existingPosition.quantity += quantityChange
          existingPosition.avgCost = this.calculateNewAverageCost(existingPosition, tradeData)
          existingPosition.marketValue = existingPosition.quantity * price
          existingPosition.unrealizedPnL = (price - existingPosition.avgCost) * existingPosition.quantity
          
          // Remove optimistic flag
          delete existingPosition._optimistic
          
          // Remove position if quantity is zero
          if (existingPosition.quantity <= 0) {
            updatedHoldings.positions = updatedHoldings.positions.filter(p => p.symbol !== symbol)
          }
        } else if (side === 'BUY') {
          // Add new position
          updatedHoldings.positions.push({
            symbol,
            quantity,
            avgCost: price,
            marketValue: quantity * price,
            unrealizedPnL: 0,
            side: 'LONG'
          })
        }
        
        // Update portfolio totals
        updatedHoldings.totalValue = updatedHoldings.positions.reduce((sum, pos) => sum + pos.marketValue, 0)
        updatedHoldings.totalCost = updatedHoldings.positions.reduce((sum, pos) => sum + (pos.avgCost * pos.quantity), 0)
        updatedHoldings.totalUnrealizedPnL = updatedHoldings.totalValue - updatedHoldings.totalCost
        
        // Clear optimistic flag if all positions are real
        const hasOptimistic = updatedHoldings.positions.some(p => p._optimistic)
        if (!hasOptimistic) {
          delete updatedHoldings._hasOptimistic
        }
        
        setCacheItem(holdingsKey, updatedHoldings, 60_000) // 1 minute for confirmed data
        
        console.log(`Actual holdings updated for ${symbol}`)
      }
    } catch (error) {
      console.error('Actual holdings update failed:', error)
    }
  }

  // Order cancellation mutation
  async afterOrderCancel(orderData) {
    const { orderId, symbol, side } = orderData
    
    console.log(`Processing order cancellation: ${orderId}`)
    
    // 1. Remove from pending orders
    this.removeFromPendingOrders(orderId)
    
    // 2. Release reserved cash
    this.releaseReservedCash(orderData)
    
    // 3. Remove any optimistic positions
    this.removeOptimisticPosition(symbol)
    
    // 4. Invalidate order-related caches
    invalidationRules.afterOrderCancel(orderId)
    
    // 5. Schedule portfolio refresh
    this.schedulePortfolioRefresh()
    
    this.logMutation('ORDER_CANCEL', orderData)
  }
  
  // Remove optimistic position
  removeOptimisticPosition(symbol) {
    const holdingsKey = cacheKeys.portfolio.holdings()
    const holdings = getCacheItem(holdingsKey)
    
    if (holdings && holdings.positions) {
      const updatedHoldings = { ...holdings }
      
      // Remove optimistic positions only
      updatedHoldings.positions = updatedHoldings.positions.filter(p => 
        !(p.symbol === symbol && p._optimistic)
      )
      
      // Update totals
      updatedHoldings.totalValue = updatedHoldings.positions.reduce((sum, pos) => sum + pos.marketValue, 0)
      updatedHoldings.totalCost = updatedHoldings.positions.reduce((sum, pos) => sum + (pos.avgCost * pos.quantity), 0)
      updatedHoldings.totalUnrealizedPnL = updatedHoldings.totalValue - updatedHoldings.totalCost
      
      // Clear optimistic flag if no optimistic positions remain
      const hasOptimistic = updatedHoldings.positions.some(p => p._optimistic)
      if (!hasOptimistic) {
        delete updatedHoldings._hasOptimistic
      }
      
      setCacheItem(holdingsKey, updatedHoldings, 30_000)
    }
  }

  // Portfolio rebalance mutation
  async afterRebalance(rebalanceData) {
    console.log(`Processing portfolio rebalance`)
    
    // Invalidate portfolio and holdings caches
    invalidationRules.afterRebalance()
    
    // Schedule comprehensive refresh
    this.schedulePortfolioRefresh()
    
    this.logMutation('REBALANCE', rebalanceData)
  }

  // Market data update from worker
  async afterMarketDataUpdate(symbol, quoteData) {
    console.log(`Processing market data update: ${symbol}`)
    
    // Invalidate market-specific caches
    invalidationRules.afterMarketDataUpdate(symbol)
    
    // Optimistic quote update
    this.optimisticQuoteUpdate(symbol, quoteData)
    
    this.logMutation('MARKET_DATA_UPDATE', { symbol, quoteData })
  }

  // Disciplined optimistic holdings update
  optimisticHoldingsUpdate(tradeData) {
    const { symbol, side, quantity, price, orderId } = tradeData
    
    try {
      // Get current holdings from cache
      const holdingsKey = cacheKeys.portfolio.holdings()
      const balanceKey = cacheKeys.portfolio.balance()
      const pendingKey = cacheKeys.portfolio.pendingOrders()
      
      const holdings = getCacheItem(holdingsKey)
      const balance = getCacheItem(balanceKey)
      
      // Create pending order state instead of definite ownership
      const pendingOrder = {
        orderId,
        symbol,
        side,
        quantity,
        price,
        status: 'pending',
        reservedCash: side === 'BUY' ? quantity * price : 0,
        createdAt: Date.now()
      }
      
      // Add to pending orders cache
      const pendingOrders = getCacheItem(pendingKey) || { orders: [] }
      pendingOrders.orders.push(pendingOrder)
      setCacheItem(pendingKey, pendingOrders, 60_000) // 1 minute
      
      // Update balance to reflect reserved cash
      if (balance && side === 'BUY') {
        const reservedAmount = quantity * price
        const updatedBalance = {
          ...balance,
          buyingPower: balance.buyingPower - reservedAmount,
          reservedCash: (balance.reservedCash || 0) + reservedAmount,
          pendingOrders: (balance.pendingOrders || 0) + 1
        }
        setCacheItem(balanceKey, updatedBalance, 30_000) // 30 seconds
      }
      
      // Only show optimistic position for very low-risk scenarios
      // (e.g., market orders during market hours with high confidence)
      if (this.shouldShowOptimisticPosition(tradeData, holdings)) {
        this.updateOptimisticPosition(tradeData, holdings)
      }
      
      console.log(`Disciplined optimistic update: pending order created for ${side} ${quantity} ${symbol}`)
    } catch (error) {
      console.error('Optimistic holdings update failed:', error)
    }
  }
  
  // Helper: determine if optimistic position display is safe
  shouldShowOptimisticPosition(tradeData, holdings) {
    const { side, quantity, price } = tradeData
    
    // Only for BUY orders with small quantities relative to portfolio
    if (side !== 'BUY') return false
    
    // Only if user has sufficient buying power
    const totalCost = quantity * price
    if (holdings && holdings.cash && totalCost > holdings.cash * 0.1) return false
    
    // Only for market orders (not limit/stop)
    // This would depend on your order type data
    
    return true
  }
  
  // Update optimistic position (safe scenarios only)
  updateOptimisticPosition(tradeData, holdings) {
    const { symbol, side, quantity, price } = tradeData
    
    if (!holdings || !holdings.positions) return
    
    const holdingsKey = cacheKeys.portfolio.holdings()
    const updatedHoldings = { ...holdings }
    const existingPosition = updatedHoldings.positions.find(p => p.symbol === symbol)
    
    if (existingPosition && side === 'BUY') {
      // Add to existing position with optimistic flag
      existingPosition.quantity += quantity
      existingPosition.avgCost = this.calculateNewAverageCost(existingPosition, tradeData)
      existingPosition.marketValue = existingPosition.quantity * price
      existingPosition.unrealizedPnL = (price - existingPosition.avgCost) * existingPosition.quantity
      existingPosition._optimistic = true // Mark as optimistic
    } else if (side === 'BUY') {
      // Add new optimistic position
      updatedHoldings.positions.push({
        symbol,
        quantity,
        avgCost: price,
        marketValue: quantity * price,
        unrealizedPnL: 0,
        side: 'LONG',
        _optimistic: true // Mark as optimistic
      })
    }
    
    // Update totals
    updatedHoldings.totalValue = updatedHoldings.positions.reduce((sum, pos) => sum + pos.marketValue, 0)
    updatedHoldings.totalCost = updatedHoldings.positions.reduce((sum, pos) => sum + (pos.avgCost * pos.quantity), 0)
    updatedHoldings.totalUnrealizedPnL = updatedHoldings.totalValue - updatedHoldings.totalCost
    updatedHoldings._hasOptimistic = true // Mark holdings as having optimistic data
    
    // Cache with very short TTL for optimistic data
    setCacheItem(holdingsKey, updatedHoldings, 15_000) // 15 seconds
  }

  // Optimistic quote update
  optimisticQuoteUpdate(symbol, quoteData) {
    try {
      const quoteKey = getCacheKey('QUOTE', symbol)
      const bootstrapKey = getCacheKey('BOOTSTRAP', `${symbol}:1Y:1D`)
      
      // Update quote cache
      setCacheItem(quoteKey, quoteData, 15_000) // 15 seconds
      
      // Update bootstrap cache if it exists
      const bootstrap = getCacheItem(bootstrapKey)
      if (bootstrap && bootstrap.quote) {
        const updatedBootstrap = {
          ...bootstrap,
          quote: { ...bootstrap.quote, ...quoteData },
          _source: 'worker-update',
          _cachedAt: Date.now(),
          _freshness: 'live'
        }
        setCacheItem(bootstrapKey, updatedBootstrap, 15_000)
      }
      
      console.log(`Optimistic quote update completed for ${symbol}`)
    } catch (error) {
      console.error('Optimistic quote update failed:', error)
    }
  }

  // Calculate new average cost
  calculateNewAverageCost(existingPosition, tradeData) {
    const { quantity, price, side } = tradeData
    const currentQuantity = existingPosition.quantity
    const currentAvgCost = existingPosition.avgCost
    
    if (side === 'BUY') {
      const newTotalCost = (currentQuantity * currentAvgCost) + (quantity * price)
      const newTotalQuantity = currentQuantity + quantity
      return newTotalCost / newTotalQuantity
    } else {
      // SELL - average cost doesn't change
      return currentAvgCost
    }
  }

  // Schedule portfolio refresh
  schedulePortfolioRefresh() {
    // Add to mutation queue for batch processing
    this.mutationQueue.push({
      type: 'PORTFOLIO_REFRESH',
      timestamp: Date.now(),
      retryCount: 0
    })
    
    this.processMutationQueue()
  }

  // Process mutation queue
  async processMutationQueue() {
    if (this.isProcessing || this.mutationQueue.length === 0) return
    
    this.isProcessing = true
    
    try {
      while (this.mutationQueue.length > 0) {
        const mutation = this.mutationQueue.shift()
        
        try {
          await this.processMutation(mutation)
        } catch (error) {
          console.error(`Mutation processing failed:`, error)
          
          // Retry logic for critical mutations
          if (mutation.retryCount < 3 && mutation.type === 'PORTFOLIO_REFRESH') {
            mutation.retryCount++
            this.mutationQueue.push(mutation)
          }
        }
      }
    } finally {
      this.isProcessing = false
    }
  }

  // Process individual mutation
  async processMutation(mutation) {
    switch (mutation.type) {
      case 'PORTFOLIO_REFRESH':
        await this.refreshPortfolioData()
        break
      default:
        console.warn(`Unknown mutation type: ${mutation.type}`)
    }
  }

  // Refresh portfolio data
  async refreshPortfolioData() {
    try {
      // This would trigger actual portfolio data refresh
      // Implementation depends on your portfolio service
      console.log('Refreshing portfolio data...')
      
      // Invalidate portfolio caches to force fresh fetch
      invalidateByPattern('PORTFOLIO:.*')
      invalidateByPattern('HOLDINGS:.*')
      
    } catch (error) {
      console.error('Portfolio refresh failed:', error)
    }
  }

  // Log mutation for debugging
  logMutation(type, data) {
    const metrics = getCacheMetrics()
    console.log(`Mutation [${type}]:`, {
      data,
      cacheMetrics: {
        hitRate: metrics.hitRate.toFixed(2) + '%',
        cacheSize: metrics.cacheSize,
        invalidations: metrics.invalidations
      }
    })
  }

  // Get mutation statistics
  getMutationStats() {
    return {
      queueLength: this.mutationQueue.length,
      isProcessing: this.isProcessing,
      cacheMetrics: getCacheMetrics()
    }
  }

  // Clear mutation queue
  clearMutationQueue() {
    this.mutationQueue = []
    this.isProcessing = false
  }
}

// Singleton instance
const mutationService = new MutationService()

// Export convenience methods for direct usage
export const afterTradeExecution = (tradeData) => mutationService.afterTradeExecution(tradeData)
export const afterOrderCancel = (orderData) => mutationService.afterOrderCancel(orderData)
export const afterRebalance = (rebalanceData) => mutationService.afterRebalance(rebalanceData)
export const afterMarketDataUpdate = (symbol, quoteData) => mutationService.afterMarketDataUpdate(symbol, quoteData)

export default mutationService
