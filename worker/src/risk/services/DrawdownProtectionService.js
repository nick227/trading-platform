// Drawdown Protection Service
// Handles drawdown monitoring and bot lifecycle management with explicit status codes

import prisma from '../../db/prisma.js'
import { riskGateService } from './RiskGateService.js'

export class DrawdownProtectionService {
  constructor() {
    this.protectionCache = new Map()
    this.cacheTtl = 2 * 60 * 1000 // 2 minutes cache
  }

  // Bot status enum
  static BOT_STATUS = {
    ACTIVE: 'active',
    PAUSED_USER: 'paused_user',
    PAUSED_RISK: 'paused_risk',
    PAUSED_ADMIN: 'paused_admin',
    COOLDOWN: 'cooldown',
    RECOVERING: 'recovering'
  }

  // Check and enforce drawdown protection
  async checkAndEnforceDrawdownProtection(portfolioId) {
    try {
      const cacheKey = `drawdown:${portfolioId}`
      const cached = this.protectionCache.get(cacheKey)
      
      if (cached && (Date.now() - cached.timestamp < this.cacheTtl)) {
        return cached.result
      }

      const portfolioState = await riskGateService.getPortfolioState(portfolioId)
      const riskSettings = await riskGateService.getRiskSettings(portfolioId)
      const currentDrawdown = portfolioState.drawdown || 0
      const maxDrawdown = riskSettings.maxDrawdown

      let action = { type: 'none', reason: 'healthy' }

      // Check critical threshold
      if (currentDrawdown > maxDrawdown) {
        action = await this.pauseAllBots(portfolioId, 'drawdown_breach', {
          currentDrawdown: currentDrawdown * 100,
          maxDrawdown: maxDrawdown * 100,
          portfolioValue: portfolioState.totalValue,
          severity: 'critical'
        })
      }
      // Check warning threshold
      else if (currentDrawdown > maxDrawdown * 0.8) {
        action = await this.throttleBots(portfolioId, 'drawdown_warning', {
          currentDrawdown: currentDrawdown * 100,
          maxDrawdown: maxDrawdown * 100,
          warningThreshold: (maxDrawdown * 0.8) * 100,
          severity: 'warning'
        })
      }

      const result = {
        portfolioId,
        currentDrawdown,
        maxDrawdown,
        action,
        timestamp: new Date()
      }

      // Cache result
      this.protectionCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      })

      return result
    } catch (error) {
      console.error('Failed to check drawdown protection:', error)
      return {
        portfolioId,
        action: { type: 'error', reason: error.message },
        timestamp: new Date()
      }
    }
  }

  // Check for bot recovery conditions
  async checkBotRecovery(portfolioId) {
    try {
      const portfolioState = await riskGateService.getPortfolioState(portfolioId)
      const riskSettings = await riskGateService.getRiskSettings(portfolioId)
      const currentDrawdown = portfolioState.drawdown || 0
      const maxDrawdown = riskSettings.maxDrawdown

      // Recovery condition: drawdown back below 70% of max
      const recoveryThreshold = maxDrawdown * 0.7
      
      if (currentDrawdown < recoveryThreshold) {
        return await this.restoreRiskPausedBots(portfolioId, {
          currentDrawdown: currentDrawdown * 100,
          recoveryThreshold: recoveryThreshold * 100,
          portfolioValue: portfolioState.totalValue
        })
      }

      return { recovered: false, reason: 'drawdown_still_high' }
    } catch (error) {
      console.error('Failed to check bot recovery:', error)
      return { recovered: false, reason: error.message }
    }
  }

  // Pause all bots with explicit status
  async pauseAllBots(portfolioId, reason, metadata = {}) {
    try {
      // Get all active bots
      const bots = await prisma.bot.findMany({
        where: {
          portfolioId,
          status: DrawdownProtectionService.BOT_STATUS.ACTIVE
        }
      })

      if (bots.length === 0) {
        return {
          type: 'pause_bots',
          success: false,
          reason: 'no_active_bots',
          botsAffected: 0
        }
      }

      // Update bot status with explicit reason
      const pausePromises = bots.map(bot =>
        prisma.bot.update({
          where: { id: bot.id },
          data: {
            status: DrawdownProtectionService.BOT_STATUS.PAUSED_RISK,
            statusReason: reason,
            statusChangedAt: new Date(),
            metadata: {
              ...bot.metadata,
              lastRiskPause: {
                reason,
                timestamp: new Date(),
                metadata
              }
            }
          }
        })
      )

      await Promise.all(pausePromises)

      // Log pause event
      await this.logRiskEvent(portfolioId, 'bots_paused_risk', {
        reason,
        botsCount: bots.length,
        botIds: bots.map(b => b.id),
        metadata,
        timestamp: new Date()
      })

      // Send notification
      await this.sendRiskNotification(portfolioId, 'critical', {
        title: 'Trading Paused - Drawdown Breach',
        message: `All bots have been paused due to drawdown exceeding limits.`,
        metadata: {
          botsAffected: bots.length,
          reason,
          severity: metadata.severity
        }
      })

      return {
        type: 'pause_bots',
        success: true,
        reason,
        botsAffected: bots.length,
        botIds: bots.map(b => b.id)
      }
    } catch (error) {
      console.error('Failed to pause bots:', error)
      return {
        type: 'pause_bots',
        success: false,
        reason: error.message
      }
    }
  }

  // Throttle bots with overlay state (not rewriting user settings)
  async throttleBots(portfolioId, reason, metadata = {}) {
    try {
      // Create risk overlay instead of rewriting user settings
      const riskOverlay = {
        enabled: true,
        reason,
        settings: {
          maxPositionSize: 0.05, // Conservative sizing
          maxRiskPerTrade: 0.01,
          maxConcurrentTrades: 2,
          stopLossPercentage: 0.03
        },
        appliedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hour expiry
      }

      // Store overlay in database
      await prisma.portfolio.update({
        where: { id: portfolioId },
        data: {
          riskOverlay
        }
      })

      // Update bot status to indicate throttling
      const bots = await prisma.bot.findMany({
        where: {
          portfolioId,
          status: DrawdownProtectionService.BOT_STATUS.ACTIVE
        }
      })

      if (bots.length > 0) {
        const throttlePromises = bots.map(bot =>
          prisma.bot.update({
            where: { id: bot.id },
            data: {
              status: DrawdownProtectionService.BOT_STATUS.COOLDOWN,
              statusReason: reason,
              statusChangedAt: new Date()
            }
          })
        )

        await Promise.all(throttlePromises)
      }

      // Log throttle event
      await this.logRiskEvent(portfolioId, 'bots_throttled', {
        reason,
        overlay: riskOverlay,
        botsAffected: bots.length,
        metadata,
        timestamp: new Date()
      })

      // Send notification
      await this.sendRiskNotification(portfolioId, 'warning', {
        title: 'Trading Throttled - Risk Warning',
        message: `Bot activity has been throttled due to approaching risk limits.`,
        metadata: {
          overlay: riskOverlay.settings,
          botsAffected: bots.length,
          reason
        }
      })

      return {
        type: 'throttle_bots',
        success: true,
        reason,
        overlay: riskOverlay,
        botsAffected: bots.length
      }
    } catch (error) {
      console.error('Failed to throttle bots:', error)
      return {
        type: 'throttle_bots',
        success: false,
        reason: error.message
      }
    }
  }

  // Restore risk-paused bots only (not user-paused)
  async restoreRiskPausedBots(portfolioId, metadata = {}) {
    try {
      // Clear risk overlay
      await prisma.portfolio.update({
        where: { id: portfolioId },
        data: {
          riskOverlay: null
        }
      })

      // Only restore bots that were paused for risk reasons
      const riskPausedBots = await prisma.bot.findMany({
        where: {
          portfolioId,
          status: DrawdownProtectionService.BOT_STATUS.PAUSED_RISK
        }
      })

      if (riskPausedBots.length > 0) {
        const restorePromises = riskPausedBots.map(bot =>
          prisma.bot.update({
            where: { id: bot.id },
            data: {
              status: DrawdownProtectionService.BOT_STATUS.RECOVERING,
              statusReason: 'recovery_attempt',
              statusChangedAt: new Date()
            }
          })
        )

        await Promise.all(restorePromises)

        // Give bots a recovery period before full activation
        setTimeout(async () => {
          await this.completeBotRecovery(portfolioId, riskPausedBots.map(b => b.id))
        }, 5 * 60 * 1000) // 5 minute recovery period
      }

      // Log recovery event
      await this.logRiskEvent(portfolioId, 'bots_recovery_started', {
        botsRestored: riskPausedBots.length,
        metadata,
        timestamp: new Date()
      })

      // Send recovery notification
      await this.sendRiskNotification(portfolioId, 'info', {
        title: 'Trading Recovery Started',
        message: `Risk levels have normalized. Starting recovery process for ${riskPausedBots.length} bots.`,
        metadata: {
          botsAffected: riskPausedBots.length,
          recoveryPeriod: '5 minutes'
        }
      })

      return {
        recovered: true,
        botsAffected: riskPausedBots.length,
        recoveryPeriod: '5 minutes'
      }
    } catch (error) {
      console.error('Failed to restore risk-paused bots:', error)
      return { recovered: false, reason: error.message }
    }
  }

  // Complete bot recovery after recovery period
  async completeBotRecovery(portfolioId, botIds) {
    try {
      // Update bots to active status
      const updatePromises = botIds.map(botId =>
        prisma.bot.update({
          where: { id: botId },
          data: {
            status: DrawdownProtectionService.BOT_STATUS.ACTIVE,
            statusReason: 'recovery_complete',
            statusChangedAt: new Date()
          }
        })
      )

      await Promise.all(updatePromises)

      // Log recovery completion
      await this.logRiskEvent(portfolioId, 'bots_recovery_complete', {
        botsReactivated: botIds.length,
        timestamp: new Date()
      })

      // Send notification
      await this.sendRiskNotification(portfolioId, 'success', {
        title: 'Trading Restored',
        message: `${botIds.length} bots have been fully reactivated.`,
        metadata: {
          botsAffected: botIds.length
        }
      })

      return {
        success: true,
        botsReactivated: botIds.length
      }
    } catch (error) {
      console.error('Failed to complete bot recovery:', error)
      return { success: false, reason: error.message }
    }
  }

  // Get current risk overlay for portfolio
  async getRiskOverlay(portfolioId) {
    try {
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        select: { riskOverlay: true }
      })

      return portfolio?.riskOverlay || null
    } catch (error) {
      console.error('Failed to get risk overlay:', error)
      return null
    }
  }

  // Get effective risk settings (base + overlay)
  async getEffectiveRiskSettings(portfolioId) {
    try {
      const [baseSettings, overlay] = await Promise.all([
        riskGateService.getRiskSettings(portfolioId),
        this.getRiskOverlay(portfolioId)
      ])

      if (!overlay || !overlay.enabled) {
        return baseSettings
      }

      // Apply overlay on top of base settings
      return {
        ...baseSettings,
        ...overlay.settings,
        overlay: {
          reason: overlay.reason,
          appliedAt: overlay.appliedAt,
          expiresAt: overlay.expiresAt
        }
      }
    } catch (error) {
      console.error('Failed to get effective risk settings:', error)
      return riskGateService.getDefaultRiskSettings()
    }
  }

  // Manual bot status management
  async pauseBotManually(botId, reason = 'user_request') {
    try {
      await prisma.bot.update({
        where: { id: botId },
        data: {
          status: DrawdownProtectionService.BOT_STATUS.PAUSED_USER,
          statusReason: reason,
          statusChangedAt: new Date()
        }
      })

      return { success: true, status: DrawdownProtectionService.BOT_STATUS.PAUSED_USER }
    } catch (error) {
      console.error('Failed to pause bot manually:', error)
      return { success: false, reason: error.message }
    }
  }

  async resumeBotManually(botId) {
    try {
      await prisma.bot.update({
        where: { id: botId },
        data: {
          status: DrawdownProtectionService.BOT_STATUS.ACTIVE,
          statusReason: 'user_resume',
          statusChangedAt: new Date()
        }
      })

      return { success: true, status: DrawdownProtectionService.BOT_STATUS.ACTIVE }
    } catch (error) {
      console.error('Failed to resume bot manually:', error)
      return { success: false, reason: error.message }
    }
  }

  // Get bot status report
  async getBotStatusReport(portfolioId) {
    try {
      const bots = await prisma.bot.findMany({
        where: { portfolioId },
        select: {
          id: true,
          name: true,
          status: true,
          statusReason: true,
          statusChangedAt: true,
          metadata: true
        }
      })

      const statusCounts = bots.reduce((counts, bot) => {
        counts[bot.status] = (counts[bot.status] || 0) + 1
        return counts
      }, {})

      const overlay = await this.getRiskOverlay(portfolioId)

      return {
        portfolioId,
        timestamp: new Date(),
        totalBots: bots.length,
        statusBreakdown: statusCounts,
        riskOverlay: overlay,
        bots: bots.map(bot => ({
          id: bot.id,
          name: bot.name,
          status: bot.status,
          reason: bot.statusReason,
          statusChangedAt: bot.statusChangedAt,
          canResume: bot.status === DrawdownProtectionService.BOT_STATUS.PAUSED_USER
        }))
      }
    } catch (error) {
      console.error('Failed to get bot status report:', error)
      return { portfolioId, error: error.message }
    }
  }

  // Helper methods
  async logRiskEvent(portfolioId, eventType, metadata) {
    try {
      await prisma.botEvent.create({
        data: {
          portfolioId,
          type: eventType,
          detail: `Drawdown protection: ${eventType}`,
          metadata
        }
      })
    } catch (error) {
      console.error('Failed to log risk event:', error)
    }
  }

  async sendRiskNotification(portfolioId, level, notification) {
    try {
      console.log(`Risk Notification [${level.toUpperCase()}] for portfolio ${portfolioId}:`, notification)
      
      // Store notification for user dashboard
      await prisma.botEvent.create({
        data: {
          portfolioId,
          type: 'risk_notification',
          detail: `${level}: ${notification.title}`,
          metadata: notification
        }
      })
    } catch (error) {
      console.error('Failed to send risk notification:', error)
    }
  }

  // Clear protection cache
  clearCache(portfolioId = null) {
    if (portfolioId) {
      this.protectionCache.delete(`drawdown:${portfolioId}`)
    } else {
      this.protectionCache.clear()
    }
  }
}

export const drawdownProtectionService = new DrawdownProtectionService()
