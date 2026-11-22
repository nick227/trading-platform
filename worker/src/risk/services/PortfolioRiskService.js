// Portfolio Risk Service
// Handles portfolio state calculation and risk monitoring

import { clearRiskSnapshotCache, portfolioRiskSnapshot } from '../accountSnapshot.js'
import { valueHistory } from '../../../../server/src/services/portfolioValuationService.js'
import { riskGateService } from './RiskGateService.js'

export class PortfolioRiskService {
  constructor() {
  }

  // Get comprehensive portfolio state
  // One portfolio state for every risk consumer: the gate's, built on the shared
  // user-scoped valuation (same numbers as Home). Throws when anything is unknown.
  async getPortfolioState(portfolioId) {
    return riskGateService.getPortfolioState(portfolioId)
  }

  // Daily series from the owner's value history (Home's chart), with running drawdown and
  // session-over-session P&L. Empty outside the simulator (no broker history is stored).
  async valueSeries(portfolioId) {
    const snap = await portfolioRiskSnapshot(portfolioId)
    const h = await valueHistory(snap.userId)
    let peak = snap.startingCash ?? 0
    let prev = snap.startingCash ?? null
    return h.points.filter((p) => p.value !== null).map((p) => {
      peak = Math.max(peak, p.value)
      const row = {
        date: p.date, equity: p.value, cash: p.cash, totalValue: p.value,
        drawdown: peak > 0 ? Math.max(0, (peak - p.value) / peak) : 0,
        dailyPnL: prev !== null ? Number((p.value - prev).toFixed(2)) : 0,
      }
      prev = p.value
      return row
    })
  }

  async getPortfolioRiskMetrics(portfolioId) {
    try {
      const portfolioState = await this.getPortfolioState(portfolioId)
      
      // Calculate risk metrics
      const metrics = {
        // Concentration metrics
        sectorConcentration: this.calculateSectorConcentration(portfolioState.positions),
        tickerConcentration: this.calculateTickerConcentration(portfolioState.positions),
        
        // Leverage metrics
        leverageRatio: portfolioState.totalExposure / portfolioState.totalValue,
        
        // Drawdown metrics
        currentDrawdown: portfolioState.drawdown,
        maxDrawdown: await this.getMaxDrawdown(portfolioId),
        
        // Daily metrics
        dailyLoss: portfolioState.dailyLoss,
        dailyPnL: await this.getDailyPnL(portfolioId),
        
        // Position metrics
        openPositions: portfolioState.openPositions,
        largestPosition: this.getLargestPosition(portfolioState.positions),
        
        // Health metrics
        portfolioHealth: this.calculatePortfolioHealth(portfolioState),
        riskScore: this.calculatePortfolioRiskScore(portfolioState)
      }

      return {
        portfolioId,
        timestamp: new Date(),
        metrics,
        portfolioState
      }
    } catch (error) {
      console.error('Failed to get portfolio risk metrics:', error)
      throw error
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

  // Calculate ticker concentration
  calculateTickerConcentration(positions) {
    if (positions.length === 0) return 0

    const totalExposure = positions.reduce((sum, pos) => sum + pos.value, 0)
    const maxPosition = Math.max(...positions.map(pos => pos.value))

    return maxPosition / totalExposure
  }

  // Largest peak-to-trough decline in the owner's value history (current if no history).
  async getMaxDrawdown(portfolioId) {
    const series = await this.valueSeries(portfolioId)
    if (series.length === 0) return (await this.getPortfolioState(portfolioId)).drawdown
    return Math.max(...series.map((d) => d.drawdown))
  }

  // Change in portfolio value since the previous close (same as Home's one-day change).
  async getDailyPnL(portfolioId) {
    const series = await this.valueSeries(portfolioId)
    return series.length ? series[series.length - 1].dailyPnL : 0
  }

  // Get largest position
  getLargestPosition(positions) {
    if (positions.length === 0) return null
    
    return positions.reduce((largest, pos) => 
      pos.value > largest.value ? pos : largest, positions[0]
    )
  }

  // Calculate portfolio health score
  calculatePortfolioHealth(portfolioState) {
    let healthScore = 100

    // Drawdown impact
    if (portfolioState.drawdown > 0.1) healthScore -= 30
    else if (portfolioState.drawdown > 0.05) healthScore -= 15

    // Daily loss impact
    if (portfolioState.dailyLoss > 500) healthScore -= 20
    else if (portfolioState.dailyLoss > 200) healthScore -= 10

    // Concentration impact
    const sectorConc = this.calculateSectorConcentration(portfolioState.positions)
    if (sectorConc > 0.5) healthScore -= 15
    else if (sectorConc > 0.3) healthScore -= 8

    // Leverage impact
    const leverage = portfolioState.totalExposure / portfolioState.totalValue
    if (leverage > 2.0) healthScore -= 20
    else if (leverage > 1.5) healthScore -= 10

    return Math.max(0, healthScore)
  }

  // Calculate portfolio risk score
  calculatePortfolioRiskScore(portfolioState) {
    let riskScore = 0

    // Drawdown risk
    riskScore += portfolioState.drawdown * 100

    // Daily loss risk
    riskScore += (portfolioState.dailyLoss / 1000) * 20

    // Concentration risk
    const sectorConc = this.calculateSectorConcentration(portfolioState.positions)
    riskScore += sectorConc * 30

    // Leverage risk
    const leverage = portfolioState.totalExposure / portfolioState.totalValue
    riskScore += Math.max(0, (leverage - 1) * 25)

    // Position count risk
    if (portfolioState.openPositions > 15) riskScore += 15
    else if (portfolioState.openPositions > 10) riskScore += 8

    return Math.min(100, riskScore)
  }

  // Portfolio history for trends: the owner's value series (the ownerless DailySnapshot
  // table is never read or written).
  async getPortfolioHistory(portfolioId, days = 30) {
    try {
      return (await this.valueSeries(portfolioId)).slice(-days)
    } catch (error) {
      console.error('Failed to get portfolio history:', error)
      return []
    }
  }

  clearCache() {
    clearRiskSnapshotCache()
  }

  // Get portfolio risk summary
  async getPortfolioRiskSummary(portfolioId) {
    try {
      const [riskMetrics, history] = await Promise.all([
        this.getPortfolioRiskMetrics(portfolioId),
        this.getPortfolioHistory(portfolioId, 7) // Last 7 days
      ])

      // Calculate trends
      const trends = this.calculateRiskTrends(history)

      return {
        portfolioId,
        timestamp: new Date(),
        currentRisk: riskMetrics.metrics,
        trends,
        recommendations: this.generatePortfolioRecommendations(riskMetrics.metrics, trends)
      }
    } catch (error) {
      console.error('Failed to get portfolio risk summary:', error)
      throw error
    }
  }

  // Calculate risk trends
  calculateRiskTrends(history) {
    if (history.length < 2) {
      return { drawdownTrend: 'stable', volatilityTrend: 'stable', performanceTrend: 'stable' }
    }

    const recent = history.slice(-3) // Last 3 days
    const older = history.slice(-7, -3) // Previous 4 days

    // Drawdown trend
    const recentDrawdown = recent.reduce((sum, d) => sum + d.drawdown, 0) / recent.length
    const olderDrawdown = older.reduce((sum, d) => sum + d.drawdown, 0) / older.length
    const drawdownTrend = recentDrawdown > olderDrawdown * 1.1 ? 'increasing' : 
                          recentDrawdown < olderDrawdown * 0.9 ? 'decreasing' : 'stable'

    // Volatility trend
    const recentVolatility = this.calculateVolatility(recent.map(d => d.dailyPnL))
    const olderVolatility = this.calculateVolatility(older.map(d => d.dailyPnL))
    const volatilityTrend = recentVolatility > olderVolatility * 1.1 ? 'increasing' :
                            recentVolatility < olderVolatility * 0.9 ? 'decreasing' : 'stable'

    // Performance trend
    const recentPnL = recent.reduce((sum, d) => sum + d.dailyPnL, 0)
    const olderPnL = older.reduce((sum, d) => sum + d.dailyPnL, 0)
    const performanceTrend = recentPnL > olderPnL * 1.1 ? 'improving' :
                             recentPnL < olderPnL * 0.9 ? 'declining' : 'stable'

    return { drawdownTrend, volatilityTrend, performanceTrend }
  }

  // Calculate volatility
  calculateVolatility(returns) {
    if (returns.length < 2) return 0

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length
    return Math.sqrt(variance)
  }

  // Generate portfolio recommendations
  generatePortfolioRecommendations(metrics, trends) {
    const recommendations = []

    // Drawdown recommendations
    if (metrics.currentDrawdown > 0.1) {
      recommendations.push({
        type: 'reduce_risk',
        priority: 'high',
        message: 'Portfolio drawdown is high. Consider reducing position sizes.',
        action: 'Review risk settings'
      })
    }

    // Concentration recommendations
    if (metrics.sectorConcentration > 0.4) {
      recommendations.push({
        type: 'diversify',
        priority: 'medium',
        message: `Sector concentration is ${(metrics.sectorConcentration * 100).toFixed(1)}%`,
        action: 'Add positions in different sectors'
      })
    }

    // Trend-based recommendations
    if (trends.drawdownTrend === 'increasing') {
      recommendations.push({
        type: 'monitor_closely',
        priority: 'medium',
        message: 'Drawdown is trending upward. Monitor closely.',
        action: 'Consider tightening risk limits'
      })
    }

    return recommendations
  }
}

export const portfolioRiskService = new PortfolioRiskService()
