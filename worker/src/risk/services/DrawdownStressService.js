// Drawdown Stress Score Service
// Measures how stressed the account trajectory is

import { brokerAccountSnapshot } from '../accountSnapshot.js'
import prisma from '../../db/prisma.js'
import { scoreDrawdown, scoreDailyLoss, scoreLosingStreak, scoreVolatility } from '../riskCore.js'

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
      // Peak from EquityPeak; current equity from the owner's account (simulated in simulator mode).
      const peakRow = await prisma.equityPeak.findUnique({ where: { portfolioId } })
      const peak = Number(peakRow?.peakEquity)
      if (!peakRow || !(peak > 0)) return 100
      const { equity } = await brokerAccountSnapshot(portfolioId)
      return scoreDrawdown(peak, equity)
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
      const trades = await prisma.execution.findMany({ where: { portfolioId, createdAt: { gte: today }, status: 'filled' }, select: { pnl: true } })
      const pnls = trades.map((t) => t.pnl)
      // Equity is only read when there is a loss (as before: a zero loss never needs it).
      if (pnls.reduce((sum, p) => sum + Math.min(0, p), 0) === 0) return 100
      const { equity } = await brokerAccountSnapshot(portfolioId)
      return scoreDailyLoss(pnls, equity)
    } catch (error) {
      console.error('Failed to score daily loss:', error)
      return 50
    }
  }


  // Score losing streak (0-100)
  async scoreLosingStreak(portfolioId) {
    try {
      const trades = await prisma.execution.findMany({ where: { portfolioId, status: 'filled' }, select: { pnl: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 })
      return scoreLosingStreak(trades.map((t) => t.pnl))
    } catch (error) {
      console.error('Failed to score losing streak:', error)
      return 50
    }
  }


  // Score volatility (0-100)
  async scoreVolatility(portfolioId) {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const trades = await prisma.execution.findMany({ where: { portfolioId, createdAt: { gte: sevenDaysAgo }, status: 'filled' }, select: { pnl: true } })
      return scoreVolatility(trades.map((t) => t.pnl))
    } catch (error) {
      console.error('Failed to score volatility:', error)
      return 50
    }
  }


  // Get detailed stress information
  async getStressDetails(portfolioId) {
    try {
      const peakRow = await prisma.equityPeak.findUnique({ where: { portfolioId } })
      const { equity: currentEquity } = await brokerAccountSnapshot(portfolioId)
      const peakEquity = Number(peakRow?.peakEquity) || 0
      const drawdown = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const trades = await prisma.execution.findMany({
        where: {
          portfolioId,
          createdAt: { gte: today },
          status: 'filled'
        },
        select: { pnl: true }
      })

      const dailyLoss = trades.reduce((sum, t) => sum + Math.min(0, t.pnl), 0)
      const dailyLossPct = currentEquity > 0 ? Math.abs(dailyLoss) / currentEquity : 0

      const recentTrades = await prisma.execution.findMany({
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
        currentEquity,
        peakEquity,
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
