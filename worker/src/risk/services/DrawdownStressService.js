// Drawdown Stress Score Service
// Measures how stressed the account trajectory is

import prisma from '../../db/prisma.js'

export class DrawdownStressService {
  constructor() {
    this.thresholds = {
      drawdownWarning: 0.05, // 5%
      drawdownCritical: 0.10, // 10%
      dailyLossWarning: 0.01, // 1%
      dailyLossCritical: 0.02, // 2%
      losingStreakLimit: 5,
      volatilitySpike: 2.0 // 2x normal volatility
    }
  }

  // Calculate drawdown stress score (0-100)
  async calculateDrawdownStress(portfolioId) {
    try {
      const scores = {
        drawdown: await this.scoreDrawdown(portfolioId),
        dailyLoss: await this.scoreDailyLoss(portfolioId),
        losingStreak: await this.scoreLosingStreak(portfolioId),
        volatility: await this.scoreVolatility(portfolioId)
      }

      // Average of all scores (simple V1)
      const avgScore = (scores.drawdown + scores.dailyLoss + scores.losingStreak + scores.volatility) / 4

      return {
        score: Math.round(avgScore),
        label: this.getLabel(avgScore),
        breakdown: scores,
        recommendation: this.getRecommendation(avgScore),
        details: await this.getStressDetails(portfolioId)
      }

    } catch (error) {
      console.error('Failed to calculate drawdown stress:', error)
      return {
        score: 0,
        label: 'weak',
        breakdown: {},
        recommendation: 'pause_all',
        error: error.message
      }
    }
  }

  // Score current drawdown (0-100)
  async scoreDrawdown(portfolioId) {
    try {
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        select: {
          currentEquity: true,
          peakEquity: true
        }
      })

      if (!portfolio || !portfolio.peakEquity || portfolio.peakEquity === 0) return 100

      const drawdown = (portfolio.peakEquity - portfolio.currentEquity) / portfolio.peakEquity

      // Score based on drawdown percentage
      if (drawdown <= 0.02) return 100
      if (drawdown <= this.thresholds.drawdownWarning) return 85
      if (drawdown <= 0.075) return 65
      if (drawdown <= this.thresholds.drawdownCritical) return 40
      if (drawdown <= 0.15) return 20
      return 5

    } catch (error) {
      console.error('Failed to score drawdown:', error)
      return 50
    }
  }

  // Score daily loss (0-100)
  async scoreDailyLoss(portfolioId) {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const trades = await prisma.trade.findMany({
        where: {
          portfolioId,
          createdAt: { gte: today },
          status: 'filled'
        },
        select: {
          pnl: true
        }
      })

      const dailyLoss = trades.reduce((sum, t) => sum + Math.min(0, t.pnl), 0)
      
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        select: { currentEquity: true }
      })

      if (!portfolio || portfolio.currentEquity === 0) return 100

      const dailyLossPct = Math.abs(dailyLoss) / portfolio.currentEquity

      // Score based on daily loss percentage
      if (dailyLossPct <= 0.005) return 100
      if (dailyLossPct <= this.thresholds.dailyLossWarning) return 85
      if (dailyLossPct <= 0.015) return 65
      if (dailyLossPct <= this.thresholds.dailyLossCritical) return 40
      if (dailyLossPct <= 0.03) return 20
      return 5

    } catch (error) {
      console.error('Failed to score daily loss:', error)
      return 50
    }
  }

  // Score losing streak (0-100)
  async scoreLosingStreak(portfolioId) {
    try {
      const trades = await prisma.trade.findMany({
        where: {
          portfolioId,
          status: 'filled'
        },
        select: {
          pnl: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      })

      if (trades.length === 0) return 100

      // Count consecutive losses
      let streak = 0
      for (const trade of trades) {
        if (trade.pnl < 0) {
          streak++
        } else {
          break
        }
      }

      // Score based on losing streak
      if (streak === 0) return 100
      if (streak <= 2) return 90
      if (streak <= this.thresholds.losingStreakLimit) return 60
      if (streak <= 7) return 35
      if (streak <= 10) return 15
      return 5

    } catch (error) {
      console.error('Failed to score losing streak:', error)
      return 50
    }
  }

  // Score volatility (0-100)
  async scoreVolatility(portfolioId) {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

      const trades = await prisma.trade.findMany({
        where: {
          portfolioId,
          createdAt: { gte: sevenDaysAgo },
          status: 'filled'
        },
        select: {
          pnl: true
        }
      })

      if (trades.length < 5) return 100

      // Calculate standard deviation of returns
      const returns = trades.map(t => t.pnl)
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length
      const stdDev = Math.sqrt(variance)

      // Normalize by average trade size
      const avgTradeSize = returns.reduce((sum, r) => sum + Math.abs(r), 0) / returns.length
      const normalizedVolatility = avgTradeSize > 0 ? stdDev / avgTradeSize : 0

      // Score based on normalized volatility
      if (normalizedVolatility <= 0.5) return 100
      if (normalizedVolatility <= 1.0) return 85
      if (normalizedVolatility <= this.thresholds.volatilitySpike) return 70
      if (normalizedVolatility <= 3.0) return 45
      if (normalizedVolatility <= 5.0) return 25
      return 10

    } catch (error) {
      console.error('Failed to score volatility:', error)
      return 50
    }
  }

  // Get detailed stress information
  async getStressDetails(portfolioId) {
    try {
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        select: {
          currentEquity: true,
          peakEquity: true
        }
      })

      const drawdown = portfolio && portfolio.peakEquity > 0
        ? (portfolio.peakEquity - portfolio.currentEquity) / portfolio.peakEquity
        : 0

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const trades = await prisma.trade.findMany({
        where: {
          portfolioId,
          createdAt: { gte: today },
          status: 'filled'
        },
        select: { pnl: true }
      })

      const dailyLoss = trades.reduce((sum, t) => sum + Math.min(0, t.pnl), 0)
      const dailyLossPct = portfolio && portfolio.currentEquity > 0
        ? Math.abs(dailyLoss) / portfolio.currentEquity
        : 0

      const recentTrades = await prisma.trade.findMany({
        where: {
          portfolioId,
          status: 'filled'
        },
        select: { pnl: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20
      })

      let losingStreak = 0
      for (const trade of recentTrades) {
        if (trade.pnl < 0) {
          losingStreak++
        } else {
          break
        }
      }

      return {
        currentEquity: portfolio?.currentEquity || 0,
        peakEquity: portfolio?.peakEquity || 0,
        drawdown: Math.round(drawdown * 100),
        dailyLoss: Math.round(dailyLossPct * 100),
        losingStreak,
        tradesToday: trades.length
      }

    } catch (error) {
      console.error('Failed to get stress details:', error)
      return null
    }
  }

  // Get label for score
  getLabel(score) {
    if (score >= 75) return 'good'
    if (score >= 50) return 'moderate'
    return 'weak'
  }

  // Get recommendation based on score
  getRecommendation(score) {
    if (score >= 75) return 'normal_trading'
    if (score >= 60) return 'tighten_limits'
    if (score >= 40) return 'throttle_bots'
    if (score >= 25) return 'half_size_max'
    return 'recovery_mode'
  }

  // Check if portfolio is in recovery mode
  async isInRecoveryMode(portfolioId) {
    try {
      const stress = await this.calculateDrawdownStress(portfolioId)
      return stress.score < 40
    } catch (error) {
      console.error('Failed to check recovery mode:', error)
      return false
    }
  }

  // Update thresholds
  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds }
  }
}

export const drawdownStressService = new DrawdownStressService()
