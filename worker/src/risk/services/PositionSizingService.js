// Position Sizing Service
// Handles dynamic position sizing without recursive risk evaluation

import prisma from '../../db/prisma.js'
import { riskGateService } from './RiskGateService.js'
import { regimeAwareRisk } from '../regimeAwareRisk.js'

export class PositionSizingService {
  constructor() {
    this.sizingCache = new Map()
    this.cacheTtl = 5 * 60 * 1000 // 5 minutes
  }

  // Get approved size with lightweight validation
  async getApprovedSize(signal, regime, portfolioId, maxQuantity) {
    try {
      const cacheKey = `sizing:${portfolioId}:${signal.ticker}:${regime}`
      const cached = this.sizingCache.get(cacheKey)
      
      if (cached && (Date.now() - cached.timestamp < this.cacheTtl)) {
        return cached.result
      }

      // Get portfolio state and base settings
      const [portfolioState, riskSettings] = await Promise.all([
        riskGateService.getPortfolioState(portfolioId),
        riskGateService.getRiskSettings(portfolioId)
      ])

      // Get regime-adjusted settings
      const regimeSettings = await regimeAwareRisk.getRegimeAdjustedRiskSettings(portfolioId, [signal.ticker])
      
      // Calculate base position size
      const basePositionValue = portfolioState.totalValue * riskSettings.maxPositionSize
      const currentPrice = signal.price || 100
      const baseQuantity = basePositionValue / currentPrice

      // Apply multipliers (lightweight, no recursive calls)
      const multipliers = this.calculateSizingMultipliers(signal, regime, portfolioState, regimeSettings)
      
      // Calculate final approved quantity
      const totalMultiplier = multipliers.regime * multipliers.confidence * multipliers.health * multipliers.volatility
      let approvedQuantity = Math.floor(baseQuantity * totalMultiplier)

      // Apply constraints
      approvedQuantity = this.applyQuantityConstraints(approvedQuantity, baseQuantity, maxQuantity, riskSettings)

      // Lightweight final validation (no full risk evaluation)
      const validationResult = await this.validateSizing(approvedQuantity, signal, portfolioState, riskSettings)
      
      if (!validationResult.valid) {
        approvedQuantity = validationResult.adjustedQuantity || 0
      }

      const result = {
        approvedQuantity,
        baseQuantity,
        adjustments: multipliers,
        validation: validationResult,
        reasoning: {
          basePositionValue,
          currentPrice,
          regime,
          portfolioHealth: {
            drawdown: portfolioState.drawdown || 0,
            dailyLoss: portfolioState.dailyLoss || 0
          },
          signal: {
            confidence: signal.confidence,
            volatility: signal.volatility
          }
        }
      }

      // Cache result
      this.sizingCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      })

      return result
    } catch (error) {
      console.error('Failed to get approved size:', error)
      return {
        approvedQuantity: 0,
        error: error.message,
        reasoning: { error: 'Failed to calculate approved size' }
      }
    }
  }

  // Calculate sizing multipliers (lightweight)
  calculateSizingMultipliers(signal, regime, portfolioState, regimeSettings) {
    // Regime multiplier
    let regimeMultiplier = 1.0
    switch (regime) {
      case 'risk_off': regimeMultiplier = 0.3; break
      case 'neutral': regimeMultiplier = 0.6; break
      case 'risk_on': regimeMultiplier = 1.0; break
      case 'strong_bull': regimeMultiplier = 1.2; break
      default: regimeMultiplier = 0.5; break
    }

    // Confidence multiplier
    let confidenceMultiplier = 1.0
    if (signal.confidence) {
      if (signal.confidence >= 0.8) confidenceMultiplier = 1.2
      else if (signal.confidence >= 0.6) confidenceMultiplier = 1.0
      else if (signal.confidence >= 0.4) confidenceMultiplier = 0.8
      else confidenceMultiplier = 0.5
    }

    // Portfolio health multiplier
    let healthMultiplier = 1.0
    const currentDrawdown = portfolioState.drawdown || 0
    const dailyLoss = portfolioState.dailyLoss || 0
    
    if (currentDrawdown > 0.1) healthMultiplier *= 0.5
    else if (currentDrawdown > 0.05) healthMultiplier *= 0.7
    
    if (dailyLoss > 800) healthMultiplier *= 0.6  // Use 80% of daily limit

    // Volatility multiplier
    let volatilityMultiplier = 1.0
    if (signal.volatility) {
      if (signal.volatility > 0.3) volatilityMultiplier = 0.7
      else if (signal.volatility < 0.1) volatilityMultiplier = 1.1
    }

    return {
      regime: regimeMultiplier,
      confidence: confidenceMultiplier,
      health: healthMultiplier,
      volatility: volatilityMultiplier
    }
  }

  // Apply quantity constraints
  applyQuantityConstraints(approvedQuantity, baseQuantity, maxQuantity, riskSettings) {
    // Minimum quantity (at least 10% of base)
    const minQuantity = Math.max(1, Math.floor(baseQuantity * 0.1))
    
    // Maximum quantity (capped at 150% of base or user max)
    const maxAllowedQuantity = Math.min(
      maxQuantity || Infinity,
      Math.floor(baseQuantity * 1.5)
    )

    return Math.max(minQuantity, Math.min(approvedQuantity, maxAllowedQuantity))
  }

  // Lightweight validation (no full risk evaluation)
  async validateSizing(quantity, signal, portfolioState, riskSettings) {
    const positionValue = quantity * (signal.price || 100)
    
    // Basic checks only
    const checks = {
      positionSize: positionValue <= (portfolioState.totalValue * riskSettings.maxPositionSize),
      riskPerTrade: (positionValue / portfolioState.totalValue) <= riskSettings.maxRiskPerTrade,
      dailyLoss: portfolioState.dailyLoss <= (riskSettings.maxDailyLoss * 0.9) // Leave buffer
    }

    const valid = Object.values(checks).every(check => check)
    
    if (!valid) {
      // Adjust quantity if possible
      let adjustedQuantity = quantity
      
      if (!checks.positionSize) {
        const maxValue = portfolioState.totalValue * riskSettings.maxPositionSize
        adjustedQuantity = Math.floor(maxValue / (signal.price || 100))
      }
      
      if (!checks.riskPerTrade) {
        const maxValue = portfolioState.totalValue * riskSettings.maxRiskPerTrade
        adjustedQuantity = Math.floor(maxValue / (signal.price || 100))
      }
      
      return {
        valid: false,
        adjustedQuantity,
        failedChecks: Object.keys(checks).filter(key => !checks[key])
      }
    }

    return { valid, checks }
  }

  // Get sizing recommendations
  async getSizingRecommendations(portfolioId) {
    try {
      const [portfolioState, riskSettings] = await Promise.all([
        riskGateService.getPortfolioState(portfolioId),
        riskGateService.getRiskSettings(portfolioId)
      ])

      const recommendations = []

      // Position size recommendations
      const currentDrawdown = portfolioState.drawdown || 0
      if (currentDrawdown > 0.05) {
        recommendations.push({
          type: 'reduce_sizing',
          priority: 'medium',
          message: `Consider reducing position sizes due to ${(currentDrawdown * 100).toFixed(1)}% drawdown`,
          action: 'Reduce max position size by 20-30%'
        })
      }

      // Daily loss recommendations
      const dailyLoss = portfolioState.dailyLoss || 0
      if (dailyLoss > riskSettings.maxDailyLoss * 0.7) {
        recommendations.push({
          type: 'daily_loss_warning',
          priority: 'high',
          message: `Daily loss is ${((dailyLoss / riskSettings.maxDailyLoss) * 100).toFixed(1)}% of limit`,
          action: 'Consider pausing trading until tomorrow'
        })
      }

      // Concentration recommendations
      const sectorConcentration = this.calculateSectorConcentration(portfolioState.positions)
      if (sectorConcentration > 0.4) {
        recommendations.push({
          type: 'diversify',
          priority: 'medium',
          message: `Sector concentration is ${(sectorConcentration * 100).toFixed(1)}%`,
          action: 'Add positions in different sectors'
        })
      }

      return {
        portfolioId,
        timestamp: new Date(),
        recommendations,
        portfolioHealth: {
          drawdown: currentDrawdown,
          dailyLoss,
          sectorConcentration
        }
      }
    } catch (error) {
      console.error('Failed to get sizing recommendations:', error)
      return { portfolioId, recommendations: [], error: error.message }
    }
  }

  // Calculate sector concentration
  calculateSectorConcentration(positions) {
    const sectorMap = {
      'AAPL': 'Technology', 'MSFT': 'Technology', 'GOOGL': 'Technology', 'TSLA': 'Technology', 'NVDA': 'Technology',
      'JPM': 'Financial', 'BAC': 'Financial', 'WFC': 'Financial',
      'JNJ': 'Healthcare', 'PFE': 'Healthcare', 'UNH': 'Healthcare',
      'XOM': 'Energy', 'CVX': 'Energy',
      'AMZN': 'Consumer', 'WMT': 'Consumer', 'HD': 'Consumer'
    }

    const sectorExposure = new Map()
    let totalExposure = 0

    positions.forEach(pos => {
      const sector = sectorMap[pos.ticker] || 'Other'
      const current = sectorExposure.get(sector) || 0
      sectorExposure.set(sector, current + pos.value)
      totalExposure += pos.value
    })

    if (totalExposure === 0) return 0

    const maxSectorExposure = Math.max(...sectorExposure.values())
    return maxSectorExposure / totalExposure
  }

  // Clear sizing cache
  clearCache(portfolioId = null) {
    if (portfolioId) {
      // Clear specific portfolio cache entries
      for (const [key] of this.sizingCache) {
        if (key.startsWith(`sizing:${portfolioId}:`)) {
          this.sizingCache.delete(key)
        }
      }
    } else {
      this.sizingCache.clear()
    }
  }

  // Get sizing statistics
  async getSizingStatistics(portfolioId, days = 30) {
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      
      const executions = await prisma.execution.findMany({
        where: {
          portfolioId,
          status: 'filled',
          filledAt: { gte: cutoff }
        },
        select: {
          quantity: true,
          price: true,
          filledPrice: true,
          ticker: true,
          filledAt: true
        }
      })

      const statistics = {
        totalTrades: executions.length,
        avgQuantity: 0,
        avgPositionValue: 0,
        quantityByTicker: {},
        positionValueByTicker: {},
        sizingTrend: []
      }

      if (executions.length > 0) {
        statistics.avgQuantity = executions.reduce((sum, exec) => sum + exec.quantity, 0) / executions.length
        statistics.avgPositionValue = executions.reduce((sum, exec) => sum + (exec.quantity * exec.filledPrice), 0) / executions.length

        // Group by ticker
        executions.forEach(exec => {
          const ticker = exec.ticker
          statistics.quantityByTicker[ticker] = (statistics.quantityByTicker[ticker] || 0) + exec.quantity
          statistics.positionValueByTicker[ticker] = (statistics.positionValueByTicker[ticker] || 0) + (exec.quantity * exec.filledPrice)
        })

        // Calculate trend (simplified)
        const dailyGroups = this.groupExecutionsByDay(executions)
        statistics.sizingTrend = Object.keys(dailyGroups).map(day => ({
          date: day,
          avgQuantity: dailyGroups[day].reduce((sum, exec) => sum + exec.quantity, 0) / dailyGroups[day].length,
          tradeCount: dailyGroups[day].length
        }))
      }

      return {
        portfolioId,
        period: `${days} days`,
        timestamp: new Date(),
        statistics
      }
    } catch (error) {
      console.error('Failed to get sizing statistics:', error)
      return { portfolioId, statistics: {}, error: error.message }
    }
  }

  // Group executions by day
  groupExecutionsByDay(executions) {
    const dailyGroups = {}
    
    executions.forEach(exec => {
      const day = exec.filledAt.toISOString().split('T')[0]
      if (!dailyGroups[day]) {
        dailyGroups[day] = []
      }
      dailyGroups[day].push(exec)
    })
    
    return dailyGroups
  }
}

export const positionSizingService = new PositionSizingService()
