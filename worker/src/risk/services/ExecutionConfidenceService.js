// Execution Confidence Score Service
// Measures how trustworthy a specific trade signal is

import prisma from '../../db/prisma.js'
import { simulationConfig } from '../../../../server/src/services/simulationService.js'
import { calculateFifoAccounting, loadBotFills } from '../../../../server/src/services/botAccountingService.js'

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

  // Calculate execution confidence score for a trade signal (0-100).
  // In the internal simulator, inputs with no real data are "not applicable" and the score is
  // the weighted average of the known inputs (thresholds unchanged). With no known input the
  // score stays neutral (50), so the order is still restricted. Elsewhere unknown inputs keep
  // their neutral 50, as before.
  async calculateExecutionConfidence(signal, portfolioId, marketData = {}, { unknownAsNotApplicable = simulationConfig().enabled } = {}) {
    try {
      const winRate = await this.scoreBotWinRate(signal?.botId, portfolioId, { nullWhenUnknown: unknownAsNotApplicable })
      const scores = {
        signalConfidence: this.scoreSignalConfidence(signal),
        liquidity: this.scoreLiquidity(marketData),
        spreadQuality: this.scoreSpreadQuality(marketData),
        regimeFit: await this.scoreRegimeFit(signal, marketData),
        botWinRate: winRate ?? 50
      }
      const known = {
        signalConfidence: signal?.confidence !== undefined && signal?.confidence !== null,
        liquidity: Boolean(marketData?.volume),
        spreadQuality: Boolean(marketData?.spread),
        regimeFit: Boolean(signal?.regime),
        botWinRate: winRate !== null
      }

      let weightedScore
      let notApplicable = []
      if (unknownAsNotApplicable) {
        const keys = Object.keys(this.weights).filter((k) => known[k])
        notApplicable = Object.keys(this.weights).filter((k) => !known[k])
        const totalWeight = keys.reduce((sum, k) => sum + this.weights[k], 0)
        weightedScore = totalWeight > 0 ? keys.reduce((sum, k) => sum + scores[k] * this.weights[k], 0) / totalWeight : 50
        for (const k of notApplicable) scores[k] = null
      } else {
        weightedScore =
          (scores.signalConfidence * this.weights.signalConfidence) +
          (scores.liquidity * this.weights.liquidity) +
          (scores.spreadQuality * this.weights.spreadQuality) +
          (scores.regimeFit * this.weights.regimeFit) +
          (scores.botWinRate * this.weights.botWinRate)
      }

      return {
        score: Math.round(weightedScore),
        label: this.getLabel(weightedScore),
        breakdown: scores,
        basis: unknownAsNotApplicable ? 'known_inputs' : 'all_inputs',
        notApplicable,
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
  // Win rate over the bot's CLOSED trades in the last 30 days: sells, with realized P&L from
  // the authoritative FIFO accounting (Execution.pnl is not maintained). Open buys are not
  // wins or losses, so a bot with no closed trade has an unknown win rate.
  async scoreBotWinRate(botId, portfolioId, { nullWhenUnknown = false, loadFills = loadBotFills } = {}) {
    const unknown = nullWhenUnknown ? null : 50
    try {
      if (!botId) return unknown
      const fills = await loadFills(botId)
      const { perExecutionPnl } = calculateFifoAccounting(fills)
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000
      const closed = fills.filter((f) => String(f.direction).toLowerCase() === 'sell' &&
        new Date(f.filledAt ?? f.createdAt).getTime() >= since && perExecutionPnl.has(f.id))
      if (closed.length === 0) return unknown

      const winRate = closed.filter((f) => perExecutionPnl.get(f.id) > 0).length / closed.length
      if (winRate >= 0.6) return 90
      if (winRate >= 0.55) return 75
      if (winRate >= 0.5) return 60
      if (winRate >= 0.45) return 45
      return 30
    } catch (error) {
      console.error('Failed to score bot win rate:', error)
      return unknown
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
      
      const trades = await prisma.execution.findMany({
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
