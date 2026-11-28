// Drawdown Stress Score Service
// Measures how stressed the account trajectory is

import { portfolioRiskHistory, portfolioRiskSnapshot } from '../accountSnapshot.js'
import prisma from '../../db/prisma.js'
import { calculateFifoAccounting } from '../../../../server/src/services/botAccountingService.js'
import { loadPortfolioFills } from '../../../../server/src/services/portfolioValuationService.js'
import { getNetExternalCashFlowsSince } from '../../../../server/src/services/portfolioAccountingService.js'
import { drawdownStress, scoreDrawdown, scoreDailyLoss, scoreLosingStreak, scoreVolatility, stressInputs } from '../riskCore.js'

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

  /**
   * Stress inputs for a portfolio: the peak equity (EquityPeak, kept up to date here from the
   * valuation history and current equity) and FIFO realized P&L of its closed trades.
   * Throws when the portfolio can't be valued — the stress score then fails closed.
   */
  async loadInputs(portfolioId, { now = Date.now() } = {}) {
    const snap = await portfolioRiskSnapshot(portfolioId)
    const history = await portfolioRiskHistory(snap)
    const row = await prisma.equityPeak.findUnique({ where: { portfolioId } })
    const rawRecorded = Number(row?.peakEquity) || 0
    // Adjust recorded peak by external deposits/withdrawals since peakDate so ACH withdrawals
    // never produce phantom drawdowns and deposits never mask real trading drawdowns.
    const netCashFlowSincePeak = row?.peakDate
      ? await getNetExternalCashFlowsSince(portfolioId, row.peakDate, { prismaClient: prisma })
      : 0
    const adjustedRecorded = Math.max(0, rawRecorded + netCashFlowSincePeak)
    const peak = Math.max(adjustedRecorded, history.peak ?? 0, snap.equity)
    if (Math.abs(peak - rawRecorded) > 0.005) {
      await prisma.equityPeak.upsert({
        where: { portfolioId },
        create: { portfolioId, peakEquity: peak.toFixed(2), peakDate: new Date(now) },
        update: { peakEquity: peak.toFixed(2), peakDate: new Date(now) },
      })
    }
    const fills = await loadPortfolioFills(snap.userId)
    const { perExecutionPnl } = calculateFifoAccounting(fills)
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    return stressInputs({ fills, perExecutionPnl, peakEquity: peak, equity: snap.equity, now, dayStart: dayStart.getTime() })
  }

  // Calculate drawdown stress score (0-100)
  async calculateDrawdownStress(portfolioId) {
    try {
      const inputs = await this.loadInputs(portfolioId)
      const r = drawdownStress(inputs)
      return {
        score: r.score,
        label: this.getLabel(r.avg),
        breakdown: r.breakdown,
        recommendation: this.getRecommendation(r.avg),
        details: {
          peakEquity: inputs.peakEquity,
          currentEquity: inputs.equity,
          drawdown: inputs.peakEquity > 0 ? (inputs.peakEquity - inputs.equity) / inputs.peakEquity : 0,
          realizedToday: inputs.todaysPnls.reduce((s, p) => s + p, 0),
          closedTradesConsidered: inputs.recentPnls.length,
        },
      }
    } catch (error) {
      console.error('Failed to calculate drawdown stress:', error)
      return { score: 0, label: 'weak', breakdown: {}, recommendation: 'pause_all', error: error.message }
    }
  }

  // Individual sub-scores (same inputs as calculateDrawdownStress).
  async scoreDrawdown(portfolioId) { return this.subScore(portfolioId, (i) => scoreDrawdown(i.peakEquity, i.equity)) }
  async scoreDailyLoss(portfolioId) { return this.subScore(portfolioId, (i) => scoreDailyLoss(i.todaysPnls, i.equity)) }
  async scoreLosingStreak(portfolioId) { return this.subScore(portfolioId, (i) => scoreLosingStreak(i.recentPnls)) }
  async scoreVolatility(portfolioId) { return this.subScore(portfolioId, (i) => scoreVolatility(i.weekPnls)) }
  async subScore(portfolioId, fn) {
    try { return fn(await this.loadInputs(portfolioId)) } catch (error) {
      console.error('Failed to score stress:', error)
      return 50
    }
  }

  async getStressDetails(portfolioId) {
    return (await this.calculateDrawdownStress(portfolioId)).details ?? null
  }

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
