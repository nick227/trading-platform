// Risk Gate Service
// Handles execution approval and basic risk checks

import prisma from '../../db/prisma.js'
import { redisRiskCache } from '../redisCache.js'
import { riskDecisionMatrix } from './RiskDecisionMatrix.js'

export class RiskGateService {
  constructor() {
    this.reservationTimeout = 30 * 1000 // 30 seconds
  }

  // Evaluate execution risk using 4-score decision matrix
  async evaluateExecutionRisk(executionRequest) {
    try {
      const { portfolioId, ticker, direction, quantity, price, signal } = executionRequest

      // Use 4-score decision matrix for intelligent risk evaluation
      const decision = await riskDecisionMatrix.evaluateTradeRequest(
        portfolioId,
        signal || { confidence: 0.7, ticker, regime: 'bull' },
        { ticker, price }
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

  // Core risk checks
  async checkDailyLoss(portfolioState, riskSettings) {
    const dailyLoss = portfolioState.dailyLoss || 0
    const maxDailyLoss = riskSettings.maxDailyLoss
    
    return {
      type: 'daily_loss',
      passed: dailyLoss <= maxDailyLoss,
      current: dailyLoss,
      limit: maxDailyLoss,
      severity: dailyLoss > maxDailyLoss * 0.8 ? 'high' : 'medium'
    }
  }

  async checkPositionSize(positionValue, portfolioState, riskSettings) {
    const maxPositionValue = portfolioState.totalValue * riskSettings.maxPositionSize
    
    return {
      type: 'position_size',
      passed: positionValue <= maxPositionValue,
      current: positionValue,
      limit: maxPositionValue,
      severity: positionValue > maxPositionValue * 0.9 ? 'high' : 'medium'
    }
  }

  async checkAccountBalance(portfolioState, riskSettings) {
    const balance = portfolioState.cashBalance || 0
    const minBalance = riskSettings.minAccountBalance
    
    return {
      type: 'account_balance',
      passed: balance >= minBalance,
      current: balance,
      limit: minBalance,
      severity: balance < minBalance * 0.5 ? 'critical' : 'high'
    }
  }

  async checkLeverageRatio(positionValue, portfolioState, riskSettings) {
    const totalExposure = portfolioState.totalExposure + positionValue
    const leverageRatio = totalExposure / portfolioState.totalValue
    const maxLeverage = riskSettings.maxLeverage
    
    return {
      type: 'leverage_ratio',
      passed: leverageRatio <= maxLeverage,
      current: leverageRatio,
      limit: maxLeverage,
      severity: leverageRatio > maxLeverage * 0.9 ? 'high' : 'medium'
    }
  }

  async checkDrawdown(portfolioState, riskSettings) {
    const drawdown = portfolioState.drawdown || 0
    const maxDrawdown = riskSettings.maxDrawdown
    
    return {
      type: 'drawdown',
      passed: drawdown <= maxDrawdown,
      current: drawdown,
      limit: maxDrawdown,
      severity: drawdown > maxDrawdown * 0.9 ? 'critical' : 'high'
    }
  }

  async checkConcurrentTrades(portfolioId, riskSettings) {
    const activeReservations = await prisma.executionReservation.count({
      where: {
        portfolioId,
        status: 'active',
        expiresAt: { gt: new Date() }
      }
    })
    
    return {
      type: 'concurrent_trades',
      passed: activeReservations < riskSettings.maxConcurrentTrades,
      current: activeReservations,
      limit: riskSettings.maxConcurrentTrades,
      severity: activeReservations >= riskSettings.maxConcurrentTrades ? 'high' : 'low'
    }
  }

  async checkRiskPerTrade(positionValue, portfolioState, riskSettings) {
    const riskPerTrade = positionValue / portfolioState.totalValue
    const maxRiskPerTrade = riskSettings.maxRiskPerTrade
    
    return {
      type: 'risk_per_trade',
      passed: riskPerTrade <= maxRiskPerTrade,
      current: riskPerTrade,
      limit: maxRiskPerTrade,
      severity: riskPerTrade > maxRiskPerTrade * 0.9 ? 'high' : 'medium'
    }
  }

  // Get portfolio state (simplified)
  async getPortfolioState(portfolioId) {
    try {
      // Check cache first
      const cached = await redisRiskCache.get(portfolioId)
      if (cached) {
        return cached
      }

      // Get basic portfolio data
      const [portfolio, filledPositions, brokerAccount] = await Promise.all([
        prisma.portfolio.findUnique({ where: { id: portfolioId } }),
        prisma.execution.findMany({
          where: { portfolioId, status: 'filled' },
          orderBy: { filledAt: 'desc' },
          take: 100
        }),
        this.getBrokerAccountData(portfolioId)
      ])

      const state = {
        portfolioId,
        cashBalance: brokerAccount?.cash || portfolio?.cashBalance || 0,
        totalValue: brokerAccount?.equity || portfolio?.totalValue || 0,
        totalExposure: this.calculateTotalExposure(filledPositions),
        openPositions: this.calculateOpenPositions(filledPositions),
        dailyLoss: this.calculateDailyLoss(filledPositions),
        drawdown: this.calculateDrawdown(portfolioId, brokerAccount?.equity || 0),
        positions: this.calculatePositions(filledPositions)
      }

      // Cache for 30 seconds
      await redisRiskCache.set(portfolioId, state, 30)
      
      return state
    } catch (error) {
      console.error('Failed to get portfolio state:', error)
      throw error
    }
  }

  // Get risk settings
  async getRiskSettings(portfolioId) {
    try {
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        include: {
          user: {
            select: { riskSettings: true }
          }
        }
      })

      if (!portfolio) {
        throw new Error(`Portfolio not found: ${portfolioId}`)
      }

      const userSettings = portfolio.user?.riskSettings || {}
      
      // Default risk limits
      const defaults = {
        maxDailyLoss: 1000,
        maxPositionSize: 0.1,
        maxOpenPositions: 10,
        maxLeverage: 2.0,
        maxDrawdown: 0.15,
        minAccountBalance: 1000,
        maxConcurrentTrades: 5,
        maxRiskPerTrade: 0.02
      }

      return { ...defaults, ...userSettings }
    } catch (error) {
      console.error('Failed to get risk settings:', error)
      return this.getDefaultRiskSettings()
    }
  }

  // Helper methods
  calculateRiskScore(riskChecks) {
    let score = 100
    riskChecks.forEach(check => {
      if (!check.passed) {
        switch (check.severity) {
          case 'critical': score -= 25; break
          case 'high': score -= 15; break
          case 'medium': score -= 10; break
          case 'low': score -= 5; break
        }
      }
    })
    return Math.max(0, score)
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

  calculateTotalExposure(filledPositions) {
    return filledPositions.reduce((sum, pos) => {
      return sum + Math.abs((pos.quantity || 0) * (pos.filledPrice || 0))
    }, 0)
  }

  calculateOpenPositions(filledPositions) {
    const uniqueTickers = new Set(filledPositions.map(pos => pos.ticker))
    return uniqueTickers.size
  }

  calculateDailyLoss(filledPositions) {
    const today = new Date().setHours(0, 0, 0, 0)
    const todayTrades = filledPositions.filter(pos => pos.filledAt >= today)
    
    return todayTrades.reduce((sum, pos) => {
      const pnl = pos.pnl || 0
      return pnl < 0 ? sum + Math.abs(pnl) : sum
    }, 0)
  }

  calculateDrawdown(portfolioId, currentEquity) {
    // Simplified drawdown calculation
    return 0 // Would need historical equity data
  }

  calculatePositions(filledPositions) {
    const holdingsByTicker = new Map()
    
    filledPositions.forEach(pos => {
      const existing = holdingsByTicker.get(pos.ticker) || { quantity: 0, totalValue: 0 }
      const signedQuantity = pos.direction === 'buy' ? pos.quantity : -pos.quantity
      const signedValue = pos.direction === 'buy' ? (pos.quantity * pos.filledPrice) : -(pos.quantity * pos.filledPrice)
      
      holdingsByTicker.set(pos.ticker, {
        quantity: existing.quantity + signedQuantity,
        totalValue: existing.totalValue + signedValue,
        avgPrice: pos.filledPrice,
        pnl: (existing.pnl || 0) + (pos.pnl || 0)
      })
    })

    return Array.from(holdingsByTicker.entries())
      .filter(([ticker, holding]) => Math.abs(holding.quantity) > 0.001)
      .map(([ticker, holding]) => ({
        ticker,
        quantity: holding.quantity,
        value: Math.abs(holding.totalValue),
        avgPrice: holding.avgPrice,
        pnl: holding.pnl
      }))
  }

  async getBrokerAccountData(portfolioId) {
    // Placeholder for broker account data
    return { cash: 10000, equity: 12000 }
  }

  getDefaultRiskSettings() {
    return {
      maxDailyLoss: 1000,
      maxPositionSize: 0.1,
      maxOpenPositions: 10,
      maxLeverage: 2.0,
      maxDrawdown: 0.15,
      minAccountBalance: 1000,
      maxConcurrentTrades: 5,
      maxRiskPerTrade: 0.02
    }
  }
}

export const riskGateService = new RiskGateService()
