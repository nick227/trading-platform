// Risk Gate Service
// Handles execution approval and basic risk checks

import { portfolioRiskHistory, portfolioRiskSnapshot } from '../accountSnapshot.js'
import prisma from '../../db/prisma.js'
import { riskDecisionMatrix } from './RiskDecisionMatrix.js'
import { DEFAULT_RISK_SETTINGS, legacyRiskChecks, riskScoreFromChecks } from '../riskCore.js'

export class RiskGateService {
  constructor() {
    this.reservationTimeout = 30 * 1000 // 30 seconds
  }

  // Evaluate execution risk using 4-score decision matrix
  async evaluateExecutionRisk(executionRequest) {
    try {
      const { portfolioId, ticker, direction, quantity, price, signal, marketData } = executionRequest

      // Use 4-score decision matrix for intelligent risk evaluation. Never fabricate inputs:
      // a missing signal/regime/liquidity is scored as unknown, not as confident or bullish.
      const decision = await riskDecisionMatrix.evaluateTradeRequest(
        portfolioId,
        { ticker, direction, ...(signal ?? {}), ...(marketData?.regime && !signal?.regime ? { regime: marketData.regime } : {}) },
        { ticker, price, ...(marketData ?? {}) }
      )

      // Apply position multiplier from decision matrix
      const adjustedQuantity = decision.decision === 'approve' || decision.decision === 'restrict'
        ? Math.floor(quantity * (decision.positionMultiplier || 1.0))
        : 0

      // Legacy compatibility: still run basic checks for safety
      const [portfolioState, riskSettings] = await Promise.all([
        this.getPortfolioState(portfolioId),
        this.getRiskSettings(portfolioId)
      ])

      const positionValue = quantity * price

      const riskChecks = await Promise.all([
        this.checkDailyLoss(portfolioState, riskSettings),
        this.checkPositionSize(positionValue, portfolioState, riskSettings),
        this.checkAccountBalance(portfolioState, riskSettings),
        this.checkLeverageRatio(positionValue, portfolioState, riskSettings),
        this.checkDrawdown(portfolioState, riskSettings),
        this.checkConcurrentTrades(portfolioId, riskSettings),
        this.checkRiskPerTrade(positionValue, portfolioState, riskSettings)
      ])

      const failedChecks = riskChecks.filter(check => !check.passed)

      // Combine decision matrix with legacy checks
      const approved = decision.decision === 'approve' && failedChecks.length === 0

      const result = {
        approved,
        decision: decision.decision,
        reason: decision.reason,
        positionMultiplier: decision.positionMultiplier,
        adjustedQuantity,
        scores: decision.scores,
        checks: riskChecks,
        failedChecks,
        riskScore: this.calculateRiskScore(riskChecks),
        recommendations: decision.decision === 'reject' 
          ? [decision.reason] 
          : this.generateRecommendations(failedChecks, riskSettings),
        portfolioState,
        settings: riskSettings,
        timestamp: new Date()
      }

      return result
    } catch (error) {
      console.error('Risk evaluation failed:', error)
      return {
        approved: false,
        decision: 'reject',
        reason: 'evaluation_error',
        error: error.message,
        timestamp: new Date()
      }
    }
  }

  // Reserve execution slot atomically
  async reserveExecutionSlot(portfolioId) {
    const reservationId = `res_${portfolioId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Clean up expired reservations
        await tx.executionReservation.updateMany({
          where: {
            portfolioId,
            status: 'active',
            expiresAt: { lt: new Date() }
          },
          data: {
            status: 'expired',
            releasedAt: new Date()
          }
        })
        
        // Count current active reservations
        const activeReservations = await tx.executionReservation.count({
          where: {
            portfolioId,
            status: 'active',
            expiresAt: { gt: new Date() }
          }
        })
        
        const riskSettings = await this.getRiskSettings(portfolioId)
        
        if (activeReservations >= riskSettings.maxConcurrentTrades) {
          return {
            success: false,
            error: 'Maximum concurrent trades limit exceeded',
            reservationId: null,
            activeCount: activeReservations
          }
        }
        
        // Create new reservation
        await tx.executionReservation.create({
          data: {
            id: reservationId,
            portfolioId,
            status: 'active',
            expiresAt: new Date(Date.now() + this.reservationTimeout)
          }
        })
        
        return {
          success: true,
          reservationId,
          activeCount: activeReservations + 1
        }
      })
      
      return result
    } catch (error) {
      console.error('Failed to reserve execution slot:', error)
      return {
        success: false,
        error: 'Failed to reserve execution slot: ' + error.message,
        reservationId: null
      }
    }
  }

  // Release execution slot
  async releaseExecutionSlot(portfolioId, reservationId) {
    try {
      await prisma.executionReservation.update({
        where: { id: reservationId },
        data: {
          status: 'released',
          releasedAt: new Date()
        }
      })
      
      return { success: true }
    } catch (error) {
      console.error('Failed to release execution slot:', error)
      return { success: false, error: error.message }
    }
  }

  // Core risk checks: riskCore.legacyRiskChecks (one policy for live and historical runs).
  async activeReservations(portfolioId) {
    return prisma.executionReservation.count({ where: { portfolioId, status: 'active', expiresAt: { gt: new Date() } } })
  }

  check(type, { positionValue = 0, portfolioState, riskSettings, activeReservations = 0 }) {
    return legacyRiskChecks({ positionValue, portfolioState, settings: riskSettings, activeReservations }).find((c) => c.type === type)
  }
  async checkDailyLoss(portfolioState, riskSettings) { return this.check('daily_loss', { portfolioState, riskSettings }) }
  async checkPositionSize(positionValue, portfolioState, riskSettings) { return this.check('position_size', { positionValue, portfolioState, riskSettings }) }
  async checkAccountBalance(portfolioState, riskSettings) { return this.check('account_balance', { portfolioState, riskSettings }) }
  async checkLeverageRatio(positionValue, portfolioState, riskSettings) { return this.check('leverage_ratio', { positionValue, portfolioState, riskSettings }) }
  async checkDrawdown(portfolioState, riskSettings) { return this.check('drawdown', { portfolioState, riskSettings }) }
  async checkConcurrentTrades(portfolioId, riskSettings) {
    return this.check('concurrent_trades', { portfolioState: { totalValue: 1, totalExposure: 0 }, riskSettings, activeReservations: await this.activeReservations(portfolioId) })
  }
  async checkRiskPerTrade(positionValue, portfolioState, riskSettings) { return this.check('risk_per_trade', { positionValue, portfolioState, riskSettings }) }

  // Get portfolio state (simplified)
  async getPortfolioState(portfolioId) {
    // Same user-scoped valuation as Home (FIFO holdings marked at the latest close). Throws
    // when anything is unknown, which evaluateExecutionRisk turns into a rejection.
    const snap = await portfolioRiskSnapshot(portfolioId)
    const history = await portfolioRiskHistory(snap)
    return {
      portfolioId,
      cashBalance: snap.cash,
      totalValue: snap.equity,
      totalExposure: snap.marketValue,
      openPositions: snap.positions.length,
      // Loss since the previous close (simulator value history); realized-only outside it.
      dailyLoss: history.sessionLoss ?? this.calculateDailyLoss(await this.todaysFills(portfolioId)),
      drawdown: history.drawdown ?? 0,
      positions: snap.positions.map((p) => ({ ticker: p.ticker, quantity: p.quantity, value: p.value, avgPrice: p.avgPrice, pnl: p.unrealizedPnl })),
      pricesAsOf: snap.pricesAsOf,
      valuationSource: snap.source,
    }
  }

  async todaysFills(portfolioId) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return prisma.execution.findMany({ where: { portfolioId, status: 'filled', filledAt: { gte: today } } })
  }

  // Get risk settings
  async getRiskSettings(portfolioId) {
    try {
      // Portfolio has no user relation in the schema: read the owner's settings by userId.
      const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId }, select: { userId: true } })

      if (!portfolio) {
        throw new Error(`Portfolio not found: ${portfolioId}`)
      }

      const owner = await prisma.user.findUnique({ where: { id: portfolio.userId }, select: { riskSettings: true } })
      const userSettings = owner?.riskSettings && typeof owner.riskSettings === 'object' ? owner.riskSettings : {}
      
      return { ...DEFAULT_RISK_SETTINGS, ...userSettings }
    } catch (error) {
      console.error('Failed to get risk settings:', error)
      return this.getDefaultRiskSettings()
    }
  }

  // Helper methods
  calculateRiskScore(riskChecks) {
    return riskScoreFromChecks(riskChecks)
  }


  generateRecommendations(failedChecks, riskSettings) {
    const recommendations = []
    
    failedChecks.forEach(check => {
      switch (check.type) {
        case 'daily_loss':
          recommendations.push({
            type: 'reduce_position_size',
            message: 'Daily loss limit approaching. Consider reducing position sizes.',
            priority: 'high'
          })
          break
        case 'position_size':
          recommendations.push({
            type: 'reduce_quantity',
            message: `Position size exceeds limit. Reduce to ${check.limit * 100}% of portfolio.`,
            priority: 'high'
          })
          break
        case 'account_balance':
          recommendations.push({
            type: 'add_funds',
            message: 'Account balance below minimum. Add funds to continue trading.',
            priority: 'critical'
          })
          break
        case 'leverage_ratio':
          recommendations.push({
            type: 'reduce_leverage',
            message: 'Leverage too high. Reduce position sizes or close some positions.',
            priority: 'high'
          })
          break
        case 'drawdown':
          recommendations.push({
            type: 'stop_trading',
            message: 'Drawdown limit exceeded. Consider pausing trading.',
            priority: 'high'
          })
          break
      }
    })
    
    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })
  }



  calculateDailyLoss(filledPositions) {
    const today = new Date().setHours(0, 0, 0, 0)
    const todayTrades = filledPositions.filter(pos => pos.filledAt >= today)
    
    return todayTrades.reduce((sum, pos) => {
      const pnl = pos.pnl || 0
      return pnl < 0 ? sum + Math.abs(pnl) : sum
    }, 0)
  }



  getDefaultRiskSettings() {
    return { ...DEFAULT_RISK_SETTINGS }
  }

}

export const riskGateService = new RiskGateService()
