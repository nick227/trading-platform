// Risk Management System for Trading Bots
// Refactored to use specialized services

import { riskManagerRefactored } from './riskManagerRefactored.js'
import { drawdownProtectionService } from './services/DrawdownProtectionService.js'
import { positionSizingService } from './services/PositionSizingService.js'
import { portfolioRiskService } from './services/PortfolioRiskService.js'
import { riskGateService } from './services/RiskGateService.js'
import { riskNotificationService } from './services/RiskNotificationService.js'
import { executionSlotService } from './services/ExecutionSlotService.js'
import { botControlService } from './services/BotControlService.js'

// Export the refactored risk manager as the main interface
export class RiskManager {
  constructor() {
    // Delegate to refactored orchestrator
    this.refactored = riskManagerRefactored
  }

  // Get risk settings for a portfolio (delegates to RiskGateService)
  async getRiskSettings(portfolioId) {
    return await this.refactored.getRiskSettings(portfolioId)
  }

  // Evaluate execution risk (delegates to RiskGateService)
  async evaluateExecutionRisk(executionRequest) {
    return await this.refactored.evaluateExecutionRisk(executionRequest)
  }

  // Get portfolio state (delegates to PortfolioRiskService)
  async getPortfolioState(portfolioId) {
    return await this.refactored.getPortfolioState(portfolioId)
  }

  // Dynamic position sizing (delegates to PositionSizingService)
  async getApprovedSize(signal, regime, portfolioId, maxQuantity) {
    return await this.refactored.getApprovedSize(signal, regime, portfolioId, maxQuantity)
  }

  // Drawdown protection (delegates to DrawdownProtectionService)
  async checkAndEnforceDrawdownProtection(portfolioId) {
    return await this.refactored.checkAndEnforceDrawdownProtection(portfolioId)
  }

  async checkBotRecovery(portfolioId) {
    return await this.refactored.checkBotRecovery(portfolioId)
  }

  // Bot lifecycle management (delegates to DrawdownProtectionService)
  async pauseBotManually(botId, reason) {
    return await this.refactored.pauseBotManually(botId, reason)
  }

  async resumeBotManually(botId) {
    return await this.refactored.resumeBotManually(botId)
  }

  async getBotStatusReport(portfolioId) {
    return await this.refactored.getBotStatusReport(portfolioId)
  }

  // Notification management (delegates to RiskNotificationService)
  async sendRiskNotification(portfolioId, level, notification) {
    return await this.refactored.sendRiskNotification(portfolioId, level, notification)
  }

  async getNotificationHistory(portfolioId, hours) {
    return await this.refactored.getNotificationHistory(portfolioId, hours)
  }

  // Portfolio risk metrics (delegates to PortfolioRiskService)
  async getPortfolioRiskMetrics(portfolioId) {
    return await this.refactored.getPortfolioRiskMetrics(portfolioId)
  }

  async getPortfolioRiskSummary(portfolioId) {
    return await this.refactored.getPortfolioRiskSummary(portfolioId)
  }

  // Risk report (combines multiple services)
  async getRiskReport(portfolioId) {
    return await this.refactored.getRiskReport(portfolioId)
  }

  // Risk dashboard (delegates to RiskDashboard)
  async getRiskDashboard(portfolioId) {
    return await this.refactored.getRiskDashboard(portfolioId)
  }

  // Regime-aware risk (delegates to RegimeAwareRisk)
  async getRegimeAdjustedRiskSettings(portfolioId, symbols) {
    return await this.refactored.getRegimeAdjustedRiskSettings(portfolioId, symbols)
  }

  // Capital allocation (delegates to CapitalAllocator)
  async getOptimalAllocation(portfolioId) {
    return await this.refactored.getOptimalAllocation(portfolioId)
  }

  // Bot leaderboard (delegates to BotLeaderboard)
  async getLeaderboard(portfolioId, timeframe) {
    return await this.refactored.getLeaderboard(portfolioId, timeframe)
  }

  async compareBots(portfolioId, botId1, botId2, timeframe) {
    return await this.refactored.compareBots(portfolioId, botId1, botId2, timeframe)
  }

  // Bot degradation detection (delegates to BotDegradationDetector)
  async startDegradationMonitoring() {
    return await this.refactored.startDegradationMonitoring()
  }

  async getDegradationReport(portfolioId) {
    return await this.refactored.getDegradationReport(portfolioId)
  }

  // Risk outcome analysis (delegates to RiskOutcomeAnalyzer)
  async analyzeRiskOutcomes(portfolioId, timeframe) {
    return await this.refactored.analyzeRiskOutcomes(portfolioId, timeframe)
  }

  async exportTrainingData(portfolioId, timeframe) {
    return await this.refactored.exportTrainingData(portfolioId, timeframe)
  }

  // Service health and management
  async getServiceHealth() {
    return await this.refactored.getServiceHealth()
  }

  clearAllCaches(portfolioId = null) {
    this.refactored.clearAllCaches(portfolioId)
  }

  // Execution slot management (delegates to ExecutionSlotService)
  async reserveExecutionSlot(portfolioId) {
    return await executionSlotService.reserveExecutionSlot(portfolioId)
  }

  async releaseExecutionSlot(portfolioId, reservationId) {
    return await executionSlotService.releaseExecutionSlot(portfolioId, reservationId)
  }

  async getSlotUsage(portfolioId) {
    return await executionSlotService.getSlotUsage(portfolioId)
  }

  // Bot control management (delegates to BotControlService)
  async pauseAllBots(portfolioId, reason, metadata = {}) {
    return await botControlService.pauseAllBots(portfolioId, reason, metadata)
  }

  async throttleBots(portfolioId, reason, metadata = {}) {
    return await botControlService.throttleBots(portfolioId, reason, metadata)
  }

  async restoreNormalTrading(portfolioId, metadata = {}) {
    return await botControlService.restoreNormalTrading(portfolioId, metadata)
  }

  async getBotStatusSummary(portfolioId) {
    return await botControlService.getBotStatusSummary(portfolioId)
  }

  async updateBotStatus(botId, status, reason = null) {
    return await botControlService.updateBotStatus(botId, status, reason)
  }

  // Get risk level from score
  getRiskLevel(score) {
    if (score >= 80) return 'low'
    if (score >= 60) return 'medium'
    if (score >= 40) return 'high'
    return 'critical'
  }
}

// Export singleton instance
export const riskManager = new RiskManager()

export default riskManager
