// Risk Dashboard API for user-facing risk features
// Transforms internal risk data into user-friendly dashboard cards

import { riskManager } from './riskManagement.js'
import prisma from '../db/prisma.js'

export class RiskDashboard {
  // Get comprehensive risk dashboard for a portfolio
  async getRiskDashboard(portfolioId) {
    try {
      const [riskReport, portfolioState, todayStats, botStats] = await Promise.all([
        riskManager.getRiskReport(portfolioId),
        riskManager.getPortfolioState(portfolioId),
        this.getTodayRiskStats(portfolioId),
        this.getBotRiskStats(portfolioId)
      ])

      return {
        portfolioId,
        timestamp: new Date(),
        riskScore: riskReport.riskScore,
        riskLevel: riskReport.riskLevel,
        cards: {
          overallRisk: this.createOverallRiskCard(riskReport, portfolioState),
          concentrations: this.createConcentrationCard(portfolioState),
          performance: this.createPerformanceCard(portfolioState, todayStats),
          todayActivity: this.createTodayActivityCard(todayStats),
          botHealth: this.createBotHealthCard(botStats),
          protections: this.createProtectionsCard(riskReport)
        },
        recommendations: this.generateUserRecommendations(riskReport, portfolioState),
        alerts: this.generateRiskAlerts(riskReport, portfolioState)
      }
    } catch (error) {
      console.error('Failed to get risk dashboard:', error)
      throw error
    }
  }

  // Create overall risk assessment card
  createOverallRiskCard(riskReport, portfolioState) {
    const { riskScore, riskLevel } = riskReport
    const { totalValue, drawdown, dailyLoss } = portfolioState

    return {
      title: 'Overall Risk',
      score: riskScore,
      level: riskLevel,
      color: this.getRiskColor(riskLevel),
      metrics: {
        portfolioValue: `$${totalValue.toLocaleString()}`,
        currentDrawdown: `${(drawdown * 100).toFixed(1)}%`,
        dailyLoss: `$${dailyLoss.toFixed(2)}`,
        riskCapacity: `${Math.max(0, 100 - riskScore)}%`
      },
      status: this.getRiskStatus(riskLevel)
    }
  }

  // Create concentration analysis card
  createConcentrationCard(portfolioState) {
    const { positions, totalValue } = portfolioState
    
    // Calculate sector concentrations
    const sectorMap = this.getTickerSectorMap()
    const sectorExposure = new Map()
    
    positions.forEach(pos => {
      const sector = sectorMap[pos.ticker] || 'Other'
      const current = sectorExposure.get(sector) || 0
      sectorExposure.set(sector, current + pos.value)
    })

    // Calculate ticker concentrations
    const tickerConcentrations = positions
      .map(pos => ({
        ticker: pos.ticker,
        value: pos.value,
        percentage: ((pos.value / totalValue) * 100).toFixed(1)
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    // Convert sector exposure to percentages
    const sectorConcentrations = Array.from(sectorExposure.entries())
      .map(([sector, value]) => ({
        sector,
        value,
        percentage: ((value / totalValue) * 100).toFixed(1)
      }))
      .sort((a, b) => b.value - a.value)

    return {
      title: 'Concentrations',
      largestSector: sectorConcentrations[0] || { sector: 'None', percentage: '0' },
      largestPosition: tickerConcentrations[0] || { ticker: 'None', percentage: '0' },
      sectorBreakdown: sectorConcentrations,
      topPositions: tickerConcentrations,
      diversityScore: this.calculateDiversityScore(sectorConcentrations)
    }
  }

  // Create performance metrics card
  createPerformanceCard(portfolioState, todayStats) {
    const { totalValue, equityPeak } = portfolioState
    const currentDrawdown = equityPeak > 0 ? ((equityPeak - totalValue) / equityPeak) * 100 : 0

    return {
      title: 'Performance',
      currentEquity: `$${totalValue.toLocaleString()}`,
      peakEquity: `$${equityPeak.toLocaleString()}`,
      drawdownFromPeak: `${currentDrawdown.toFixed(1)}%`,
      todayPnL: todayStats.todayPnL,
      maxHistoricalDrawdown: todayStats.maxDrawdown,
      sharpeRatio: todayStats.sharpeRatio,
      volatility: todayStats.volatility
    }
  }

  // Create today's activity card
  createTodayActivityCard(todayStats) {
    return {
      title: 'Today\'s Activity',
      tradesBlocked: todayStats.blocksToday,
      tradesExecuted: todayStats.executionsToday,
      riskScoreChange: todayStats.riskScoreChange,
      largestBlock: todayStats.largestBlock,
      mostActiveRiskCheck: todayStats.mostActiveRiskCheck,
      timeInRisk: todayStats.timeInRisk
    }
  }

  // Create bot health card
  createBotHealthCard(botStats) {
    return {
      title: 'Bot Health',
      totalBots: botStats.totalBots,
      activeBots: botStats.activeBots,
      healthyBots: botStats.healthyBots,
      degradedBots: botStats.degradedBots,
      disabledBots: botStats.disabledBots,
      avgBotScore: botStats.avgBotScore,
      worstPerformer: botStats.worstPerformer
    }
  }

  // Create protections summary card
  createProtectionsCard(riskReport) {
    const activeProtections = []
    const failedChecks = riskReport.failedChecks || []

    failedChecks.forEach(check => {
      activeProtections.push({
        type: check.type,
        severity: check.severity,
        description: this.getProtectionDescription(check),
        current: check.current,
        limit: check.limit
      })
    })

    return {
      title: 'Active Protections',
      protectionsCount: activeProtections.length,
      activeProtections,
      lastTriggered: this.getLastProtectionTime(riskReport)
    }
  }

  // Get today's risk statistics
  async getTodayRiskStats(portfolioId) {
    const today = new Date(new Date().setHours(0, 0, 0, 0))
    
    try {
      const [blocks, executions, portfolioHistory] = await Promise.all([
        prisma.executionAudit.findMany({
          where: {
            portfolioId,
            eventType: 'risk_blocked',
            createdAt: { gte: today }
          }
        }),
        prisma.execution.findMany({
          where: {
            portfolioId,
            status: 'filled',
            filledAt: { gte: today }
          }
        }),
        prisma.dailySnapshot.findMany({
          where: {
            portfolioId,
            snapshotDate: { gte: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000) }
          },
          orderBy: { snapshotDate: 'asc' }
        })
      ])

      // Calculate risk check frequency
      const riskCheckCounts = blocks.reduce((acc, block) => {
        const detail = block.detail || ''
        const checkType = this.extractRiskCheckType(detail)
        acc[checkType] = (acc[checkType] || 0) + 1
        return acc
      }, {})

      const mostActiveRiskCheck = Object.entries(riskCheckCounts)
        .sort(([,a], [,b]) => b - a)[0]?.[0] || 'None'

      // Calculate historical drawdown
      let maxDrawdown = 0
      let peakEquity = portfolioHistory[0]?.equity || 0
      
      portfolioHistory.forEach(snapshot => {
        if (snapshot.equity > peakEquity) {
          peakEquity = snapshot.equity
        }
        const drawdown = ((peakEquity - snapshot.equity) / peakEquity) * 100
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown
        }
      })

      return {
        blocksToday: blocks.length,
        executionsToday: executions.length,
        todayPnL: executions.reduce((sum, exec) => sum + (exec.pnl || 0), 0),
        riskScoreChange: 0, // Would need historical risk scores
        largestBlock: Math.max(...blocks.map(b => b.metadata?.positionValue || 0), 0),
        mostActiveRiskCheck,
        timeInRisk: '0%', // Would need time tracking
        maxDrawdown: maxDrawdown.toFixed(1),
        sharpeRatio: 0, // Would need more calculation
        volatility: 0 // Would need more calculation
      }
    } catch (error) {
      console.error('Failed to get today risk stats:', error)
      return {
        blocksToday: 0,
        executionsToday: 0,
        todayPnL: 0,
        riskScoreChange: 0,
        largestBlock: 0,
        mostActiveRiskCheck: 'None',
        timeInRisk: '0%',
        maxDrawdown: 0,
        sharpeRatio: 0,
        volatility: 0
      }
    }
  }

  // Get bot risk statistics
  async getBotRiskStats(portfolioId) {
    try {
      const bots = await prisma.bot.findMany({
        where: { portfolioId },
        include: {
          executions: {
            where: { status: 'filled' },
            orderBy: { filledAt: 'desc' },
            take: 10
          }
        }
      })

      const botStats = bots.map(bot => {
        const recentPnL = bot.executions.reduce((sum, exec) => sum + (exec.pnl || 0), 0)
        const healthScore = this.calculateBotHealth(bot, recentPnL)
        
        return {
          id: bot.id,
          name: bot.name,
          enabled: bot.enabled,
          healthScore,
          recentPnL,
          status: this.getBotStatus(healthScore, bot.enabled)
        }
      })

      return {
        totalBots: bots.length,
        activeBots: bots.filter(b => b.enabled).length,
        healthyBots: botStats.filter(b => b.status === 'healthy').length,
        degradedBots: botStats.filter(b => b.status === 'degraded').length,
        disabledBots: botStats.filter(b => b.status === 'disabled').length,
        avgBotScore: botStats.reduce((sum, b) => sum + b.healthScore, 0) / botStats.length || 0,
        worstPerformer: botStats.sort((a, b) => a.healthScore - b.healthScore)[0] || null
      }
    } catch (error) {
      console.error('Failed to get bot risk stats:', error)
      return {
        totalBots: 0,
        activeBots: 0,
        healthyBots: 0,
        degradedBots: 0,
        disabledBots: 0,
        avgBotScore: 0,
        worstPerformer: null
      }
    }
  }

  // Generate user-friendly recommendations
  generateUserRecommendations(riskReport, portfolioState) {
    const recommendations = []
    const failedChecks = riskReport.failedChecks || []

    failedChecks.forEach(check => {
      switch (check.type) {
        case 'sector_concentration':
          recommendations.push({
            type: 'diversification',
            priority: 'medium',
            title: 'Consider Diversifying',
            message: `Your ${check.sector} exposure is ${check.percentage.toFixed(1)}%. Consider adding positions in other sectors.`,
            action: 'View Suggested Diversification'
          })
          break
        case 'daily_loss':
          recommendations.push({
            type: 'risk_reduction',
            priority: 'high',
            title: 'Daily Loss Limit Approaching',
            message: `You've lost $${check.current.toFixed(2)} today. Consider reducing position sizes.`,
            action: 'Adjust Risk Settings'
          })
          break
        case 'drawdown':
          recommendations.push({
            type: 'portfolio_health',
            priority: 'high',
            title: 'Portfolio Drawdown High',
            message: `Current drawdown is ${(check.current * 100).toFixed(1)}%. Consider pausing trading.`,
            action: 'Pause All Bots'
          })
          break
      }
    })

    return recommendations
  }

  // Generate risk alerts
  generateRiskAlerts(riskReport, portfolioState) {
    const alerts = []
    const { riskLevel } = riskReport
    const { drawdown, dailyLoss } = portfolioState

    if (riskLevel === 'critical') {
      alerts.push({
        level: 'critical',
        title: 'Critical Risk Level',
        message: 'Portfolio has reached critical risk levels. Immediate action recommended.',
        timestamp: new Date()
      })
    }

    if (drawdown > 0.15) {
      alerts.push({
        level: 'warning',
        title: 'High Drawdown',
        message: `Portfolio drawdown is ${(drawdown * 100).toFixed(1)}%`,
        timestamp: new Date()
      })
    }

    if (dailyLoss > 1000) {
      alerts.push({
        level: 'warning',
        title: 'High Daily Loss',
        message: `Today's loss is $${dailyLoss.toFixed(2)}`,
        timestamp: new Date()
      })
    }

    return alerts
  }

  // Helper methods
  getRiskColor(level) {
    const colors = {
      low: '#10B981',
      medium: '#F59E0B',
      high: '#EF4444',
      critical: '#DC2626'
    }
    return colors[level] || '#6B7280'
  }

  getRiskStatus(level) {
    const statuses = {
      low: 'Excellent',
      medium: 'Good',
      high: 'Caution',
      critical: 'Critical'
    }
    return statuses[level] || 'Unknown'
  }

  getTickerSectorMap() {
    return {
      'AAPL': 'Technology', 'MSFT': 'Technology', 'GOOGL': 'Technology', 'TSLA': 'Technology', 'NVDA': 'Technology', 'META': 'Technology',
      'JPM': 'Financial', 'BAC': 'Financial', 'WFC': 'Financial', 'GS': 'Financial', 'MS': 'Financial',
      'JNJ': 'Healthcare', 'PFE': 'Healthcare', 'UNH': 'Healthcare', 'ABT': 'Healthcare',
      'XOM': 'Energy', 'CVX': 'Energy', 'COP': 'Energy',
      'AMZN': 'Consumer', 'WMT': 'Consumer', 'HD': 'Consumer', 'MCD': 'Consumer',
      'SPY': 'ETF', 'QQQ': 'ETF', 'VTI': 'ETF', 'IWM': 'ETF'
    }
  }

  calculateDiversityScore(sectorConcentrations) {
    if (sectorConcentrations.length === 0) return 100
    
    // Herfindahl-Hirschman Index for diversity
    const total = sectorConcentrations.reduce((sum, s) => sum + parseFloat(s.percentage), 0)
    const hhi = sectorConcentrations.reduce((sum, s) => {
      const weight = parseFloat(s.percentage) / total
      return sum + (weight * weight)
    }, 0)
    
    // Convert to 0-100 scale (lower HHI = higher diversity)
    return Math.max(0, 100 - (hhi * 100))
  }

  getProtectionDescription(check) {
    const descriptions = {
      daily_loss: 'Daily loss limit protection',
      position_size: 'Position size limit',
      sector_concentration: 'Sector concentration limit',
      ticker_concentration: 'Single ticker concentration limit',
      drawdown: 'Maximum drawdown protection',
      leverage_ratio: 'Leverage limit',
      correlation: 'Correlation risk protection'
    }
    return descriptions[check.type] || 'Risk protection'
  }

  getLastProtectionTime(riskReport) {
    // Would need to track actual protection trigger times
    return new Date()
  }

  extractRiskCheckType(detail) {
    // Extract risk check type from audit detail
    if (detail.includes('daily_loss')) return 'Daily Loss'
    if (detail.includes('position_size')) return 'Position Size'
    if (detail.includes('drawdown')) return 'Drawdown'
    if (detail.includes('correlation')) return 'Correlation'
    return 'Other'
  }

  calculateBotHealth(bot, recentPnL) {
    let score = 100
    
    if (!bot.enabled) score -= 50
    if (recentPnL < -100) score -= 30
    if (recentPnL < -500) score -= 20
    
    return Math.max(0, score)
  }

  getBotStatus(healthScore, enabled) {
    if (!enabled) return 'disabled'
    if (healthScore >= 80) return 'healthy'
    if (healthScore >= 60) return 'degraded'
    return 'critical'
  }
}

export const riskDashboard = new RiskDashboard()
