// Risk-Adjusted Bot Leaderboard
// Ranks bots by risk-adjusted performance metrics

import prisma from '../db/prisma.js'
import { riskManager } from './riskManagement.js'

export class BotLeaderboard {
  constructor() {
    this.leaderboardCache = new Map()
    this.cacheTtl = 15 * 60 * 1000 // 15 minutes cache
  }

  // Get comprehensive bot leaderboard for a portfolio
  async getLeaderboard(portfolioId, timeframe = '30d') {
    try {
      const cacheKey = `leaderboard:${portfolioId}:${timeframe}`
      const cached = this.leaderboardCache.get(cacheKey)
      
      if (cached && (Date.now() - cached.timestamp < this.cacheTtl)) {
        return cached.leaderboard
      }

      // Get all bots in portfolio
      const bots = await prisma.bot.findMany({
        where: { portfolioId },
        include: {
          executions: {
            where: { status: 'filled' },
            orderBy: { filledAt: 'desc' },
            take: this.getExecutionLimit(timeframe)
          }
        }
      })

      // Calculate metrics for each bot
      const botMetrics = await Promise.all(
        bots.map(bot => this.calculateBotMetrics(bot, timeframe))
      )

      // Calculate risk-adjusted scores
      const scoredBots = botMetrics.map(bot => ({
        ...bot,
        riskAdjustedScore: this.calculateRiskAdjustedScore(bot),
        overallScore: this.calculateOverallScore(bot)
      }))

      // Sort by overall score
      const leaderboard = scoredBots.sort((a, b) => b.overallScore - a.overallScore)

      // Add rankings and percentiles
      const rankedLeaderboard = this.addRankings(leaderboard)

      // Calculate summary statistics
      const summary = this.calculateLeaderboardSummary(rankedLeaderboard)

      const result = {
        portfolioId,
        timeframe,
        timestamp: new Date(),
        leaderboard: rankedLeaderboard,
        summary,
        topPerformers: this.getTopPerformers(rankedLeaderboard),
        riskAnalysis: this.analyzeRiskProfile(rankedLeaderboard),
        recommendations: this.generateLeaderboardRecommendations(rankedLeaderboard)
      }

      // Cache the result
      this.leaderboardCache.set(cacheKey, {
        ...result,
        timestamp: Date.now()
      })

      return result
    } catch (error) {
      console.error('Failed to get bot leaderboard:', error)
      throw error
    }
  }

  // Calculate comprehensive metrics for a bot
  async calculateBotMetrics(bot, timeframe) {
    const executions = bot.executions || []
    const recentExecutions = this.getRecentExecutions(executions, timeframe)
    
    if (recentExecutions.length === 0) {
      return {
        botId: bot.id,
        botName: bot.name,
        botType: bot.botType,
        enabled: bot.enabled,
        totalTrades: 0,
        timeframe,
        // Performance metrics
        totalPnL: 0,
        winRate: 0,
        profitFactor: 0,
        avgWin: 0,
        avgLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        // Risk metrics
        maxDrawdown: 0,
        volatility: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        // Consistency metrics
        consistency: 0,
        streak: { current: 0, best: 0, worst: 0 },
        monthlyReturns: [],
        // Activity metrics
        avgTradesPerMonth: 0,
        avgHoldingPeriod: 0,
        slippage: 0,
        // Risk scores
        riskScore: 0,
        riskAdjustedScore: 0,
        overallScore: 0
      }
    }

    // Performance calculations
    const totalPnL = recentExecutions.reduce((sum, exec) => sum + (exec.pnl || 0), 0)
    const winningTrades = recentExecutions.filter(exec => (exec.pnl || 0) > 0)
    const losingTrades = recentExecutions.filter(exec => (exec.pnl || 0) < 0)
    const winRate = recentExecutions.length > 0 ? winningTrades.length / recentExecutions.length : 0
    
    const avgWin = winningTrades.length > 0 
      ? winningTrades.reduce((sum, exec) => sum + (exec.pnl || 0), 0) / winningTrades.length 
      : 0
    const avgLoss = losingTrades.length > 0 
      ? losingTrades.reduce((sum, exec) => sum + (exec.pnl || 0), 0) / losingTrades.length 
      : 0
    
    const largestWin = winningTrades.length > 0 
      ? Math.max(...winningTrades.map(exec => exec.pnl || 0)) 
      : 0
    const largestLoss = losingTrades.length > 0 
      ? Math.min(...losingTrades.map(exec => exec.pnl || 0)) 
      : 0
    
    const profitFactor = this.calculateProfitFactor(recentExecutions)
    
    // Risk calculations
    const dailyReturns = this.calculateDailyReturns(recentExecutions)
    const maxDrawdown = this.calculateMaxDrawdown(dailyReturns)
    const volatility = this.calculateVolatility(dailyReturns)
    const sharpeRatio = this.calculateSharpeRatio(dailyReturns)
    const sortinoRatio = this.calculateSortinoRatio(dailyReturns)
    const calmarRatio = this.calculateCalmarRatio(totalPnL, maxDrawdown)
    
    // Consistency metrics
    const consistency = this.calculateConsistency(dailyReturns)
    const streak = this.calculateStreak(recentExecutions)
    const monthlyReturns = this.calculateMonthlyReturns(recentExecutions, timeframe)
    
    // Activity metrics
    const avgTradesPerMonth = this.calculateAvgTradesPerMonth(recentExecutions, timeframe)
    const avgHoldingPeriod = this.calculateAvgHoldingPeriod(recentExecutions)
    const slippage = this.calculateSlippage(recentExecutions)
    
    // Risk score
    const riskScore = await this.calculateBotRiskScore(bot.id)
    
    return {
      botId: bot.id,
      botName: bot.name,
      botType: bot.botType,
      enabled: bot.enabled,
      totalTrades: recentExecutions.length,
      timeframe,
      // Performance metrics
      totalPnL,
      winRate,
      profitFactor,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      // Risk metrics
      maxDrawdown,
      volatility,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      // Consistency metrics
      consistency,
      streak,
      monthlyReturns,
      // Activity metrics
      avgTradesPerMonth,
      avgHoldingPeriod,
      slippage,
      // Risk scores
      riskScore,
      riskAdjustedScore: 0, // Will be calculated
      overallScore: 0 // Will be calculated
    }
  }

  // Calculate risk-adjusted score
  calculateRiskAdjustedScore(bot) {
    let score = 0
    
    // Sharpe ratio weighting (40%)
    score += (bot.sharpeRatio * 40)
    
    // Sortino ratio weighting (20%)
    score += (bot.sortinoRatio * 20)
    
    // Calmar ratio weighting (15%)
    score += (bot.calmarRatio * 15)
    
    // Profit factor weighting (15%)
    score += (Math.min(bot.profitFactor, 3) / 3 * 15) // Cap at 3
    
    // Consistency weighting (10%)
    score += (bot.consistency * 10)
    
    return Math.max(0, score)
  }

  // Calculate overall score including risk penalties
  calculateOverallScore(bot) {
    let score = bot.riskAdjustedScore
    
    // Risk penalty
    score -= bot.riskScore * 0.3
    
    // Activity bonus (if bot is active enough)
    if (bot.avgTradesPerMonth >= 5) {
      score += 5
    }
    
    // Recent performance bonus
    if (bot.totalPnL > 0) {
      score += Math.min(10, bot.totalPnL / 100) // Max 10 points
    }
    
    return Math.max(0, score)
  }

  // Add rankings and percentiles
  addRankings(leaderboard) {
    return leaderboard.map((bot, index) => {
      const rank = index + 1
      const percentile = ((leaderboard.length - index) / leaderboard.length) * 100
      
      return {
        ...bot,
        rank,
        percentile,
        grade: this.getGrade(percentile)
      }
    })
  }

  // Get performance grade
  getGrade(percentile) {
    if (percentile >= 90) return 'A+'
    if (percentile >= 80) return 'A'
    if (percentile >= 70) return 'B+'
    if (percentile >= 60) return 'B'
    if (percentile >= 50) return 'C+'
    if (percentile >= 40) return 'C'
    if (percentile >= 30) return 'D'
    return 'F'
  }

  // Calculate leaderboard summary
  calculateLeaderboardSummary(leaderboard) {
    if (leaderboard.length === 0) {
      return {
        totalBots: 0,
        activeBots: 0,
        avgScore: 0,
        avgPnL: 0,
        avgSharpe: 0,
        topQuartileScore: 0,
        performanceSpread: 0
      }
    }

    const activeBots = leaderboard.filter(bot => bot.enabled).length
    const scores = leaderboard.map(bot => bot.overallScore)
    const pnls = leaderboard.map(bot => bot.totalPnL)
    const sharpes = leaderboard.map(bot => bot.sharpeRatio)
    
    const topQuartileIndex = Math.floor(leaderboard.length * 0.25)
    const topQuartileScore = leaderboard.slice(0, topQuartileIndex + 1)
      .reduce((sum, bot) => sum + bot.overallScore, 0) / (topQuartileIndex + 1)
    
    return {
      totalBots: leaderboard.length,
      activeBots,
      avgScore: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      avgPnL: pnls.reduce((sum, pnl) => sum + pnl, 0) / pnls.length,
      avgSharpe: sharpes.reduce((sum, sharpe) => sum + sharpe, 0) / sharpes.length,
      topQuartileScore,
      performanceSpread: Math.max(...scores) - Math.min(...scores)
    }
  }

  // Get top performers
  getTopPerformers(leaderboard) {
    return {
      bestOverall: leaderboard[0] || null,
      bestSharpe: leaderboard.reduce((best, bot) => 
        (!best || bot.sharpeRatio > best.sharpeRatio) ? bot : best, null),
      bestProfitFactor: leaderboard.reduce((best, bot) => 
        (!best || bot.profitFactor > best.profitFactor) ? bot : best, null),
      mostConsistent: leaderboard.reduce((best, bot) => 
        (!best || bot.consistency > best.consistency) ? bot : best, null),
      mostActive: leaderboard.reduce((best, bot) => 
        (!best || bot.avgTradesPerMonth > best.avgTradesPerMonth) ? bot : best, null)
    }
  }

  // Analyze risk profile of leaderboard
  analyzeRiskProfile(leaderboard) {
    const riskScores = leaderboard.map(bot => bot.riskScore)
    const maxDrawdowns = leaderboard.map(bot => bot.maxDrawdown)
    const volatilities = leaderboard.map(bot => bot.volatility)
    
    return {
      avgRiskScore: riskScores.reduce((sum, score) => sum + score, 0) / riskScores.length,
      avgMaxDrawdown: maxDrawdowns.reduce((sum, dd) => sum + dd, 0) / maxDrawdowns.length,
      avgVolatility: volatilities.reduce((sum, vol) => sum + vol, 0) / volatilities.length,
      riskDistribution: this.getRiskDistribution(leaderboard),
      highRiskBots: leaderboard.filter(bot => bot.riskScore > 70).length,
      lowRiskBots: leaderboard.filter(bot => bot.riskScore < 30).length
    }
  }

  // Get risk distribution
  getRiskDistribution(leaderboard) {
    const distribution = { low: 0, medium: 0, high: 0, critical: 0 }
    
    leaderboard.forEach(bot => {
      if (bot.riskScore < 25) distribution.low++
      else if (bot.riskScore < 50) distribution.medium++
      else if (bot.riskScore < 75) distribution.high++
      else distribution.critical++
    })
    
    return distribution
  }

  // Generate leaderboard recommendations
  generateLeaderboardRecommendations(leaderboard) {
    const recommendations = []
    
    // Find underperforming bots
    const bottomQuartile = leaderboard.slice(Math.floor(leaderboard.length * 0.75))
    bottomQuartile.forEach(bot => {
      if (bot.enabled && bot.overallScore < 30) {
        recommendations.push({
          type: 'disable_bot',
          priority: 'medium',
          botId: bot.botId,
          botName: bot.botName,
          reason: `Poor performance (Score: ${bot.overallScore.toFixed(1)})`,
          action: 'Consider disabling or reviewing strategy'
        })
      }
    })
    
    // Find high-risk, low-reward bots
    leaderboard.forEach(bot => {
      if (bot.riskScore > 60 && bot.riskAdjustedScore < 30) {
        recommendations.push({
          type: 'reduce_risk',
          priority: 'high',
          botId: bot.botId,
          botName: bot.botName,
          reason: `High risk (${bot.riskScore}) with low risk-adjusted returns (${bot.riskAdjustedScore.toFixed(1)})`,
          action: 'Review risk parameters or position sizing'
        })
      }
    })
    
    // Find inconsistent performers
    leaderboard.forEach(bot => {
      if (bot.consistency < 0.3 && bot.totalTrades > 10) {
        recommendations.push({
          type: 'improve_consistency',
          priority: 'medium',
          botId: bot.botId,
          botName: bot.botName,
          reason: `Low consistency (${(bot.consistency * 100).toFixed(1)}%)`,
          action: 'Review strategy logic or add filters'
        })
      }
    })
    
    return recommendations
  }

  // Helper methods
  getExecutionLimit(timeframe) {
    const limits = {
      '7d': 50,
      '30d': 200,
      '90d': 500,
      '1y': 1000
    }
    return limits[timeframe] || 200
  }

  getRecentExecutions(executions, timeframe) {
    const now = new Date()
    const days = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '1y': 365
    }
    const cutoff = new Date(now.getTime() - (days[timeframe] || 30) * 24 * 60 * 60 * 1000)
    
    return executions.filter(exec => exec.filledAt >= cutoff)
  }

  calculateProfitFactor(executions) {
    const profits = executions.filter(exec => (exec.pnl || 0) > 0).reduce((sum, exec) => sum + (exec.pnl || 0), 0)
    const losses = Math.abs(executions.filter(exec => (exec.pnl || 0) < 0).reduce((sum, exec) => sum + (exec.pnl || 0), 0))
    return losses > 0 ? profits / losses : profits > 0 ? 999 : 0
  }

  calculateDailyReturns(executions) {
    const dailyPnL = new Map()
    
    executions.forEach(exec => {
      const day = exec.filledAt.toISOString().split('T')[0]
      const current = dailyPnL.get(day) || 0
      dailyPnL.set(day, current + (exec.pnl || 0))
    })
    
    const days = Array.from(dailyPnL.keys()).sort()
    const returns = []
    
    for (let i = 1; i < days.length; i++) {
      const prevDay = dailyPnL.get(days[i - 1]) || 0
      const currDay = dailyPnL.get(days[i]) || 0
      
      if (prevDay !== 0) {
        returns.push(currDay / prevDay)
      }
    }
    
    return returns
  }

  calculateMaxDrawdown(returns) {
    if (returns.length === 0) return 0
    
    let peak = 0
    let maxDrawdown = 0
    let cumulative = 0
    
    returns.forEach(ret => {
      cumulative += ret
      peak = Math.max(peak, cumulative)
      const drawdown = (peak - cumulative) / peak
      maxDrawdown = Math.max(maxDrawdown, drawdown)
    })
    
    return maxDrawdown
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

  calculateSortinoRatio(returns) {
    if (returns.length < 2) return 0
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
    const negativeReturns = returns.filter(r => r < 0)
    
    if (negativeReturns.length === 0) return mean > 0 ? 999 : 0
    
    const downsideDeviation = Math.sqrt(
      negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
    )
    
    return downsideDeviation > 0 ? mean / downsideDeviation : 0
  }

  calculateCalmarRatio(totalPnL, maxDrawdown) {
    return maxDrawdown > 0 ? totalPnL / maxDrawdown : 0
  }

  calculateConsistency(returns) {
    if (returns.length < 2) return 0
    
    const positiveReturns = returns.filter(r => r > 0).length
    return positiveReturns / returns.length
  }

  calculateStreak(executions) {
    let currentStreak = 0
    let bestStreak = 0
    let worstStreak = 0
    
    for (let i = executions.length - 1; i >= 0; i--) {
      const pnl = executions[i].pnl || 0
      if (pnl >= 0) {
        currentStreak++
      } else {
        break
      }
    }
    
    let tempStreak = 0
    executions.forEach(exec => {
      const pnl = exec.pnl || 0
      if (pnl >= 0) {
        tempStreak++
        bestStreak = Math.max(bestStreak, tempStreak)
      } else {
        tempStreak = 0
      }
    })
    
    tempStreak = 0
    executions.forEach(exec => {
      const pnl = exec.pnl || 0
      if (pnl < 0) {
        tempStreak++
        worstStreak = Math.max(worstStreak, tempStreak)
      } else {
        tempStreak = 0
      }
    })
    
    return { current: currentStreak, best: bestStreak, worst: worstStreak }
  }

  calculateMonthlyReturns(executions, timeframe) {
    const monthlyPnL = new Map()
    
    executions.forEach(exec => {
      const month = exec.filledAt.toISOString().slice(0, 7) // YYYY-MM
      const current = monthlyPnL.get(month) || 0
      monthlyPnL.set(month, current + (exec.pnl || 0))
    })
    
    return Array.from(monthlyPnL.entries()).map(([month, pnl]) => ({ month, pnl }))
  }

  calculateAvgTradesPerMonth(executions, timeframe) {
    const days = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }
    const periodDays = days[timeframe] || 30
    const months = periodDays / 30
    
    return executions.length / months
  }

  calculateAvgHoldingPeriod(executions) {
    // This would need entry/exit timestamps
    // For now, return placeholder
    return 24 // hours
  }

  calculateSlippage(executions) {
    // This would need expected vs actual fill prices
    // For now, return placeholder
    return 0.1 // 0.1%
  }

  async calculateBotRiskScore(botId) {
    try {
      // Use risk manager to get bot-specific risk score
      // This is a simplified implementation
      return Math.random() * 100 // Placeholder
    } catch (error) {
      console.error('Failed to calculate bot risk score:', error)
      return 50
    }
  }

  // Get comparison between two bots
  async compareBots(portfolioId, botId1, botId2, timeframe = '30d') {
    try {
      const leaderboard = await this.getLeaderboard(portfolioId, timeframe)
      const bot1 = leaderboard.leaderboard.find(b => b.botId === botId1)
      const bot2 = leaderboard.leaderboard.find(b => b.botId === botId2)
      
      if (!bot1 || !bot2) {
        throw new Error('One or both bots not found')
      }
      
      return {
        bot1,
        bot2,
        comparison: this.generateBotComparison(bot1, bot2),
        winner: bot1.overallScore > bot2.overallScore ? bot1 : bot2,
        timeframe
      }
    } catch (error) {
      console.error('Failed to compare bots:', error)
      throw error
    }
  }

  generateBotComparison(bot1, bot2) {
    const metrics = [
      'overallScore', 'riskAdjustedScore', 'totalPnL', 'sharpeRatio', 
      'sortinoRatio', 'profitFactor', 'winRate', 'maxDrawdown', 'consistency'
    ]
    
    const comparison = {}
    
    metrics.forEach(metric => {
      const val1 = bot1[metric] || 0
      const val2 = bot2[metric] || 0
      
      comparison[metric] = {
        bot1: val1,
        bot2: val2,
        winner: val1 > val2 ? 'bot1' : val2 > val1 ? 'bot2' : 'tie',
        difference: Math.abs(val1 - val2)
      }
    })
    
    return comparison
  }
}

export const botLeaderboard = new BotLeaderboard()
