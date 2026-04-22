// Portfolio Risk Service
// Handles portfolio state calculation and risk monitoring

import prisma from '../../db/prisma.js'
import { redisRiskCache } from '../redisCache.js'

export class PortfolioRiskService {
  constructor() {
    this.stateCache = new Map()
    this.cacheTtl = 30 * 1000 // 30 seconds cache
  }

  // Get comprehensive portfolio state
  async getPortfolioState(portfolioId) {
    try {
      const cacheKey = `portfolio:${portfolioId}`
      const cached = this.stateCache.get(cacheKey)
      
      if (cached && (Date.now() - cached.timestamp < this.cacheTtl)) {
        return cached.state
      }

      // Get portfolio data
      const [portfolio, filledPositions, brokerAccount] = await Promise.all([
        prisma.portfolio.findUnique({ where: { id: portfolioId } }),
        this.getFilledPositions(portfolioId),
        this.getBrokerAccountData(portfolioId)
      ])

      // Calculate portfolio metrics
      const state = this.calculatePortfolioState(
        portfolioId,
        portfolio,
        filledPositions,
        brokerAccount
      )

      // Cache the state
      this.stateCache.set(cacheKey, {
        state,
        timestamp: Date.now()
      })

      // Also cache in Redis for other services
      await redisRiskCache.set(portfolioId, state, 30)

      return state
    } catch (error) {
      console.error('Failed to get portfolio state:', error)
      throw error
    }
  }

  // Calculate portfolio state from raw data
  calculatePortfolioState(portfolioId, portfolio, filledPositions, brokerAccount) {
    // Group filled positions by ticker using signed holdings ledger
    const holdingsByTicker = new Map()
    filledPositions.forEach(pos => {
      const existing = holdingsByTicker.get(pos.ticker) || { quantity: 0, totalValue: 0, totalCost: 0 }
      
      // Apply sign based on direction (buy = +, sell = -)
      const signedQuantity = pos.direction === 'buy' ? pos.quantity : -pos.quantity
      const signedValue = pos.direction === 'buy' ? (pos.quantity * pos.filledPrice) : -(pos.quantity * pos.filledPrice)
      
      holdingsByTicker.set(pos.ticker, {
        quantity: existing.quantity + signedQuantity,
        totalValue: existing.totalValue + signedValue,
        totalCost: existing.totalCost + Math.abs(signedValue),
        avgPrice: existing.totalCost > 0 ? (existing.totalCost + Math.abs(signedValue)) / (Math.abs(existing.quantity) + pos.quantity) : pos.filledPrice,
        pnl: (existing.pnl || 0) + (pos.pnl || 0)
      })
    })

    // Calculate total exposure
    const totalExposure = Array.from(holdingsByTicker.values())
      .reduce((sum, holding) => sum + Math.abs(holding.totalValue), 0)

    // Calculate daily loss
    const today = new Date().setHours(0, 0, 0, 0)
    const dailyLoss = filledPositions
      .filter(pos => pos.filledAt >= today)
      .reduce((sum, pos) => {
        const pnl = pos.pnl || 0
        return pnl < 0 ? sum + Math.abs(pnl) : sum
      }, 0)

    // Get current equity and drawdown
    const currentEquity = brokerAccount?.equity || portfolio?.totalValue || 0
    const equityPeak = portfolio?.equityPeak || currentEquity
    const drawdown = equityPeak > 0 ? (equityPeak - currentEquity) / equityPeak : 0

    // Create positions array (filter out zero-quantity holdings)
    const positions = Array.from(holdingsByTicker.entries())
      .filter(([ticker, holding]) => Math.abs(holding.quantity) > 0.001)
      .map(([ticker, holding]) => ({
        ticker,
        quantity: holding.quantity,
        value: Math.abs(holding.totalValue),
        avgPrice: holding.avgPrice,
        pnl: holding.pnl
      }))

    return {
      portfolioId,
      cashBalance: brokerAccount?.cash || portfolio?.cashBalance || 0,
      totalValue: currentEquity,
      totalExposure,
      openPositions: holdingsByTicker.size,
      dailyLoss,
      drawdown,
      equityPeak,
      currentEquity,
      positions,
      updatedAt: new Date()
    }
  }

  // Get filled positions for portfolio
  async getFilledPositions(portfolioId) {
    try {
      return await prisma.execution.findMany({
        where: {
          portfolioId,
          status: 'filled'
        },
        orderBy: { filledAt: 'desc' },
        take: 200 // Last 200 filled executions
      })
    } catch (error) {
      console.error('Failed to get filled positions:', error)
      return []
    }
  }

  // Get broker account data
  async getBrokerAccountData(portfolioId) {
    try {
      // This would integrate with broker API
      // For now, return placeholder data
      return {
        cash: 10000,
        equity: 12000,
        buyingPower: 20000
      }
    } catch (error) {
      console.error('Failed to get broker account data:', error)
      return null
    }
  }

  // Get portfolio risk metrics
  async getPortfolioRiskMetrics(portfolioId) {
    try {
      const portfolioState = await this.getPortfolioState(portfolioId)
      
      // Calculate risk metrics
      const metrics = {
        // Concentration metrics
        sectorConcentration: this.calculateSectorConcentration(portfolioState.positions),
        tickerConcentration: this.calculateTickerConcentration(portfolioState.positions),
        
        // Leverage metrics
        leverageRatio: portfolioState.totalExposure / portfolioState.totalValue,
        
        // Drawdown metrics
        currentDrawdown: portfolioState.drawdown,
        maxDrawdown: await this.getMaxDrawdown(portfolioId),
        
        // Daily metrics
        dailyLoss: portfolioState.dailyLoss,
        dailyPnL: await this.getDailyPnL(portfolioId),
        
        // Position metrics
        openPositions: portfolioState.openPositions,
        largestPosition: this.getLargestPosition(portfolioState.positions),
        
        // Health metrics
        portfolioHealth: this.calculatePortfolioHealth(portfolioState),
        riskScore: this.calculatePortfolioRiskScore(portfolioState)
      }

      return {
        portfolioId,
        timestamp: new Date(),
        metrics,
        portfolioState
      }
    } catch (error) {
      console.error('Failed to get portfolio risk metrics:', error)
      throw error
    }
  }

  // Calculate sector concentration
  calculateSectorConcentration(positions) {
    const sectorMap = {
      'AAPL': 'Technology', 'MSFT': 'Technology', 'GOOGL': 'Technology', 'TSLA': 'Technology', 'NVDA': 'Technology',
      'JPM': 'Financial', 'BAC': 'Financial', 'WFC': 'Financial',
      'JNJ': 'Healthcare', 'PFE': 'Healthcare', 'UNH': 'Healthcare',
      'XOM': 'Energy', 'CVX': 'Energy',
      'AMZN': 'Consumer', 'WMT': 'Consumer', 'HD': 'Consumer'
    }

    const sectorExposure = new Map()
    let totalExposure = 0

    positions.forEach(pos => {
      const sector = sectorMap[pos.ticker] || 'Other'
      const current = sectorExposure.get(sector) || 0
      sectorExposure.set(sector, current + pos.value)
      totalExposure += pos.value
    })

    if (totalExposure === 0) return 0

    const maxSectorExposure = Math.max(...sectorExposure.values())
    return maxSectorExposure / totalExposure
  }

  // Calculate ticker concentration
  calculateTickerConcentration(positions) {
    if (positions.length === 0) return 0

    const totalExposure = positions.reduce((sum, pos) => sum + pos.value, 0)
    const maxPosition = Math.max(...positions.map(pos => pos.value))

    return maxPosition / totalExposure
  }

  // Get max drawdown from history
  async getMaxDrawdown(portfolioId) {
    try {
      // This would query historical equity data
      // For now, return current drawdown
      const portfolioState = await this.getPortfolioState(portfolioId)
      return portfolioState.drawdown
    } catch (error) {
      console.error('Failed to get max drawdown:', error)
      return 0
    }
  }

  // Get daily P&L
  async getDailyPnL(portfolioId) {
    try {
      const today = new Date().setHours(0, 0, 0, 0)
      
      const executions = await prisma.execution.findMany({
        where: {
          portfolioId,
          status: 'filled',
          filledAt: { gte: today }
        },
        select: { pnl: true }
      })

      return executions.reduce((sum, exec) => sum + (exec.pnl || 0), 0)
    } catch (error) {
      console.error('Failed to get daily P&L:', error)
      return 0
    }
  }

  // Get largest position
  getLargestPosition(positions) {
    if (positions.length === 0) return null
    
    return positions.reduce((largest, pos) => 
      pos.value > largest.value ? pos : largest, positions[0]
    )
  }

  // Calculate portfolio health score
  calculatePortfolioHealth(portfolioState) {
    let healthScore = 100

    // Drawdown impact
    if (portfolioState.drawdown > 0.1) healthScore -= 30
    else if (portfolioState.drawdown > 0.05) healthScore -= 15

    // Daily loss impact
    if (portfolioState.dailyLoss > 500) healthScore -= 20
    else if (portfolioState.dailyLoss > 200) healthScore -= 10

    // Concentration impact
    const sectorConc = this.calculateSectorConcentration(portfolioState.positions)
    if (sectorConc > 0.5) healthScore -= 15
    else if (sectorConc > 0.3) healthScore -= 8

    // Leverage impact
    const leverage = portfolioState.totalExposure / portfolioState.totalValue
    if (leverage > 2.0) healthScore -= 20
    else if (leverage > 1.5) healthScore -= 10

    return Math.max(0, healthScore)
  }

  // Calculate portfolio risk score
  calculatePortfolioRiskScore(portfolioState) {
    let riskScore = 0

    // Drawdown risk
    riskScore += portfolioState.drawdown * 100

    // Daily loss risk
    riskScore += (portfolioState.dailyLoss / 1000) * 20

    // Concentration risk
    const sectorConc = this.calculateSectorConcentration(portfolioState.positions)
    riskScore += sectorConc * 30

    // Leverage risk
    const leverage = portfolioState.totalExposure / portfolioState.totalValue
    riskScore += Math.max(0, (leverage - 1) * 25)

    // Position count risk
    if (portfolioState.openPositions > 15) riskScore += 15
    else if (portfolioState.openPositions > 10) riskScore += 8

    return Math.min(100, riskScore)
  }

  // Get portfolio history
  async getPortfolioHistory(portfolioId, days = 30) {
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      
      const snapshots = await prisma.dailySnapshot.findMany({
        where: {
          portfolioId,
          snapshotDate: { gte: cutoff }
        },
        orderBy: { snapshotDate: 'asc' }
      })

      return snapshots.map(snapshot => ({
        date: snapshot.snapshotDate,
        equity: snapshot.equity,
        cash: snapshot.cash,
        totalValue: snapshot.totalValue,
        drawdown: snapshot.drawdown,
        dailyPnL: snapshot.dailyPnL
      }))
    } catch (error) {
      console.error('Failed to get portfolio history:', error)
      return []
    }
  }

  // Update portfolio snapshot
  async updatePortfolioSnapshot(portfolioId) {
    try {
      const portfolioState = await this.getPortfolioState(portfolioId)
      
      await prisma.dailySnapshot.upsert({
        where: {
          portfolioId_snapshotDate: {
            portfolioId,
            snapshotDate: new Date().setHours(0, 0, 0, 0)
          }
        },
        update: {
          equity: portfolioState.totalValue,
          cash: portfolioState.cashBalance,
          totalValue: portfolioState.totalValue,
          drawdown: portfolioState.drawdown,
          dailyPnL: portfolioState.dailyLoss
        },
        create: {
          portfolioId,
          snapshotDate: new Date().setHours(0, 0, 0, 0),
          equity: portfolioState.totalValue,
          cash: portfolioState.cashBalance,
          totalValue: portfolioState.totalValue,
          drawdown: portfolioState.drawdown,
          dailyPnL: portfolioState.dailyLoss
        }
      })

      return { success: true }
    } catch (error) {
      console.error('Failed to update portfolio snapshot:', error)
      return { success: false, error: error.message }
    }
  }

  // Clear portfolio cache
  clearCache(portfolioId = null) {
    if (portfolioId) {
      this.stateCache.delete(`portfolio:${portfolioId}`)
    } else {
      this.stateCache.clear()
    }
  }

  // Get portfolio risk summary
  async getPortfolioRiskSummary(portfolioId) {
    try {
      const [riskMetrics, history] = await Promise.all([
        this.getPortfolioRiskMetrics(portfolioId),
        this.getPortfolioHistory(portfolioId, 7) // Last 7 days
      ])

      // Calculate trends
      const trends = this.calculateRiskTrends(history)

      return {
        portfolioId,
        timestamp: new Date(),
        currentRisk: riskMetrics.metrics,
        trends,
        recommendations: this.generatePortfolioRecommendations(riskMetrics.metrics, trends)
      }
    } catch (error) {
      console.error('Failed to get portfolio risk summary:', error)
      throw error
    }
  }

  // Calculate risk trends
  calculateRiskTrends(history) {
    if (history.length < 2) {
      return { drawdownTrend: 'stable', volatilityTrend: 'stable', performanceTrend: 'stable' }
    }

    const recent = history.slice(-3) // Last 3 days
    const older = history.slice(-7, -3) // Previous 4 days

    // Drawdown trend
    const recentDrawdown = recent.reduce((sum, d) => sum + d.drawdown, 0) / recent.length
    const olderDrawdown = older.reduce((sum, d) => sum + d.drawdown, 0) / older.length
    const drawdownTrend = recentDrawdown > olderDrawdown * 1.1 ? 'increasing' : 
                          recentDrawdown < olderDrawdown * 0.9 ? 'decreasing' : 'stable'

    // Volatility trend
    const recentVolatility = this.calculateVolatility(recent.map(d => d.dailyPnL))
    const olderVolatility = this.calculateVolatility(older.map(d => d.dailyPnL))
    const volatilityTrend = recentVolatility > olderVolatility * 1.1 ? 'increasing' :
                            recentVolatility < olderVolatility * 0.9 ? 'decreasing' : 'stable'

    // Performance trend
    const recentPnL = recent.reduce((sum, d) => sum + d.dailyPnL, 0)
    const olderPnL = older.reduce((sum, d) => sum + d.dailyPnL, 0)
    const performanceTrend = recentPnL > olderPnL * 1.1 ? 'improving' :
                             recentPnL < olderPnL * 0.9 ? 'declining' : 'stable'

    return { drawdownTrend, volatilityTrend, performanceTrend }
  }

  // Calculate volatility
  calculateVolatility(returns) {
    if (returns.length < 2) return 0

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length
    return Math.sqrt(variance)
  }

  // Generate portfolio recommendations
  generatePortfolioRecommendations(metrics, trends) {
    const recommendations = []

    // Drawdown recommendations
    if (metrics.currentDrawdown > 0.1) {
      recommendations.push({
        type: 'reduce_risk',
        priority: 'high',
        message: 'Portfolio drawdown is high. Consider reducing position sizes.',
        action: 'Review risk settings'
      })
    }

    // Concentration recommendations
    if (metrics.sectorConcentration > 0.4) {
      recommendations.push({
        type: 'diversify',
        priority: 'medium',
        message: `Sector concentration is ${(metrics.sectorConcentration * 100).toFixed(1)}%`,
        action: 'Add positions in different sectors'
      })
    }

    // Trend-based recommendations
    if (trends.drawdownTrend === 'increasing') {
      recommendations.push({
        type: 'monitor_closely',
        priority: 'medium',
        message: 'Drawdown is trending upward. Monitor closely.',
        action: 'Consider tightening risk limits'
      })
    }

    return recommendations
  }
}

export const portfolioRiskService = new PortfolioRiskService()
