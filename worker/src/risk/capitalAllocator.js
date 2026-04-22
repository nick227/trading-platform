// Cross-Bot Capital Allocator
// Optimally allocates capital across multiple bots based on risk-adjusted performance

import prisma from '../db/prisma.js'
import { riskManager } from './riskManagement.js'
import { regimeAwareRisk } from './regimeAwareRisk.js'

export class CapitalAllocator {
  constructor() {
    this.allocationCache = new Map()
    this.cacheTtl = 60 * 60 * 1000 // 1 hour cache
  }

  // Get optimal capital allocation for all bots in a portfolio
  async getOptimalAllocation(portfolioId) {
    try {
      const cacheKey = `allocation:${portfolioId}`
      const cached = this.allocationCache.get(cacheKey)
      
      if (cached && (Date.now() - cached.timestamp < this.cacheTtl)) {
        return cached.allocation
      }

      // Get portfolio and bots data
      const [portfolio, bots, portfolioState] = await Promise.all([
        prisma.portfolio.findUnique({
          where: { id: portfolioId },
          select: { totalValue: true, cashBalance: true }
        }),
        prisma.bot.findMany({
          where: { portfolioId, enabled: true },
          include: {
            executions: {
              where: { status: 'filled' },
              orderBy: { filledAt: 'desc' },
              take: 100
            }
          }
        }),
        riskManager.getPortfolioState(portfolioId)
      ])

      if (bots.length === 0) {
        return { allocation: [], totalAllocated: 0, availableCapital: portfolioState.totalValue }
      }

      // Calculate performance metrics for each bot
      const botMetrics = await this.calculateBotMetrics(bots, portfolioId)
      
      // Calculate risk-adjusted scores
      const riskAdjustedScores = await this.calculateRiskAdjustedScores(botMetrics, portfolioId)
      
      // Calculate optimal allocation
      const allocation = await this.calculateAllocation(
        riskAdjustedScores,
        portfolioState.totalValue,
        portfolioId
      )

      // Check for overlaps and conflicts
      const conflictResolution = await this.resolveAllocationConflicts(allocation, portfolioId)
      
      const result = {
        allocation: conflictResolution.finalAllocation,
        totalAllocated: conflictResolution.totalAllocated,
        availableCapital: portfolioState.totalValue - conflictResolution.totalAllocated,
        metrics: botMetrics,
        scores: riskAdjustedScores,
        conflicts: conflictResolution.conflicts,
        rebalancingRecommendations: this.generateRebalancingRecommendations(conflictResolution)
      }

      // Cache the result
      this.allocationCache.set(cacheKey, {
        ...result,
        timestamp: Date.now()
      })

      return result
    } catch (error) {
      console.error('Failed to get optimal allocation:', error)
      throw error
    }
  }

  // Calculate performance metrics for each bot
  async calculateBotMetrics(bots, portfolioId) {
    const metrics = await Promise.all(
      bots.map(async bot => {
        const executions = bot.executions || []
        const recentExecutions = executions.slice(0, 30) // Last 30 trades
        
        // Basic performance metrics
        const totalPnL = recentExecutions.reduce((sum, exec) => sum + (exec.pnl || 0), 0)
        const winningTrades = recentExecutions.filter(exec => (exec.pnl || 0) > 0).length
        const losingTrades = recentExecutions.filter(exec => (exec.pnl || 0) < 0).length
        const winRate = recentExecutions.length > 0 ? winningTrades / recentExecutions.length : 0
        
        // Risk metrics
        const losses = recentExecutions.filter(exec => (exec.pnl || 0) < 0).map(exec => exec.pnl || 0)
        const avgLoss = losses.length > 0 ? losses.reduce((sum, loss) => sum + loss, 0) / losses.length : 0
        const maxLoss = losses.length > 0 ? Math.min(...losses) : 0
        const profitFactor = this.calculateProfitFactor(recentExecutions)
        
        // Volatility and consistency
        const dailyReturns = this.calculateDailyReturns(recentExecutions)
        const volatility = this.calculateVolatility(dailyReturns)
        const sharpeRatio = this.calculateSharpeRatio(dailyReturns)
        
        // Recent performance (last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        const recentExecutions7 = recentExecutions.filter(exec => exec.filledAt >= sevenDaysAgo)
        const recentPnL7 = recentExecutions7.reduce((sum, exec) => sum + (exec.pnl || 0), 0)
        
        // Concentration analysis
        const tickerExposure = this.calculateTickerExposure(recentExecutions)
        const concentration = this.calculateConcentration(tickerExposure)
        
        return {
          botId: bot.id,
          botName: bot.name,
          botType: bot.botType,
          enabled: bot.enabled,
          totalTrades: recentExecutions.length,
          totalPnL,
          winRate,
          profitFactor,
          avgLoss,
          maxLoss,
          volatility,
          sharpeRatio,
          recentPnL7,
          tickerExposure,
          concentration,
          riskScore: await this.calculateBotRiskScore(bot, portfolioId),
          regime: await this.getBotPreferredRegime(bot, recentExecutions)
        }
      })
    )

    return metrics
  }

  // Calculate risk-adjusted scores for allocation
  async calculateRiskAdjustedScores(botMetrics, portfolioId) {
    const portfolioState = await riskManager.getPortfolioState(portfolioId)
    const regimeData = await regimeAwareRisk.getRegimeAdjustedRiskSettings(portfolioId)
    
    const scoredBots = botMetrics.map(bot => {
      let score = 100 // Start with perfect score
      
      // Performance adjustments
      if (bot.sharpeRatio < 0.5) score -= 20
      else if (bot.sharpeRatio > 1.5) score += 10
      
      if (bot.profitFactor < 1.2) score -= 15
      else if (bot.profitFactor > 2.0) score += 10
      
      if (bot.winRate < 0.4) score -= 10
      else if (bot.winRate > 0.6) score += 5
      
      // Risk adjustments
      if (bot.maxLoss < -500) score -= 15
      if (bot.volatility > 0.3) score -= 10
      if (bot.concentration > 0.6) score -= 10 // High concentration penalty
      
      // Recent performance
      if (bot.recentPnL7 < -200) score -= 20
      else if (bot.recentPnL7 > 200) score += 10
      
      // Regime alignment
      if (bot.regime && bot.regime !== regimeData.regime.regime) {
        score -= 15 // Penalty for regime mismatch
      }
      
      // Risk score penalty
      score -= bot.riskScore * 0.5 // Risk score reduces allocation score
      
      return {
        ...bot,
        allocationScore: Math.max(0, score),
        allocationWeight: 0 // Will be calculated
      }
    })

    // Calculate allocation weights (normalized scores)
    const totalScore = scoredBots.reduce((sum, bot) => sum + bot.allocationScore, 0)
    
    return scoredBots.map(bot => ({
      ...bot,
      allocationWeight: totalScore > 0 ? bot.allocationScore / totalScore : 0
    }))
  }

  // Calculate capital allocation based on scores
  async calculateAllocation(scoredBots, totalPortfolioValue, portfolioId) {
    const riskSettings = await riskManager.getRiskSettings(portfolioId)
    const maxAllocationPercent = 0.8 // Allocate max 80% of portfolio
    
    const availableForAllocation = totalPortfolioValue * maxAllocationPercent
    const allocation = []
    
    // Base allocation by weights
    scoredBots.forEach(bot => {
      const baseAllocation = availableForAllocation * bot.allocationWeight
      const maxBotAllocation = totalPortfolioValue * 0.3 // Max 30% per bot
      
      const finalAllocation = Math.min(baseAllocation, maxBotAllocation)
      
      allocation.push({
        botId: bot.botId,
        botName: bot.botName,
        botType: bot.botType,
        allocationScore: bot.allocationScore,
        allocationWeight: bot.allocationWeight,
        allocatedCapital: finalAllocation,
        allocationPercent: (finalAllocation / totalPortfolioValue) * 100,
        maxPositionSize: finalAllocation * riskSettings.maxPositionSize,
        riskLimits: {
          maxDailyLoss: finalAllocation * 0.05, // 5% of allocation
          maxDrawdown: finalAllocation * 0.15,  // 15% of allocation
          maxConcurrentTrades: Math.max(1, Math.floor(bot.allocationWeight * 5))
        }
      })
    })

    // Sort by allocation amount
    allocation.sort((a, b) => b.allocatedCapital - a.allocatedCapital)
    
    return allocation
  }

  // Resolve allocation conflicts and overlaps
  async resolveAllocationConflicts(allocation, portfolioId) {
    const conflicts = []
    const finalAllocation = [...allocation]
    
    // Check for ticker overlaps between bots
    const tickerAllocations = new Map()
    
    finalAllocation.forEach(botAlloc => {
      // Get bot's preferred tickers
      const botTickers = this.getBotPreferredTickers(botAlloc.botType)
      
      botTickers.forEach(ticker => {
        if (!tickerAllocations.has(ticker)) {
          tickerAllocations.set(ticker, [])
        }
        tickerAllocations.get(ticker).push(botAlloc)
      })
    })
    
    // Resolve ticker conflicts
    tickerAllocations.forEach((bots, ticker) => {
      if (bots.length > 1) {
        // Multiple bots want the same ticker
        const totalAllocation = bots.reduce((sum, bot) => sum + bot.allocatedCapital, 0)
        const maxTickerAllocation = 50000 // Max $50k per ticker across all bots
        
        if (totalAllocation > maxTickerAllocation) {
          conflicts.push({
            type: 'ticker_overlap',
            ticker,
            bots: bots.map(b => b.botName),
            totalAllocation,
            limit: maxTickerAllocation,
            resolution: 'reduce_allocation'
          })
          
          // Reduce allocations proportionally
          const reductionFactor = maxTickerAllocation / totalAllocation
          bots.forEach(bot => {
            bot.allocatedCapital *= reductionFactor
            bot.allocationPercent *= reductionFactor
            bot.maxPositionSize *= reductionFactor
          })
        }
      }
    })
    
    // Check sector concentration
    const sectorAllocations = this.calculateSectorAllocation(finalAllocation)
    const maxSectorAllocation = 0.4 // Max 40% per sector
    
    sectorAllocations.forEach((alloc, sector) => {
      if (alloc.percent > maxSectorAllocation * 100) {
        conflicts.push({
          type: 'sector_concentration',
          sector,
          currentPercent: alloc.percent,
          maxPercent: maxSectorAllocation * 100,
          resolution: 'reduce_exposure'
        })
      }
    })
    
    const totalAllocated = finalAllocation.reduce((sum, bot) => sum + bot.allocatedCapital, 0)
    
    return {
      finalAllocation,
      totalAllocated,
      conflicts
    }
  }

  // Helper methods
  calculateProfitFactor(executions) {
    const profits = executions.filter(exec => (exec.pnl || 0) > 0).reduce((sum, exec) => sum + (exec.pnl || 0), 0)
    const losses = Math.abs(executions.filter(exec => (exec.pnl || 0) < 0).reduce((sum, exec) => sum + (exec.pnl || 0), 0))
    return losses > 0 ? profits / losses : profits > 0 ? 999 : 0
  }

  calculateDailyReturns(executions) {
    // Group executions by day and calculate daily returns
    const dailyPnL = new Map()
    
    executions.forEach(exec => {
      const day = exec.filledAt.toISOString().split('T')[0]
      const current = dailyPnL.get(day) || 0
      dailyPnL.set(day, current + (exec.pnl || 0))
    })
    
    const dailyReturns = []
    const days = Array.from(dailyPnL.keys()).sort()
    
    for (let i = 1; i < days.length; i++) {
      const prevDay = dailyPnL.get(days[i - 1]) || 0
      const currDay = dailyPnL.get(days[i]) || 0
      
      if (prevDay !== 0) {
        dailyReturns.push(currDay / prevDay)
      }
    }
    
    return dailyReturns
  }

  calculateVolatility(returns) {
    if (returns.length < 2) return 0
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length
    return Math.sqrt(variance)
  }

  calculateSharpeRatio(returns) {
    if (returns.length < 2) return 0
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
    const volatility = this.calculateVolatility(returns)
    
    return volatility > 0 ? mean / volatility : 0
  }

  calculateTickerExposure(executions) {
    const exposure = new Map()
    
    executions.forEach(exec => {
      const current = exposure.get(exec.ticker) || 0
      exposure.set(exec.ticker, current + Math.abs(exec.pnl || 0))
    })
    
    return exposure
  }

  calculateConcentration(tickerExposure) {
    if (tickerExposure.size === 0) return 0
    
    const totalExposure = Array.from(tickerExposure.values()).reduce((sum, val) => sum + val, 0)
    const maxExposure = Math.max(...tickerExposure.values())
    
    return totalExposure > 0 ? maxExposure / totalExposure : 0
  }

  async calculateBotRiskScore(bot, portfolioId) {
    // Use risk manager to get bot-specific risk score
    try {
      const portfolioState = await riskManager.getPortfolioState(portfolioId)
      const botPositions = portfolioState.positions.filter(pos => 
        // This would need bot position tracking
        true
      )
      
      // Simplified risk score calculation
      let riskScore = 0
      
      if (botPositions.length > 5) riskScore += 20
      if (botPositions.some(pos => pos.value > 10000)) riskScore += 15
      
      return riskScore
    } catch (error) {
      console.error('Failed to calculate bot risk score:', error)
      return 50 // Default medium risk
    }
  }

  async getBotPreferredRegime(bot, executions) {
    // Analyze bot performance across different regimes
    // This would need historical regime data
    return 'neutral' // Default
  }

  getBotPreferredTickers(botType) {
    const tickerPreferences = {
      'momentum': ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA'],
      'mean_reversion': ['SPY', 'QQQ', 'VTI', 'IWM'],
      'sector_rotation': ['XLF', 'XLE', 'XLK', 'XLV'],
      'volatility': ['VIX', 'UVXY', 'SVXY'],
      'arbitrage': ['SPY', 'ES', 'NQ']
    }
    
    return tickerPreferences[botType] || ['SPY', 'QQQ']
  }

  calculateSectorAllocation(allocation) {
    const sectorMap = {
      'AAPL': 'Technology', 'MSFT': 'Technology', 'GOOGL': 'Technology', 'TSLA': 'Technology', 'NVDA': 'Technology',
      'JPM': 'Financial', 'BAC': 'Financial', 'WFC': 'Financial',
      'JNJ': 'Healthcare', 'PFE': 'Healthcare', 'UNH': 'Healthcare',
      'XOM': 'Energy', 'CVX': 'Energy',
      'AMZN': 'Consumer', 'WMT': 'Consumer', 'HD': 'Consumer'
    }
    
    const sectorAllocations = new Map()
    let totalAllocation = allocation.reduce((sum, bot) => sum + bot.allocatedCapital, 0)
    
    allocation.forEach(bot => {
      const tickers = this.getBotPreferredTickers(bot.botType)
      
      tickers.forEach(ticker => {
        const sector = sectorMap[ticker] || 'Other'
        const current = sectorAllocations.get(sector) || { capital: 0, percent: 0 }
        current.capital += bot.allocatedCapital / tickers.length
        sectorAllocations.set(sector, current)
      })
    })
    
    // Convert to percentages
    sectorAllocations.forEach((alloc, sector) => {
      alloc.percent = totalAllocation > 0 ? (alloc.capital / totalAllocation) * 100 : 0
    })
    
    return sectorAllocations
  }

  generateRebalancingRecommendations(conflictResolution) {
    const recommendations = []
    
    conflictResolution.conflicts.forEach(conflict => {
      switch (conflict.type) {
        case 'ticker_overlap':
          recommendations.push({
            type: 'reduce_overlap',
            priority: 'medium',
            message: `Consider reducing overlap in ${conflict.ticker} across ${conflict.bots.join(', ')}`,
            action: 'Review bot strategies'
          })
          break
        case 'sector_concentration':
          recommendations.push({
            type: 'diversify_sector',
            priority: 'high',
            message: `${conflict.sector} exposure is ${conflict.currentPercent.toFixed(1)}% (max: ${conflict.maxPercent.toFixed(1)}%)`,
            action: 'Add sector-diversified bots'
          })
          break
      }
    })
    
    return recommendations
  }

  // Update allocation for a specific bot
  async updateBotAllocation(portfolioId, botId, newAllocation) {
    try {
      // This would update bot configuration or risk limits
      console.log(`Updating allocation for bot ${botId} in portfolio ${portfolioId}: $${newAllocation}`)
      
      // Clear cache to force refresh
      this.allocationCache.delete(`allocation:${portfolioId}`)
      
      return true
    } catch (error) {
      console.error('Failed to update bot allocation:', error)
      return false
    }
  }

  // Get allocation history
  async getAllocationHistory(portfolioId, days = 30) {
    try {
      // This would query historical allocation data
      return []
    } catch (error) {
      console.error('Failed to get allocation history:', error)
      return []
    }
  }
}

export const capitalAllocator = new CapitalAllocator()
