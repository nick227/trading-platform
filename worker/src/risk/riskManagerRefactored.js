// Refactored RiskManager - Service Orchestrator
// Coordinates between specialized risk services

import { riskGateService } from './services/RiskGateService.js'
import { positionSizingService } from './services/PositionSizingService.js'
import { drawdownProtectionService } from './services/DrawdownProtectionService.js'
import { portfolioRiskService } from './services/PortfolioRiskService.js'
import { riskNotificationService } from './services/RiskNotificationService.js'
import { regimeAwareRisk } from './regimeAwareRisk.js'
import { capitalAllocator } from './capitalAllocator.js'
import { botLeaderboard } from './botLeaderboard.js'
import { botDegradationDetector } from './botDegradationDetector.js'
import { riskOutcomeAnalyzer } from './riskOutcomeAnalyzer.js'
import { riskDashboard } from './riskDashboard.js'

export class RiskManagerRefactored {
  constructor() {
    this.services = {
      gate: riskGateService,
      sizing: positionSizingService,
      drawdown: drawdownProtectionService,
      portfolio: portfolioRiskService,
      notifications: riskNotificationService
    }
  }

  // Main execution risk evaluation (delegates to RiskGateService)
  async evaluateExecutionRisk(executionRequest) {
    return await this.services.gate.evaluateExecutionRisk(executionRequest)
  }

  // Dynamic position sizing (delegates to PositionSizingService)
  async getApprovedSize(signal, regime, portfolioId, maxQuantity) {
    return await this.services.sizing.getApprovedSize(signal, regime, portfolioId, maxQuantity)
  }

  // Portfolio state management (delegates to PortfolioRiskService)
  async getPortfolioState(portfolioId) {
    return await this.services.portfolio.getPortfolioState(portfolioId)
  }

  // Risk settings management (delegates to RiskGateService)
  async getRiskSettings(portfolioId) {
    return await this.services.gate.getRiskSettings(portfolioId)
  }

  // Drawdown protection (delegates to DrawdownProtectionService)
  async checkAndEnforceDrawdownProtection(portfolioId) {
    return await this.services.drawdown.checkAndEnforceDrawdownProtection(portfolioId)
  }

  async checkBotRecovery(portfolioId) {
    return await this.services.drawdown.checkBotRecovery(portfolioId)
  }

  // Bot lifecycle management (delegates to DrawdownProtectionService)
  async pauseBotManually(botId, reason) {
    return await this.services.drawdown.pauseBotManually(botId, reason)
  }

  async resumeBotManually(botId) {
    return await this.services.drawdown.resumeBotManually(botId)
  }

  async getBotStatusReport(portfolioId) {
    return await this.services.drawdown.getBotStatusReport(portfolioId)
  }

  // Notification management (delegates to RiskNotificationService)
  async sendRiskNotification(portfolioId, level, notification) {
    return await this.services.notifications.sendNotification(portfolioId, level, notification)
  }

  async getNotificationHistory(portfolioId, hours) {
    return await this.services.notifications.getNotificationHistory(portfolioId, hours)
  }

  async updateNotificationPreferences(portfolioId, preferences) {
    return await this.services.notifications.updateNotificationPreferences(portfolioId, preferences)
  }

  // Portfolio risk metrics (delegates to PortfolioRiskService)
  async getPortfolioRiskMetrics(portfolioId) {
    return await this.services.portfolio.getPortfolioRiskMetrics(portfolioId)
  }

  async getPortfolioRiskSummary(portfolioId) {
    return await this.services.portfolio.getPortfolioRiskSummary(portfolioId)
  }

  // Sizing recommendations (delegates to PositionSizingService)
  async getSizingRecommendations(portfolioId) {
    return await this.services.sizing.getSizingRecommendations(portfolioId)
  }

  async getSizingStatistics(portfolioId, days) {
    return await this.services.sizing.getSizingStatistics(portfolioId, days)
  }

  // Risk report (combines multiple services)
  async getRiskReport(portfolioId) {
    try {
      const [portfolioState, riskSettings, riskMetrics] = await Promise.all([
        this.services.portfolio.getPortfolioState(portfolioId),
        this.services.gate.getRiskSettings(portfolioId),
        this.services.portfolio.getPortfolioRiskMetrics(portfolioId)
      ])

      // Run core risk checks (lightweight)
      const riskChecks = await Promise.all([
        this.services.gate.checkDailyLoss(portfolioState, riskSettings),
        this.services.gate.checkPositionSize(0, portfolioState, riskSettings),
        this.services.gate.checkAccountBalance(portfolioState, riskSettings),
        this.services.gate.checkLeverageRatio(0, portfolioState, riskSettings),
        this.services.gate.checkDrawdown(portfolioState, riskSettings),
        this.services.gate.checkConcurrentTrades(portfolioId, riskSettings)
      ])

      return {
        portfolioId,
        timestamp: new Date(),
        riskScore: this.calculateRiskScore(riskChecks),
        riskLevel: this.getRiskLevel(this.calculateRiskScore(riskChecks)),
        checks: riskChecks,
        settings: riskSettings,
        state: portfolioState,
        metrics: riskMetrics.metrics
      }
    } catch (error) {
      console.error('Failed to get risk report:', error)
      throw error
    }
  }

  // Comprehensive risk dashboard (delegates to RiskDashboard)
  async getRiskDashboard(portfolioId) {
    return await riskDashboard.getRiskDashboard(portfolioId)
  }

  // Regime-aware risk (delegates to RegimeAwareRisk)
  async getRegimeAdjustedRiskSettings(portfolioId, symbols) {
    return await regimeAwareRisk.getRegimeAdjustedRiskSettings(portfolioId, symbols)
  }

  // Capital allocation (delegates to CapitalAllocator)
  async getOptimalAllocation(portfolioId) {
    return await capitalAllocator.getOptimalAllocation(portfolioId)
  }

  // Bot leaderboard (delegates to BotLeaderboard)
  async getLeaderboard(portfolioId, timeframe) {
    return await botLeaderboard.getLeaderboard(portfolioId, timeframe)
  }

  async compareBots(portfolioId, botId1, botId2, timeframe) {
    return await botLeaderboard.compareBots(portfolioId, botId1, botId2, timeframe)
  }

  // Bot degradation detection (delegates to BotDegradationDetector)
  async startDegradationMonitoring() {
    return await botDegradationDetector.startMonitoring()
  }

  async getDegradationReport(portfolioId) {
    return await botDegradationDetector.getDegradationReport(portfolioId)
  }

  // Risk outcome analysis (delegates to RiskOutcomeAnalyzer)
  async analyzeRiskOutcomes(portfolioId, timeframe) {
    return await riskOutcomeAnalyzer.analyzeRiskOutcomes(portfolioId, timeframe)
  }

  async exportTrainingData(portfolioId, timeframe) {
    return await riskOutcomeAnalyzer.exportTrainingData(portfolioId, timeframe)
  }

  // Service health checks
  async getServiceHealth() {
    const health = {
      timestamp: new Date(),
      services: {},
      overall: 'healthy'
    }

    try {
      // Test each service
      health.services.gate = await this.testService('gate', this.services.gate)
      health.services.sizing = await this.testService('sizing', this.services.sizing)
      health.services.drawdown = await this.testService('drawdown', this.services.drawdown)
      health.services.portfolio = await this.testService('portfolio', this.services.portfolio)
      health.services.notifications = await this.testService('notifications', this.services.notifications)

      // Determine overall health
      const serviceStatuses = Object.values(health.services)
      const unhealthyServices = serviceStatuses.filter(status => status !== 'healthy')
      
      if (unhealthyServices.length > 0) {
        health.overall = 'degraded'
        health.issues = unhealthyServices
      }

    } catch (error) {
      health.overall = 'error'
      health.error = error.message
    }

    return health
  }

  // Test individual service
  async testService(serviceName, service) {
    try {
      // Simple health check based on service type
      switch (serviceName) {
        case 'gate':
          await service.getDefaultRiskSettings()
          return 'healthy'
        case 'sizing':
          service.clearCache()
          return 'healthy'
        case 'drawdown':
          service.clearCache()
          return 'healthy'
        case 'portfolio':
          service.clearCache()
          return 'healthy'
        case 'notifications':
          await service.getNotificationPreferences('test')
          return 'healthy'
        default:
          return 'unknown'
      }
    } catch (error) {
      console.error(`Service ${serviceName} health check failed:`, error)
      return 'unhealthy'
    }
  }

  // Cache management across all services
  clearAllCaches(portfolioId = null) {
    this.services.gate.clearCache?.(portfolioId)
    this.services.sizing.clearCache?.(portfolioId)
    this.services.drawdown.clearCache?.(portfolioId)
    this.services.portfolio.clearCache?.(portfolioId)
    this.services.notifications.clearCache?.(portfolioId)
  }

  // Configuration management
  async updateServiceConfig(serviceName, config) {
    try {
      // Update configuration for specific service
      switch (serviceName) {
        case 'notifications':
          await this.services.notifications.updateNotificationPreferences(config.portfolioId, config.preferences)
          break
        // Add other service configurations as needed
        default:
          console.warn(`Unknown service: ${serviceName}`)
      }
      return { success: true }
    } catch (error) {
      console.error(`Failed to update ${serviceName} config:`, error)
      return { success: false, error: error.message }
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

  getRiskLevel(score) {
    if (score >= 80) return 'low'
    if (score >= 60) return 'medium'
    if (score >= 40) return 'high'
    return 'critical'
  }

  // Service statistics
  async getServiceStatistics() {
    return {
      timestamp: new Date(),
      services: {
        gate: {
          cacheSize: 0, // Would need to expose from service
          lastActivity: new Date()
        },
        sizing: {
          cacheSize: 0,
          lastActivity: new Date()
        },
        drawdown: {
          cacheSize: 0,
          lastActivity: new Date()
        },
        portfolio: {
          cacheSize: 0,
          lastActivity: new Date()
        },
        notifications: {
          cacheSize: this.services.notifications.notificationCache?.size || 0,
          lastActivity: new Date()
        }
      }
    }
  }

  // Migration helper for migrating from old RiskManager
  async migrateFromOldRiskManager(portfolioId) {
    try {
      console.log(`Starting migration for portfolio ${portfolioId}...`)
      
      // Test all services
      const health = await this.getServiceHealth()
      if (health.overall !== 'healthy') {
        console.warn('Some services are unhealthy:', health.issues)
      }

      // Clear caches to ensure fresh start
      this.clearAllCaches(portfolioId)

      // Get initial state
      const portfolioState = await this.getPortfolioState(portfolioId)
      const riskSettings = await this.getRiskSettings(portfolioId)

      console.log(`Migration complete for portfolio ${portfolioId}`)
      console.log(`Portfolio value: $${portfolioState.totalValue}`)
      console.log(`Active bots: ${portfolioState.openPositions}`)

      return {
        success: true,
        portfolioState,
        riskSettings,
        serviceHealth: health
      }
    } catch (error) {
      console.error('Migration failed:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }
}

// Export the refactored risk manager as default
export const riskManagerRefactored = new RiskManagerRefactored()
export default riskManagerRefactored

// Also export individual services for direct access if needed
export {
  riskGateService,
  positionSizingService,
  drawdownProtectionService,
  portfolioRiskService,
  riskNotificationService
}
