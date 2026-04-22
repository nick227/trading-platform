// Bot Control Service
// Handles bot state management: pause, throttle, restore operations
// Status is primary source of truth, enabled is computed from status

import prisma from '../../db/prisma.js'
import { riskNotificationService } from './RiskNotificationService.js'

export class BotControlService {
  constructor() {
    this.botStatusEnum = {
      ACTIVE: 'active',
      PAUSED_USER: 'paused_user',
      PAUSED_RISK: 'paused_risk',
      RECOVERING: 'recovering',
      PAUSED_ADMIN: 'paused_admin'
    }

    this.riskModeEnum = {
      NORMAL: 'normal',
      THROTTLED: 'throttled',
      EMERGENCY: 'emergency'
    }

    this.actorEnum = {
      USER: 'user',
      ADMIN: 'admin',
      SYSTEM: 'system',
      SCHEDULED: 'scheduled'
    }

    this.activeStatuses = new Set([this.botStatusEnum.ACTIVE])
    this.pausedStatuses = new Set([
      this.botStatusEnum.PAUSED_USER,
      this.botStatusEnum.PAUSED_RISK,
      this.botStatusEnum.PAUSED_ADMIN
    ])
  }

  // Compute enabled from status (status is primary)
  computeEnabledFromStatus(status) {
    return status === this.botStatusEnum.ACTIVE
  }

  // Pause all bots in a portfolio
  async pauseAllBots(portfolioId, reason, metadata = {}, actor = this.actorEnum.SYSTEM) {
    try {
      // Use transaction for atomic state + event write
      const result = await prisma.$transaction(async (tx) => {
        // Get all active bots by status (not enabled boolean)
        const bots = await tx.bot.findMany({
          where: {
            portfolioId,
            status: this.botStatusEnum.ACTIVE
          },
          select: {
            id: true,
            name: true,
            status: true,
            lastActivity: true
          }
        })

        // Idempotency: if no active bots, noop
        if (bots.length === 0) {
          return {
            success: true,
            pausedCount: 0,
            action: 'skipped',
            message: 'No active bots found in portfolio'
          }
        }

        // Update all bots to paused state
        const updateResult = await tx.bot.updateMany({
          where: {
            portfolioId,
            status: this.botStatusEnum.ACTIVE
          },
          data: {
            status: this.botStatusEnum.PAUSED_RISK,
            statusReason: reason,
            statusChangedAt: new Date()
            // enabled field removed - deprecated, computed from status
          }
        })

        // Log the pause event with actor identity
        await tx.botEvent.create({
          data: {
            portfolioId,
            type: 'bots_paused',
            detail: `Paused ${updateResult.count} bots: ${reason}`,
            metadata: {
              reason,
              pausedCount: updateResult.count,
              botIds: bots.map(bot => bot.id),
              actor,
              metadata
            }
          }
        })

        return {
          success: true,
          pausedCount: updateResult.count,
          botIds: bots.map(bot => bot.id)
        }
      })

      // Send notification about bot pause
      await riskNotificationService.sendNotification(portfolioId, 'high', {
        title: 'Trading Bots Paused',
        message: `${result.pausedCount} bots have been paused due to: ${reason}`,
        metadata: {
          reason,
          pausedCount: result.pausedCount,
          action: 'pause_all',
          timestamp: new Date()
        }
      })

      return {
        ...result,
        reason,
        timestamp: new Date()
      }

    } catch (error) {
      console.error('Failed to pause all bots:', error)
      return {
        success: false,
        error: error.message,
        pausedCount: 0
      }
    }
  }

  // Throttle bot activity using overlay settings with riskMode (not status change)
  async throttleBots(portfolioId, reason, metadata = {}, actor = this.actorEnum.SYSTEM, overlayPolicy = 'replace') {
    try {
      // Use transaction for atomic state + event write
      const result = await prisma.$transaction(async (tx) => {
        // Get current portfolio settings
        const portfolio = await tx.portfolio.findUnique({
          where: { id: portfolioId },
          select: { riskSettings: true }
        })

        const currentSettings = portfolio?.riskSettings || {}
        
        // Extract base settings (excluding throttle-specific fields)
        const { isThrottled, throttleReason, throttledAt, throttleExpiry, throttleMultiplier, riskMode, ...baseSettings } = currentSettings

        // Check if already throttled for idempotency
        if (isThrottled && throttleReason === reason) {
          // Already throttled for same reason - extend expiry
          if (overlayPolicy === 'extend' || overlayPolicy === 'replace') {
            const extendedExpiry = new Date(Math.max(throttleExpiry?.getTime() || 0, Date.now() + 60 * 60 * 1000))
            await tx.portfolio.update({
              where: { id: portfolioId },
              data: {
                riskSettings: {
                  ...currentSettings,
                  throttleExpiry: extendedExpiry
                }
              }
            })
            return {
              success: true,
              throttledCount: 0,
              action: 'extended_expiry',
              message: 'Already throttled for same reason, extended expiry'
            }
          }
        }

        // Conservative overlay settings with explicit unit names
        const throttleOverlay = {
          maxPositionWeightPct: 0.5, // Reduce to 50% of normal
          maxDailyLossPct: 0.01, // Reduce to 1% daily max loss
          confidenceThreshold: 0.8, // Increase confidence requirement
          maxDrawdownPct: 0.05, // Reduce max drawdown to 5%
          throttleMultiplier: 0.6, // Reduce position sizes by 40%
          isThrottled: true,
          throttleReason: reason,
          throttledAt: new Date(),
          throttleExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour expiry
          riskMode: this.riskModeEnum.THROTTLED,
          // Persist baseSettings snapshot for restore
          baseSettings
        }

        // Update portfolio with overlay (preserve base settings)
        await tx.portfolio.update({
          where: { id: portfolioId },
          data: {
            riskSettings: {
              ...baseSettings,
              ...throttleOverlay
            }
          }
        })

        // Get active bots by status
        const activeBots = await tx.bot.findMany({
          where: {
            portfolioId,
            status: this.botStatusEnum.ACTIVE
          },
          select: { id: true, name: true }
        })

        // Update bots to THROTTLED riskMode (keep status ACTIVE)
        await tx.bot.updateMany({
          where: {
            portfolioId,
            status: this.botStatusEnum.ACTIVE
          },
          data: {
            riskMode: this.riskModeEnum.THROTTLED,
            statusReason: reason,
            statusChangedAt: new Date()
          }
        })

        // Log throttling event with actor identity
        await tx.botEvent.create({
          data: {
            portfolioId,
            type: 'bots_throttled',
            detail: `Throttled ${activeBots.length} bots: ${reason}`,
            metadata: {
              reason,
              throttledCount: activeBots.length,
              overlaySettings: throttleOverlay,
              baseSettings,
              actor,
              overlayPolicy,
              metadata
            }
          }
        })

        return {
          success: true,
          throttledCount: activeBots.length,
          overlaySettings: throttleOverlay,
          baseSettings
        }
      })

      // Send notification about throttling
      await riskNotificationService.sendNotification(portfolioId, 'medium', {
        title: 'Bot Activity Throttled',
        message: `${result.throttledCount} bots have been throttled due to: ${reason}`,
        metadata: {
          reason,
          throttledCount: result.throttledCount,
          settings: result.overlaySettings,
          action: 'throttle',
          timestamp: new Date()
        }
      })

      return {
        ...result,
        reason,
        timestamp: new Date()
      }

    } catch (error) {
      console.error('Failed to throttle bots:', error)
      return {
        success: false,
        error: error.message,
        throttledCount: 0
      }
    }
  }

  // Restore normal trading conditions (restore previous settings, not defaults)
  async restoreNormalTrading(portfolioId, metadata = {}, actor = this.actorEnum.SYSTEM) {
    try {
      // Use transaction for atomic state + event write
      const result = await prisma.$transaction(async (tx) => {
        // Get current portfolio settings
        const portfolio = await tx.portfolio.findUnique({
          where: { id: portfolioId },
          select: { riskSettings: true }
        })

        const currentSettings = portfolio?.riskSettings || {}
        const baseSettings = currentSettings.baseSettings || {}

        // Remove throttle overlay, restore base settings
        const restoredSettings = {
          ...baseSettings,
          isThrottled: false,
          throttleMultiplier: 1.0,
          throttleReason: null,
          throttledAt: null,
          throttleExpiry: null,
          riskMode: this.riskModeEnum.NORMAL,
          restoredAt: new Date()
        }

        // Update portfolio with restored settings
        await tx.portfolio.update({
          where: { id: portfolioId },
          data: {
            riskSettings: restoredSettings
          }
        })

        // Get bots that were paused/throttled by risk management (exclude admin-paused)
        const riskManagedBots = await tx.bot.findMany({
          where: {
            portfolioId,
            status: {
              in: [
                this.botStatusEnum.PAUSED_RISK,
                this.botStatusEnum.RECOVERING
              ]
            }
          },
          select: {
            id: true,
            name: true,
            status: true,
            riskMode: true
          }
        })

        let restoredCount = 0

        // Restore paused bots (but NOT admin-paused)
        const toRestore = riskManagedBots.filter(bot => 
          bot.status === this.botStatusEnum.PAUSED_RISK || 
          bot.status === this.botStatusEnum.RECOVERING
        )

        if (toRestore.length > 0) {
          await tx.bot.updateMany({
            where: {
              id: { in: toRestore.map(bot => bot.id) }
            },
            data: {
              status: this.botStatusEnum.ACTIVE,
              riskMode: this.riskModeEnum.NORMAL,
              statusReason: null,
              statusChangedAt: new Date()
              // enabled field removed - deprecated, computed from status
            }
          })
          restoredCount = toRestore.length
        }

        // Clear throttled riskMode for active bots
        const throttledBots = await tx.bot.findMany({
          where: {
            portfolioId,
            status: this.botStatusEnum.ACTIVE,
            riskMode: this.riskModeEnum.THROTTLED
          },
          select: { id: true, name: true }
        })

        if (throttledBots.length > 0) {
          await tx.bot.updateMany({
            where: {
              id: { in: throttledBots.map(bot => bot.id) }
            },
            data: {
              riskMode: this.riskModeEnum.NORMAL,
              statusReason: null,
              statusChangedAt: new Date()
            }
          })
          restoredCount += throttledBots.length
        }

        // Log restoration event with actor identity
        await tx.botEvent.create({
          data: {
            portfolioId,
            type: 'trading_restored',
            detail: `Restored normal trading for ${restoredCount} bots`,
            metadata: {
              restoredCount,
              restoredSettings,
              previousSettings: currentSettings,
              actor,
              metadata
            }
          }
        })

        return {
          success: true,
          restoredCount,
          restoredSettings
        }
      })

      // Send notification about restoration
      await riskNotificationService.sendNotification(portfolioId, 'low', {
        title: 'Trading Restored',
        message: `Normal trading conditions restored for ${result.restoredCount} bots`,
        metadata: {
          restoredCount: result.restoredCount,
          settings: result.restoredSettings,
          action: 'restore_normal',
          timestamp: new Date()
        }
      })

      return {
        ...result,
        timestamp: new Date()
      }

    } catch (error) {
      console.error('Failed to restore normal trading:', error)
      return {
        success: false,
        error: error.message,
        restoredCount: 0
      }
    }
  }

  // Get bot status summary for portfolio
  async getBotStatusSummary(portfolioId) {
    try {
      const botStatuses = await prisma.bot.groupBy({
        by: ['status'],
        where: { portfolioId },
        _count: { id: true }
      })

      const summary = {
        total: 0,
        active: 0,
        paused: 0,
        throttled: 0,
        recovering: 0,
        byStatus: {}
      }

      botStatuses.forEach(group => {
        const count = group._count.id
        summary.total += count
        
        const statusKey = group.status || 'unknown'
        summary.byStatus[statusKey] = count

        // Categorize using enum set membership (not string matching)
        if (this.activeStatuses.has(group.status)) {
          summary.active += count
        } else if (this.pausedStatuses.has(group.status)) {
          summary.paused += count
        } else if (group.status === this.botStatusEnum.COOLDOWN) {
          summary.throttled += count
        } else if (group.status === this.botStatusEnum.RECOVERING) {
          summary.recovering += count
        }
      })

      return {
        portfolioId,
        ...summary,
        timestamp: new Date()
      }

    } catch (error) {
      console.error('Failed to get bot status summary:', error)
      return {
        portfolioId,
        error: error.message,
        total: 0,
        active: 0,
        paused: 0,
        throttled: 0,
        recovering: 0
      }
    }
  }

  // Update individual bot status (atomic: read/validate/update/log in one transaction)
  async updateBotStatus(botId, status, reason = null, actor = this.actorEnum.SYSTEM, expectedVersion = null) {
    try {
      const validStatuses = Object.values(this.botStatusEnum)
      if (!validStatuses.includes(status)) {
        throw new Error(`Invalid status: ${status}. Valid statuses: ${validStatuses.join(', ')}`)
      }

      // Single transaction for read/validate/update/log
      const result = await prisma.$transaction(async (tx) => {
        // Read current bot state with version for optimistic locking
        const currentBot = await tx.bot.findUnique({
          where: { id: botId },
          select: {
            id: true,
            name: true,
            status: true,
            portfolioId: true,
            version: true
          }
        })

        if (!currentBot) {
          throw new Error(`Bot not found: ${botId}`)
        }

        const oldStatus = currentBot.status
        const currentVersion = currentBot.version

        // Prevent PAUSED_ADMIN -> any auto-transition (require explicit admin action)
        if (oldStatus === this.botStatusEnum.PAUSED_ADMIN && status !== this.botStatusEnum.PAUSED_ADMIN) {
          throw new Error('Cannot auto-transition admin-paused bot. Requires explicit admin action.')
        }

        // Validate transition is allowed
        const allowedTransitions = this.getStatusTransitions(oldStatus)
        if (!allowedTransitions.includes(status)) {
          throw new Error(`Invalid transition from ${oldStatus} to ${status}. Allowed: ${allowedTransitions.join(', ')}`)
        }

        // Optimistic locking: include version in update predicate
        const updateWhere = expectedVersion !== null
          ? { id: botId, version: expectedVersion }
          : { id: botId }

        // Update bot status with version increment
        const updateResult = await tx.bot.updateMany({
          where: updateWhere,
          data: {
            status,
            statusReason: reason,
            statusChangedAt: new Date(),
            version: { increment: 1 }
            // enabled field removed - deprecated
          }
        })

        // Check if update succeeded (optimistic lock)
        if (updateResult.count === 0) {
          throw new Error(`Version conflict: expected ${expectedVersion}, no rows updated`)
        }

        // Get updated bot for logging
        const bot = await tx.bot.findUnique({
          where: { id: botId },
          select: { name: true, portfolioId: true, version: true }
        })

        // Log status change with correct oldStatus and actor identity
        await tx.botEvent.create({
          data: {
            portfolioId: bot.portfolioId,
            type: 'bot_status_changed',
            detail: `Bot ${bot.name} status changed to: ${status}`,
            metadata: {
              botId,
              botName: bot.name,
              oldStatus,
              newStatus: status,
              reason,
              actor,
              oldVersion: currentVersion,
              newVersion: bot.version,
              timestamp: new Date()
            }
          }
        })

        return {
          botId,
          botName: bot.name,
          oldStatus,
          newStatus: status,
          oldVersion: currentVersion,
          newVersion: bot.version
        }
      })

      return {
        success: true,
        ...result,
        reason,
        timestamp: new Date()
      }

    } catch (error) {
      console.error('Failed to update bot status:', error)
      return {
        success: false,
        botId,
        error: error.message
      }
    }
  }

  // Get available status transitions (admin-paused requires explicit action)
  getStatusTransitions(currentStatus) {
    const transitions = {
      [this.botStatusEnum.ACTIVE]: [
        this.botStatusEnum.PAUSED_USER,
        this.botStatusEnum.PAUSED_RISK,
        this.botStatusEnum.PAUSED_ADMIN
      ],
      [this.botStatusEnum.PAUSED_USER]: [
        this.botStatusEnum.ACTIVE,
        this.botStatusEnum.RECOVERING
      ],
      [this.botStatusEnum.PAUSED_RISK]: [
        this.botStatusEnum.ACTIVE,
        this.botStatusEnum.RECOVERING
      ],
      [this.botStatusEnum.PAUSED_ADMIN]: [
        // No auto transitions - requires explicit admin action
      ],
      [this.botStatusEnum.RECOVERING]: [
        this.botStatusEnum.ACTIVE,
        this.botStatusEnum.PAUSED_RISK
      ]
    }

    return transitions[currentStatus] || []
  }
}

export const botControlService = new BotControlService()
