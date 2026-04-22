// Bot Degradation Detection and Auto-Throttle
// Monitors bot performance and automatically throttles or disables degraded bots

import prisma from '../db/prisma.js'
import { riskManager } from './riskManagement.js'
import { botLeaderboard } from './botLeaderboard.js'

export class BotDegradationDetector {
  constructor() {
    this.degradationCache = new Map()
    this.cacheTtl = 10 * 60 * 1000 // 10 minutes cache
    this.monitoringInterval = 5 * 60 * 1000 // Check every 5 minutes
  }

  // Start continuous monitoring for all bots
  async startMonitoring() {
    console.log('Starting bot degradation monitoring...')
    
    // Run initial check
    await this.checkAllBots()
    
    // Set up interval monitoring
    setInterval(async () => {
      await this.checkAllBots()
    }, this.monitoringInterval)
  }

  // Check all bots for degradation
  async checkAllBots() {
    try {
      // Get all active bots
      const bots = await prisma.bot.findMany({
        where: { enabled: true },
        include: {
          portfolio: {
            select: { id: true, userId: true }
          }
        }
      })

      // Check each bot
      const results = await Promise.all(
        bots.map(bot => this.checkBotDegradation(bot))
      )

      // Process results
      await this.processDegradationResults(results)
      
    } catch (error) {
      console.error('Failed to check all bots for degradation:', error)
    }
  }

  // Check individual bot for degradation
  async checkBotDegradation(bot) {
    try {
      const cacheKey = `degradation:${bot.id}`
      const cached = this.degradationCache.get(cacheKey)
      
      if (cached && (Date.now() - cached.timestamp < this.cacheTtl)) {
        return cached.result
      }

      // Get recent performance data
      const metrics = await this.getBotPerformanceMetrics(bot.id)
      
      // Analyze for degradation patterns
      const degradation = this.analyzeDegradationPatterns(metrics)
      
      // Determine action needed
      const action = this.determineDegradationAction(degradation, bot)
      
      const result = {
        botId: bot.id,
        botName: bot.name,
        portfolioId: bot.portfolioId,
        metrics,
        degradation,
        action,
        timestamp: new Date()
      }

      // Cache result
      this.degradationCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      })

      return result
    } catch (error) {
      console.error(`Failed to check degradation for bot ${bot.id}:`, error)
      return {
        botId: bot.id,
        error: error.message,
        action: { type: 'none', reason: 'error' }
      }
    }
  }

  // Get comprehensive performance metrics for a bot
  async getBotPerformanceMetrics(botId) {
    try {
      // Get recent executions
      const recentExecutions = await prisma.execution.findMany({
        where: {
          botId,
          status: 'filled',
          filledAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
        },
        orderBy: { filledAt: 'desc' },
        take: 50
      })

      // Calculate performance metrics
      const totalPnL = recentExecutions.reduce((sum, exec) => sum + (exec.pnl || 0), 0)
      const winningTrades = recentExecutions.filter(exec => (exec.pnl || 0) > 0)
      const losingTrades = recentExecutions.filter(exec => (exec.pnl || 0) < 0)
      const winRate = recentExecutions.length > 0 ? winningTrades.length / recentExecutions.length : 0
      
      // Recent performance (last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const recentExecutions24h = recentExecutions.filter(exec => exec.filledAt >= oneDayAgo)
      const recentPnL24h = recentExecutions24h.reduce((sum, exec) => sum + (exec.pnl || 0), 0)
      
      // Streak analysis
      const streak = this.calculateCurrentStreak(recentExecutions)
      
      // Volatility and consistency
      const dailyReturns = this.calculateDailyReturns(recentExecutions)
      const volatility = this.calculateVolatility(dailyReturns)
      const consistency = this.calculateConsistency(dailyReturns)
      
      // Error rate
      const errorRate = await this.calculateErrorRate(botId)
      
      // Slippage analysis
      const avgSlippage = this.calculateAverageSlippage(recentExecutions)
      
      // Activity level
      const avgTradesPerDay = recentExecutions.length / 7
      const lastTradeTime = recentExecutions.length > 0 ? recentExecutions[0].filledAt : null
      
      return {
        totalTrades: recentExecutions.length,
        totalPnL,
        winRate,
        recentPnL24h,
        streak,
        volatility,
        consistency,
        errorRate,
        avgSlippage,
        avgTradesPerDay,
        lastTradeTime,
        maxDrawdown: this.calculateMaxDrawdown(dailyReturns),
        sharpeRatio: this.calculateSharpeRatio(dailyReturns)
      }
    } catch (error) {
      console.error('Failed to get bot performance metrics:', error)
      throw error
    }
  }

  // Analyze degradation patterns
  analyzeDegradationPatterns(metrics) {
    const patterns = {
      consecutiveLosses: false,
      lowWinRate: false,
      highVolatility: false,
      lowConsistency: false,
      highErrorRate: false,
      highSlippage: false,
      inactivity: false,
      poorRiskReward: false,
      drawdownBreach: false
    }

    // Check consecutive losses
    if (metrics.streak.current < -6) {
      patterns.consecutiveLosses = true
    }

    // Check win rate
    if (metrics.winRate < 0.3 && metrics.totalTrades > 10) {
      patterns.lowWinRate = true
    }

    // Check volatility
    if (metrics.volatility > 0.5) {
      patterns.highVolatility = true
    }

    // Check consistency
    if (metrics.consistency < 0.4 && metrics.totalTrades > 10) {
      patterns.lowConsistency = true
    }

    // Check error rate
    if (metrics.errorRate > 0.1) { // >10% error rate
      patterns.highErrorRate = true
    }

    // Check slippage
    if (metrics.avgSlippage > 0.5) { // >0.5% average slippage
      patterns.highSlippage = true
    }

    // Check inactivity
    const hoursSinceLastTrade = metrics.lastTradeTime 
      ? (Date.now() - metrics.lastTradeTime.getTime()) / (1000 * 60 * 60)
      : Infinity
    
    if (hoursSinceLastTrade > 24 && metrics.avgTradesPerDay > 1) {
      patterns.inactivity = true
    }

    // Check risk/reward (simplified)
    const avgWin = metrics.totalTrades > 0 ? metrics.totalPnL / (metrics.winRate * metrics.totalTrades) : 0
    const avgLoss = metrics.totalTrades > 0 ? Math.abs(metrics.totalPnL / ((1 - metrics.winRate) * metrics.totalTrades)) : 0
    const riskRewardRatio = avgLoss > 0 ? avgWin / avgLoss : 0
    
    if (riskRewardRatio < 0.5 && metrics.totalTrades > 10) {
      patterns.poorRiskReward = true
    }

    // Check drawdown
    if (metrics.maxDrawdown > 0.2) {
      patterns.drawdownBreach = true
    }

    // Calculate severity score
    const severity = this.calculateDegradationSeverity(patterns, metrics)

    return {
      patterns,
      severity,
      count: Object.values(patterns).filter(Boolean).length
    }
  }

  // Calculate degradation severity
  calculateDegradationSeverity(patterns, metrics) {
    let severity = 0
    
    // Weight different patterns
    if (patterns.consecutiveLosses) severity += 25
    if (patterns.lowWinRate) severity += 20
    if (patterns.highVolatility) severity += 15
    if (patterns.lowConsistency) severity += 15
    if (patterns.highErrorRate) severity += 30
    if (patterns.highSlippage) severity += 10
    if (patterns.inactivity) severity += 20
    if (patterns.poorRiskReward) severity += 15
    if (patterns.drawdownBreach) severity += 25
    
    // Adjust based on recent performance
    if (metrics.recentPnL24h < -500) severity += 20
    if (metrics.recentPnL24h < -1000) severity += 30
    
    return Math.min(100, severity)
  }

  // Determine action based on degradation
  determineDegradationAction(degradation, bot) {
    const { patterns, severity } = degradation
    
    if (severity >= 80) {
      return {
        type: 'disable',
        reason: 'severe_degradation',
        severity,
        patterns: Object.keys(patterns).filter(key => patterns[key]),
        message: `Bot disabled due to severe degradation (Score: ${severity})`
      }
    }
    
    if (severity >= 60) {
      return {
        type: 'throttle',
        reason: 'moderate_degradation',
        severity,
        patterns: Object.keys(patterns).filter(key => patterns[key]),
        throttleLevel: 0.5, // Reduce activity by 50%
        message: `Bot throttled due to moderate degradation (Score: ${severity})`
      }
    }
    
    if (severity >= 40) {
      return {
        type: 'warn',
        reason: 'mild_degradation',
        severity,
        patterns: Object.keys(patterns).filter(key => patterns[key]),
        message: `Bot showing signs of degradation (Score: ${severity})`
      }
    }
    
    return {
      type: 'none',
      reason: 'healthy',
      severity,
      message: 'Bot performing normally'
    }
  }

  // Process degradation results and take actions
  async processDegradationResults(results) {
    for (const result of results) {
      if (result.error) continue
      
      await this.executeDegradationAction(result)
    }
  }

  // Execute degradation action
  async executeDegradationAction(result) {
    const { botId, action, degradation } = result
    
    try {
      switch (action.type) {
        case 'disable':
          await this.disableBot(botId, action)
          break
        case 'throttle':
          await this.throttleBot(botId, action)
          break
        case 'warn':
          await this.warnBot(botId, action)
          break
        case 'none':
          // No action needed
          break
      }
    } catch (error) {
      console.error(`Failed to execute action ${action.type} for bot ${botId}:`, error)
    }
  }

  // Disable bot
  async disableBot(botId, action) {
    try {
      await prisma.bot.update({
        where: { id: botId },
        data: { 
          enabled: false,
          updatedAt: new Date()
        }
      })

      await this.logDegradationEvent(botId, 'bot_disabled', action)
      
      console.log(`Bot ${botId} disabled due to: ${action.reason}`)
    } catch (error) {
      console.error('Failed to disable bot:', error)
    }
  }

  // Throttle bot
  async throttleBot(botId, action) {
    try {
      // Update bot configuration to reduce activity
      const bot = await prisma.bot.findUnique({
        where: { id: botId },
        include: { portfolio: { select: { userId: true } } }
      })

      if (bot && bot.portfolio) {
        // Update user risk settings to be more conservative for this bot
        const currentSettings = await prisma.user.findUnique({
          where: { id: bot.portfolio.userId },
          select: { riskSettings: true }
        })

        const throttledSettings = {
          ...currentSettings.riskSettings,
          maxPositionSize: (currentSettings.riskSettings?.maxPositionSize || 0.1) * action.throttleLevel,
          maxConcurrentTrades: Math.max(1, Math.floor((currentSettings.riskSettings?.maxConcurrentTrades || 5) * action.throttleLevel))
        }

        await prisma.user.update({
          where: { id: bot.portfolio.userId },
          data: { riskSettings: throttledSettings }
        })

        await this.logDegradationEvent(botId, 'bot_throttled', action)
        
        console.log(`Bot ${botId} throttled to ${action.throttleLevel * 100}% due to: ${action.reason}`)
      }
    } catch (error) {
      console.error('Failed to throttle bot:', error)
    }
  }

  // Warn about bot degradation
  async warnBot(botId, action) {
    try {
      await this.logDegradationEvent(botId, 'bot_degradation_warning', action)
      
      console.log(`Bot ${botId} warning: ${action.message}`)
    } catch (error) {
      console.error('Failed to warn about bot degradation:', error)
    }
  }

  // Log degradation event
  async logDegradationEvent(botId, eventType, action) {
    try {
      await prisma.botEvent.create({
        data: {
          botId,
          type: eventType,
          detail: `Degradation detection: ${action.reason}`,
          metadata: {
            severity: action.severity,
            patterns: action.patterns,
            message: action.message,
            timestamp: new Date()
          }
        }
      })
    } catch (error) {
      console.error('Failed to log degradation event:', error)
    }
  }

  // Check for recovery and restore normal operation
  async checkBotRecovery(botId) {
    try {
      const bot = await prisma.bot.findUnique({
        where: { id: botId },
        include: { portfolio: { select: { userId: true } } }
      })

      if (!bot || bot.enabled) return false // Already enabled

      // Check recent performance
      const metrics = await this.getBotPerformanceMetrics(botId)
      const degradation = this.analyzeDegradationPatterns(metrics)

      // Recovery condition: severity < 30 and no critical patterns
      if (degradation.severity < 30 && !degradation.patterns.consecutiveLosses && !degradation.patterns.highErrorRate) {
        await this.restoreBot(botId)
        return true
      }

      return false
    } catch (error) {
      console.error('Failed to check bot recovery:', error)
      return false
    }
  }

  // Restore bot to normal operation
  async restoreBot(botId) {
    try {
      await prisma.bot.update({
        where: { id: botId },
        data: { 
          enabled: true,
          updatedAt: new Date()
        }
      })

      await this.logDegradationEvent(botId, 'bot_restored', {
        type: 'recovery',
        reason: 'performance_improved',
        message: 'Bot restored to normal operation'
      })

      console.log(`Bot ${botId} restored to normal operation`)
    } catch (error) {
      console.error('Failed to restore bot:', error)
    }
  }

  // Get degradation report for a portfolio
  async getDegradationReport(portfolioId) {
    try {
      const bots = await prisma.bot.findMany({
        where: { portfolioId },
        include: {
          events: {
            where: {
              type: { in: ['bot_disabled', 'bot_throttled', 'bot_degradation_warning', 'bot_restored'] },
              orderBy: { createdAt: 'desc' },
              take: 10
            }
          }
        }
      })

      const report = {
        portfolioId,
        timestamp: new Date(),
        totalBots: bots.length,
        activeBots: bots.filter(b => b.enabled).length,
        disabledBots: bots.filter(b => !b.enabled).length,
        botStatuses: [],
        recentEvents: [],
        summary: {
          healthy: 0,
          throttled: 0,
          disabled: 0,
          warnings: 0
        }
      }

      for (const bot of bots) {
        const degradation = await this.checkBotDegradation(bot)
        
        let status = 'healthy'
        if (bot.enabled) {
          if (degradation.action.type === 'throttle') status = 'throttled'
          else if (degradation.action.type === 'warn') status = 'warning'
        } else {
          status = 'disabled'
        }

        report.botStatuses.push({
          botId: bot.id,
          botName: bot.name,
          status,
          severity: degradation.degradation.severity,
          patterns: degradation.degradation.patterns,
          lastEvent: bot.events[0] || null
        })

        report.summary[status]++
      }

      // Get recent events across all bots
      const allEvents = bots.flatMap(bot => bot.events)
      report.recentEvents = allEvents
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20)

      return report
    } catch (error) {
      console.error('Failed to get degradation report:', error)
      throw error
    }
  }

  // Helper methods
  calculateCurrentStreak(executions) {
    let currentStreak = 0
    
    for (let i = executions.length - 1; i >= 0; i--) {
      const pnl = executions[i].pnl || 0
      if (pnl < 0) {
        currentStreak--
      } else if (pnl > 0) {
        break
      }
    }
    
    return currentStreak
  }

  calculateDailyReturns(executions) {
    const dailyPnL = new Map()
    
    executions.forEach(exec => {
      const day = exec.filledAt.toISOString().split('T')[0]
      const current = dailyPnL.get(day) || 0
      dailyPnL.set(day, current + (exec.pnl || 0))
    })
    
    const days = Array.from(dailyPnL.keys()).sort()
    const returns = []
    
    for (let i = 1; i < days.length; i++) {
      const prevDay = dailyPnL.get(days[i - 1]) || 0
      const currDay = dailyPnL.get(days[i]) || 0
      
      if (prevDay !== 0) {
        returns.push(currDay / prevDay)
      }
    }
    
    return returns
  }

  calculateVolatility(returns) {
    if (returns.length < 2) return 0
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length
    return Math.sqrt(variance)
  }

  calculateConsistency(returns) {
    if (returns.length < 2) return 0
    
    const positiveReturns = returns.filter(r => r > 0).length
    return positiveReturns / returns.length
  }

  calculateMaxDrawdown(returns) {
    if (returns.length === 0) return 0
    
    let peak = 0
    let maxDrawdown = 0
    let cumulative = 0
    
    returns.forEach(ret => {
      cumulative += ret
      peak = Math.max(peak, cumulative)
      const drawdown = (peak - cumulative) / peak
      maxDrawdown = Math.max(maxDrawdown, drawdown)
    })
    
    return maxDrawdown
  }

  calculateSharpeRatio(returns) {
    if (returns.length < 2) return 0
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
    const volatility = this.calculateVolatility(returns)
    
    return volatility > 0 ? mean / volatility : 0
  }

  async calculateErrorRate(botId) {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      
      const [totalEvents, errorEvents] = await Promise.all([
        prisma.botEvent.count({
          where: {
            botId,
            createdAt: { gte: oneDayAgo }
          }
        }),
        prisma.botEvent.count({
          where: {
            botId,
            type: 'error_occurred',
            createdAt: { gte: oneDayAgo }
          }
        })
      ])
      
      return totalEvents > 0 ? errorEvents / totalEvents : 0
    } catch (error) {
      console.error('Failed to calculate error rate:', error)
      return 0
    }
  }

  calculateAverageSlippage(executions) {
    if (executions.length === 0) return 0
    
    const slippageValues = executions.map(exec => {
      if (!exec.price || !exec.filledPrice) return 0
      
      const expectedPrice = exec.price
      const actualPrice = exec.filledPrice
      const slippage = Math.abs((actualPrice - expectedPrice) / expectedPrice)
      
      return slippage * 100 // Convert to percentage
    }).filter(s => s > 0)
    
    return slippageValues.length > 0 
      ? slippageValues.reduce((sum, s) => sum + s, 0) / slippageValues.length 
      : 0
  }
}

export const botDegradationDetector = new BotDegradationDetector()
