// Execution Confidence Score Service
// Measures how trustworthy a specific trade signal is

import prisma from '../../db/prisma.js'

export class ExecutionConfidenceService {
  constructor() {
    this.weights = {
      signalConfidence: 0.35,
      liquidity: 0.25,
      spreadQuality: 0.20,
      regimeFit: 0.15,
      botWinRate: 0.05
    }
  }

  // Calculate execution confidence score for a trade signal (0-100)
  async calculateExecutionConfidence(signal, portfolioId, marketData = {}) {
    try {
      const scores = {
        signalConfidence: this.scoreSignalConfidence(signal),
        liquidity: this.scoreLiquidity(marketData),
        spreadQuality: this.scoreSpreadQuality(marketData),
        regimeFit: await this.scoreRegimeFit(signal, marketData),
        botWinRate: await this.scoreBotWinRate(signal.botId, portfolioId)
      }

      // Weighted blend
      const weightedScore = 
        (scores.signalConfidence * this.weights.signalConfidence) +
        (scores.liquidity * this.weights.liquidity) +
        (scores.spreadQuality * this.weights.spreadQuality) +
        (scores.regimeFit * this.weights.regimeFit) +
        (scores.botWinRate * this.weights.botWinRate)

      return {
        score: Math.round(weightedScore),
        label: this.getLabel(weightedScore),
        breakdown: scores,
        recommendation: this.getRecommendation(weightedScore)
      }

    } catch (error) {
      console.error('Failed to calculate execution confidence:', error)
      return {
        score: 0,
        label: 'weak',
        breakdown: {},
        recommendation: 'reject',
        error: error.message
      }
    }
  }

  // Score signal confidence (0-100)
  scoreSignalConfidence(signal) {
    if (!signal || signal.confidence === undefined) return 50

    const confidence = signal.confidence

    // Map 0-1 confidence to 0-100 score
    if (confidence >= 0.8) return 95
    if (confidence >= 0.7) return 80
    if (confidence >= 0.6) return 65
    if (confidence >= 0.5) return 50
    if (confidence >= 0.4) return 35
    return 20
  }

  // Score liquidity (0-100)
  scoreLiquidity(marketData) {
    if (!marketData || !marketData.volume) return 50

    const volume = marketData.volume
    const avgVolume = marketData.avgVolume || volume

    // Score based on volume relative to average
    const volumeRatio = volume / avgVolume

    if (volumeRatio >= 2.0) return 95
    if (volumeRatio >= 1.5) return 85
    if (volumeRatio >= 1.0) return 75
    if (volumeRatio >= 0.5) return 60
    if (volumeRatio >= 0.25) return 40
    return 20
  }

  // Score spread quality (0-100)
  scoreSpreadQuality(marketData) {
    if (!marketData || !marketData.spread) return 50

    const spread = marketData.spread
    const price = marketData.price || 100

    // Calculate spread as percentage
    const spreadPct = (spread / price) * 100

    // Lower spread is better
    if (spreadPct <= 0.01) return 95
    if (spreadPct <= 0.05) return 85
    if (spreadPct <= 0.1) return 70
    if (spreadPct <= 0.25) return 50
    if (spreadPct <= 0.5) return 30
    return 15
  }

  // Score regime fit (0-100)
  async scoreRegimeFit(signal, marketData) {
    if (!signal || !signal.regime) return 50

    const regime = signal.regime

    // Simple V1: score based on regime type
    const regimeScores = {
      'bull': 85,
      'bear': 75,
      'sideways': 60,
      'volatile': 45,
      'crash': 20
    }

    return regimeScores[regime] || 50
  }

  // Score bot win rate (0-100)
  async scoreBotWinRate(botId, portfolioId) {
    try {
      if (!botId) return 50

      // Get recent bot performance
      const recentTrades = await prisma.trade.findMany({
        where: {
          botId,
          portfolioId,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
          status: 'filled'
        },
        select: {
          pnl: true
        },
        take: 50
      })

      if (recentTrades.length === 0) return 50

      // Calculate win rate
      const winningTrades = recentTrades.filter(t => t.pnl > 0).length
      const winRate = winningTrades / recentTrades.length

      // Map win rate to score
      if (winRate >= 0.6) return 90
      if (winRate >= 0.55) return 75
      if (winRate >= 0.5) return 60
      if (winRate >= 0.45) return 45
      return 30

    } catch (error) {
      console.error('Failed to score bot win rate:', error)
      return 50
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
    if (score >= 75) return 'approve'
    if (score >= 60) return 'approve_reduced'
    if (score >= 50) return 'caution'
    return 'reject'
  }

  // Batch calculate execution confidence for multiple signals
  async batchCalculateExecutionConfidence(signals, portfolioId, marketDataMap) {
    const results = []
    
    for (const signal of signals) {
      const marketData = marketDataMap[signal.ticker] || {}
      const result = await this.calculateExecutionConfidence(signal, portfolioId, marketData)
      results.push({
        signalId: signal.id,
        ticker: signal.ticker,
        ...result
      })
    }
    
    return results
  }

  // Get execution confidence statistics for portfolio
  async getExecutionConfidenceStats(portfolioId, days = 7) {
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      
      const trades = await prisma.trade.findMany({
        where: {
          portfolioId,
          createdAt: { gte: cutoff },
          status: 'filled'
        },
        select: {
          signalConfidence: true,
          pnl: true
        }
      })

      if (trades.length === 0) {
        return {
          portfolioId,
          period: `${days} days`,
          totalTrades: 0,
          avgConfidence: 0,
          winRate: 0
        }
      }

      const avgConfidence = trades.reduce((sum, t) => sum + (t.signalConfidence || 0.5), 0) / trades.length
      const winningTrades = trades.filter(t => t.pnl > 0).length
      const winRate = winningTrades / trades.length

      return {
        portfolioId,
        period: `${days} days`,
        totalTrades: trades.length,
        avgConfidence: Math.round(avgConfidence * 100),
        winRate: Math.round(winRate * 100)
      }

    } catch (error) {
      console.error('Failed to get execution confidence stats:', error)
      return {
        portfolioId,
        error: error.message
      }
    }
  }

  // Update weights
  updateWeights(newWeights) {
    this.weights = { ...this.weights, ...newWeights }
  }
}

export const executionConfidenceService = new ExecutionConfidenceService()
