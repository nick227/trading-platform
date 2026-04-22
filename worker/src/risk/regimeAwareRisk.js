// Regime-Aware Risk Management
// Adjusts risk limits and behavior based on market regime

import prisma from '../db/prisma.js'
import { redisRiskCache } from './redisCache.js'

export class RegimeAwareRisk {
  constructor() {
    this.regimeCache = new Map()
    this.cacheTtl = 5 * 60 * 1000 // 5 minutes
  }

  // Get current market regime for a symbol
  async getMarketRegime(symbol) {
    try {
      // Check cache first
      const cacheKey = `regime:${symbol}`
      const cached = this.regimeCache.get(cacheKey)
      
      if (cached && (Date.now() - cached.timestamp < this.cacheTtl)) {
        return cached.regime
      }

      // Get latest regime from database
      const regime = await prisma.marketRegime.findFirst({
        where: { symbol },
        orderBy: { asOf: 'desc' },
        select: { regime: true, score: true, asOf: true }
      })

      const result = regime ? {
        regime: regime.regime,
        score: regime.score,
        asOf: regime.asOf
      } : {
        regime: 'neutral',
        score: 0.5,
        asOf: new Date()
      }

      // Cache the result
      this.regimeCache.set(cacheKey, {
        ...result,
        timestamp: Date.now()
      })

      return result
    } catch (error) {
      console.error('Failed to get market regime:', error)
      return { regime: 'neutral', score: 0.5, asOf: new Date() }
    }
  }

  // Get regime-adjusted risk settings
  async getRegimeAdjustedRiskSettings(portfolioId, symbols = []) {
    try {
      const baseSettings = await this.getBaseRiskSettings(portfolioId)
      
      // Get regime for each symbol
      const regimes = await Promise.all(
        symbols.map(symbol => this.getMarketRegime(symbol))
      )

      // Calculate portfolio-wide regime assessment
      const portfolioRegime = this.calculatePortfolioRegime(regimes)

      // Apply regime adjustments
      const adjustedSettings = this.applyRegimeAdjustments(baseSettings, portfolioRegime)

      return {
        ...adjustedSettings,
        baseSettings,
        regime: portfolioRegime,
        symbolRegimes: regimes,
        adjustments: this.getAdjustmentDetails(baseSettings, adjustedSettings)
      }
    } catch (error) {
      console.error('Failed to get regime-adjusted risk settings:', error)
      throw error
    }
  }

  // Calculate portfolio-wide regime from multiple symbols
  calculatePortfolioRegime(regimes) {
    if (regimes.length === 0) {
      return { regime: 'neutral', score: 0.5, confidence: 0 }
    }

    // Weight regime scores by confidence (based on recency and score strength)
    const weightedScores = regimes.map(r => {
      const confidence = Math.abs(r.score - 0.5) * 2 // Convert to 0-1 scale
      return {
        regime: r.regime,
        score: r.score,
        confidence,
        weight: confidence
      }
    })

    // Calculate weighted average
    const totalWeight = weightedScores.reduce((sum, r) => sum + r.weight, 0)
    const avgScore = weightedScores.reduce((sum, r) => sum + (r.score * r.weight), 0) / totalWeight

    // Determine regime from average score
    let regime = 'neutral'
    if (avgScore > 0.7) regime = 'risk_on'
    else if (avgScore > 0.85) regime = 'strong_bull'
    else if (avgScore < 0.3) regime = 'risk_off'
    else if (avgScore < 0.15) regime = 'strong_bear'

    return {
      regime,
      score: avgScore,
      confidence: totalWeight / regimes.length,
      componentRegimes: regimes
    }
  }

  // Apply regime-specific adjustments to risk settings
  applyRegimeAdjustments(baseSettings, portfolioRegime) {
    const { regime, score } = portfolioRegime
    const adjustments = this.getRegimeMultipliers(regime, score)

    return {
      maxDailyLoss: baseSettings.maxDailyLoss * adjustments.dailyLoss,
      maxPositionSize: baseSettings.maxPositionSize * adjustments.positionSize,
      maxOpenPositions: Math.floor(baseSettings.maxOpenPositions * adjustments.openPositions),
      maxLeverage: baseSettings.maxLeverage * adjustments.leverage,
      maxDrawdown: baseSettings.maxDrawdown * adjustments.drawdown,
      maxConcurrentTrades: Math.floor(baseSettings.maxConcurrentTrades * adjustments.concurrentTrades),
      maxRiskPerTrade: baseSettings.maxRiskPerTrade * adjustments.riskPerTrade,
      stopLossPercentage: baseSettings.stopLossPercentage * adjustments.stopLoss,
      takeProfitPercentage: baseSettings.takeProfitPercentage * adjustments.takeProfit,
      // Regime-specific settings
      confidenceThreshold: adjustments.confidenceThreshold,
      volatilityAdjustment: adjustments.volatilityAdjustment,
      overnightHoldingAllowed: adjustments.overnightHoldingAllowed
    }
  }

  // Get regime-specific multipliers
  getRegimeMultipliers(regime, score) {
    const baseMultipliers = {
      risk_off: {
        dailyLoss: 0.5,        // Reduce daily loss limit by 50%
        positionSize: 0.4,     // Reduce position size by 60%
        openPositions: 0.6,    // Reduce number of positions
        leverage: 0.5,         // Reduce leverage by 50%
        drawdown: 0.8,         // Slightly tighter drawdown limit
        concurrentTrades: 0.6, // Reduce concurrent trades
        riskPerTrade: 0.5,     // Reduce risk per trade
        stopLoss: 0.8,         // Tighter stop losses
        takeProfit: 0.7,       // Earlier take profits
        confidenceThreshold: 0.8, // Higher confidence required
        volatilityAdjustment: 0.7, // Reduce size in volatile markets
        overnightHoldingAllowed: false // No overnight holds
      },
      neutral: {
        dailyLoss: 1.0,
        positionSize: 1.0,
        openPositions: 1.0,
        leverage: 1.0,
        drawdown: 1.0,
        concurrentTrades: 1.0,
        riskPerTrade: 1.0,
        stopLoss: 1.0,
        takeProfit: 1.0,
        confidenceThreshold: 0.6,
        volatilityAdjustment: 1.0,
        overnightHoldingAllowed: true
      },
      risk_on: {
        dailyLoss: 1.2,        // Increase daily loss limit by 20%
        positionSize: 1.3,     // Increase position size by 30%
        openPositions: 1.2,    // More positions allowed
        leverage: 1.2,         // Increase leverage
        drawdown: 1.1,         // Slightly looser drawdown
        concurrentTrades: 1.3,  // More concurrent trades
        riskPerTrade: 1.2,     // More risk per trade
        stopLoss: 1.1,         // Wider stop losses
        takeProfit: 1.3,       // Higher profit targets
        confidenceThreshold: 0.5, // Lower confidence threshold
        volatilityAdjustment: 1.2, // Can handle more volatility
        overnightHoldingAllowed: true
      },
      strong_bull: {
        dailyLoss: 1.5,        // 50% higher daily loss limit
        positionSize: 1.5,     // 50% larger positions
        openPositions: 1.4,    // More positions
        leverage: 1.4,         // More leverage
        drawdown: 1.2,         // Looser drawdown
        concurrentTrades: 1.5,  // More concurrent trades
        riskPerTrade: 1.4,     // More risk per trade
        stopLoss: 1.2,         // Wider stops
        takeProfit: 1.5,       // Higher targets
        confidenceThreshold: 0.4, // Even lower confidence
        volatilityAdjustment: 1.3, // Handle volatility well
        overnightHoldingAllowed: true
      },
      strong_bear: {
        dailyLoss: 0.3,        // Very conservative
        positionSize: 0.2,     // Very small positions
        openPositions: 0.4,    // Few positions
        leverage: 0.3,         // Minimal leverage
        drawdown: 0.6,         // Tight drawdown
        concurrentTrades: 0.3,  // Very few concurrent
        riskPerTrade: 0.3,     // Very low risk per trade
        stopLoss: 0.6,         // Tight stops
        takeProfit: 0.5,       // Quick profits
        confidenceThreshold: 0.9, // Very high confidence
        volatilityAdjustment: 0.5, // Reduce for volatility
        overnightHoldingAllowed: false // No overnight
      }
    }

    return baseMultipliers[regime] || baseMultipliers.neutral
  }

  // Get base risk settings
  async getBaseRiskSettings(portfolioId) {
    try {
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        include: {
          user: {
            select: { riskSettings: true }
          }
        }
      })

      const userSettings = portfolio?.user?.riskSettings || {}
      
      // Default risk limits
      const defaults = {
        maxDailyLoss: 1000,
        maxPositionSize: 0.1,
        maxOpenPositions: 10,
        maxLeverage: 2.0,
        maxDrawdown: 0.15,
        minAccountBalance: 1000,
        maxConcurrentTrades: 5,
        maxRiskPerTrade: 0.02,
        stopLossPercentage: 0.05,
        takeProfitPercentage: 0.10
      }

      return { ...defaults, ...userSettings }
    } catch (error) {
      console.error('Failed to get base risk settings:', error)
      throw error
    }
  }

  // Get adjustment details for logging
  getAdjustmentDetails(baseSettings, adjustedSettings) {
    const adjustments = {}
    
    Object.keys(baseSettings).forEach(key => {
      if (baseSettings[key] !== adjustedSettings[key]) {
        const change = ((adjustedSettings[key] - baseSettings[key]) / baseSettings[key]) * 100
        adjustments[key] = {
          from: baseSettings[key],
          to: adjustedSettings[key],
          changePercent: change
        }
      }
    })

    return adjustments
  }

  // Check if trade should be allowed based on regime
  async isTradeAllowedInRegime(portfolioId, symbol, signal) {
    try {
      const regimeData = await this.getRegimeAdjustedRiskSettings(portfolioId, [symbol])
      const { regime, confidenceThreshold } = regimeData

      // Check confidence threshold
      if (signal.confidence && signal.confidence < confidenceThreshold) {
        return {
          allowed: false,
          reason: 'confidence_too_low',
          required: confidenceThreshold,
          actual: signal.confidence,
          regime: regime.regime
        }
      }

      // Check overnight holding restrictions
      if (!regime.overnightHoldingAllowed && this.isNearMarketClose()) {
        return {
          allowed: false,
          reason: 'overnight_not_allowed',
          regime: regime.regime
        }
      }

      // Check volatility adjustments
      if (signal.volatility && regime.volatilityAdjustment < 1.0) {
        const adjustedThreshold = 0.3 / regime.volatilityAdjustment
        if (signal.volatility > adjustedThreshold) {
          return {
            allowed: false,
            reason: 'volatility_too_high',
            maxAllowed: adjustedThreshold,
            actual: signal.volatility,
            regime: regime.regime
          }
        }
      }

      return {
        allowed: true,
        regime: regime.regime,
        adjustments: regime.adjustments
      }
    } catch (error) {
      console.error('Failed to check regime trade allowance:', error)
      return { allowed: false, reason: 'error', error: error.message }
    }
  }

  // Check if market is near close
  isNearMarketClose() {
    const now = new Date()
    const marketClose = new Date()
    marketClose.setHours(16, 0, 0, 0) // 4 PM EST
    
    const timeToClose = marketClose.getTime() - now.getTime()
    return timeToClose < 30 * 60 * 1000 // 30 minutes before close
  }

  // Update regime cache
  updateRegimeCache(symbol, regimeData) {
    const cacheKey = `regime:${symbol}`
    this.regimeCache.set(cacheKey, {
      ...regimeData,
      timestamp: Date.now()
    })
  }

  // Clear regime cache
  clearRegimeCache(symbol = null) {
    if (symbol) {
      this.regimeCache.delete(`regime:${symbol}`)
    } else {
      this.regimeCache.clear()
    }
  }

  // Get regime change alerts
  async getRegimeChangeAlerts(portfolioId, symbols = []) {
    try {
      const currentRegimes = await Promise.all(
        symbols.map(symbol => this.getMarketRegime(symbol))
      )

      const alerts = []
      const portfolioRegime = this.calculatePortfolioRegime(currentRegimes)

      // Check for regime changes
      const cacheKey = `portfolio:${portfolioId}:regime`
      const cachedRegime = this.regimeCache.get(cacheKey)

      if (cachedRegime && cachedRegime.regime !== portfolioRegime.regime) {
        alerts.push({
          type: 'regime_change',
          from: cachedRegime.regime,
          to: portfolioRegime.regime,
          score: portfolioRegime.score,
          confidence: portfolioRegime.confidence,
          timestamp: new Date(),
          impact: this.getRegimeChangeImpact(cachedRegime.regime, portfolioRegime.regime)
        })
      }

      // Update cache
      this.regimeCache.set(cacheKey, {
        ...portfolioRegime,
        timestamp: Date.now()
      })

      return alerts
    } catch (error) {
      console.error('Failed to get regime change alerts:', error)
      return []
    }
  }

  // Get impact of regime change
  getRegimeChangeImpact(fromRegime, toRegime) {
    const impacts = {
      'neutral_to_risk_on': 'positive',
      'neutral_to_risk_off': 'negative',
      'risk_on_to_neutral': 'caution',
      'risk_off_to_neutral': 'positive',
      'risk_on_to_risk_off': 'strong_negative',
      'risk_off_to_risk_on': 'strong_positive'
    }

    const key = `${fromRegime}_to_${toRegime}`
    return impacts[key] || 'moderate'
  }
}

export const regimeAwareRisk = new RegimeAwareRisk()
