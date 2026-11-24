// Execution Confidence Score Service
// Measures how trustworthy a specific trade signal is

import prisma from '../../db/prisma.js'
import { simulationConfig } from '../../../../server/src/services/simulationService.js'
import { calculateFifoAccounting, loadBotFills } from '../../../../server/src/services/botAccountingService.js'
import { EXECUTION_WEIGHTS, executionConfidence, scoreSignalConfidence, scoreLiquidity, scoreSpreadQuality, scoreRegimeFit, scoreWinRate, closedTradeWinRate } from '../riskCore.js'

export class ExecutionConfidenceService {
  constructor() {
    this.weights = EXECUTION_WEIGHTS // riskCore: one policy for live and historical runs
  }

  // Calculate execution confidence score for a trade signal (0-100).
  // In the internal simulator, inputs with no real data are "not applicable" and the score is
  // the weighted average of the known inputs (thresholds unchanged). With no known input the
  // score stays neutral (50), so the order is still restricted. Elsewhere unknown inputs keep
  // their neutral 50, as before.
  async calculateExecutionConfidence(signal, portfolioId, marketData = {}, { unknownAsNotApplicable = simulationConfig().enabled } = {}) {
    try {
      const winRate = await this.scoreBotWinRate(signal?.botId, portfolioId, { nullWhenUnknown: unknownAsNotApplicable })
      const r = executionConfidence({ signal, marketData, winRateScore: winRate, unknownAsNotApplicable })
      return {
        score: r.score,
        label: this.getLabel(r.weightedScore),
        breakdown: r.breakdown,
        basis: r.basis,
        notApplicable: r.notApplicable,
        recommendation: this.getRecommendation(r.weightedScore)
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

  scoreSignalConfidence(signal) { return scoreSignalConfidence(signal) }
  scoreLiquidity(marketData) { return scoreLiquidity(marketData) }
  scoreSpreadQuality(marketData) { return scoreSpreadQuality(marketData) }
  async scoreRegimeFit(signal) { return scoreRegimeFit(signal) }

  // Score bot win rate (0-100)
  // Win rate over the bot's CLOSED trades in the last 30 days: sells, with realized P&L from
  // the authoritative FIFO accounting (Execution.pnl is not maintained). Open buys are not
  // wins or losses, so a bot with no closed trade has an unknown win rate.
  async scoreBotWinRate(botId, portfolioId, { nullWhenUnknown = false, loadFills = loadBotFills, now = Date.now() } = {}) {
    const unknown = nullWhenUnknown ? null : 50
    try {
      if (!botId) return unknown
      const fills = await loadFills(botId)
      const { perExecutionPnl } = calculateFifoAccounting(fills)
      return scoreWinRate(closedTradeWinRate(fills, perExecutionPnl, now)) ?? unknown
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
}

export const executionConfidenceService = new ExecutionConfidenceService()
