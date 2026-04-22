// Risk Notification Service
// Handles deduplicated, throttled risk notifications

import prisma from '../../db/prisma.js'

export class RiskNotificationService {
  constructor() {
    this.notificationCache = new Map()
    this.cooldownPeriods = {
      critical: 0, // No cooldown for critical
      high: 5 * 60 * 1000, // 5 minutes
      medium: 15 * 60 * 1000, // 15 minutes
      low: 30 * 60 * 1000 // 30 minutes
    }
    this.maxNotificationsPerHour = {
      critical: 10,
      high: 5,
      medium: 3,
      low: 2
    }
  }

  // Send notification with deduplication and cooldowns
  async sendNotification(portfolioId, level, notification) {
    try {
      // Generate notification key for deduplication
      const notificationKey = this.generateNotificationKey(portfolioId, level, notification)
      
      // Check if this notification should be sent
      const shouldSend = await this.shouldSendNotification(portfolioId, level, notificationKey, notification)
      
      if (!shouldSend.send) {
        return {
          sent: false,
          reason: shouldSend.reason,
          notificationKey
        }
      }

      // Send notification
      await this.deliverNotification(portfolioId, level, notification)
      
      // Update cache
      this.updateNotificationCache(notificationKey, level, notification)
      
      // Log notification
      await this.logNotification(portfolioId, level, notification, notificationKey)
      
      return {
        sent: true,
        notificationKey,
        timestamp: new Date()
      }
    } catch (error) {
      console.error('Failed to send notification:', error)
      return {
        sent: false,
        reason: 'error',
        error: error.message
      }
    }
  }

  // Check if notification should be sent
  async shouldSendNotification(portfolioId, level, notificationKey, notification) {
    // Check cooldown
    if (this.isInCooldown(notificationKey, level)) {
      return {
        send: false,
        reason: 'cooldown_active',
        remainingTime: this.getRemainingCooldown(notificationKey, level)
      }
    }

    // Check hourly rate limit
    if (await this.isRateLimited(portfolioId, level)) {
      return {
        send: false,
        reason: 'rate_limit_exceeded'
      }
    }

    // Check for duplicate content
    if (this.isDuplicate(notificationKey, notification)) {
      return {
        send: false,
        reason: 'duplicate_notification'
      }
    }

    return { send: true }
  }

  // Generate unique notification key
  generateNotificationKey(portfolioId, level, notification) {
    // Create key based on portfolio, level, and notification content
    const contentHash = this.hashNotificationContent(notification)
    return `${portfolioId}:${level}:${contentHash}`
  }

  // Hash notification content for deduplication
  hashNotificationContent(notification) {
    // Create simple hash from title and key message content
    const content = `${notification.title}:${notification.message}`
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36)
  }

  // Check if notification is in cooldown
  isInCooldown(notificationKey, level) {
    const cached = this.notificationCache.get(notificationKey)
    if (!cached) return false

    const cooldownPeriod = this.cooldownPeriods[level] || this.cooldownPeriods.medium
    const timeSinceLastSent = Date.now() - cached.lastSent
    
    return timeSinceLastSent < cooldownPeriod
  }

  // Get remaining cooldown time
  getRemainingCooldown(notificationKey, level) {
    const cached = this.notificationCache.get(notificationKey)
    if (!cached) return 0

    const cooldownPeriod = this.cooldownPeriods[level] || this.cooldownPeriods.medium
    const timeSinceLastSent = Date.now() - cached.lastSent
    
    return Math.max(0, cooldownPeriod - timeSinceLastSent)
  }

  // Check if rate limited
  async isRateLimited(portfolioId, level) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    
    const count = await prisma.botEvent.count({
      where: {
        portfolioId,
        type: 'risk_notification',
        createdAt: { gte: oneHourAgo },
        detail: { startsWith: `${level}:` }
      }
    })

    const maxPerHour = this.maxNotificationsPerHour[level] || this.maxNotificationsPerHour.medium
    
    return count >= maxPerHour
  }

  // Check for duplicate notification
  isDuplicate(notificationKey, notification) {
    const cached = this.notificationCache.get(notificationKey)
    if (!cached) return false

    // Check if content is essentially the same
    const contentHash = this.hashNotificationContent(notification)
    return cached.contentHash === contentHash
  }

  // Update notification cache
  updateNotificationCache(notificationKey, level, notification) {
    const contentHash = this.hashNotificationContent(notification)
    
    this.notificationCache.set(notificationKey, {
      lastSent: Date.now(),
      level,
      contentHash,
      notification
    })
  }

  // Deliver notification (placeholder for actual delivery system)
  async deliverNotification(portfolioId, level, notification) {
    // In production, this would integrate with:
    // - Email service
    // - SMS service
    // - Push notifications
    // - WebSocket real-time updates
    // - In-app notifications
    
    console.log(`[${level.toUpperCase()}] Risk Notification for portfolio ${portfolioId}:`, {
      title: notification.title,
      message: notification.message,
      metadata: notification.metadata
    })

    // For now, store in database for dashboard display
    await prisma.botEvent.create({
      data: {
        portfolioId,
        type: 'risk_notification',
        detail: `${level}: ${notification.title}`,
        metadata: {
          level,
          title: notification.title,
          message: notification.message,
          metadata: notification.metadata,
          deliveredAt: new Date()
        }
      }
    })
  }

  // Log notification for audit trail
  async logNotification(portfolioId, level, notification, notificationKey) {
    try {
      await prisma.botEvent.create({
        data: {
          portfolioId,
          type: 'notification_sent',
          detail: `Risk notification sent: ${level}`,
          metadata: {
            level,
            notificationKey,
            title: notification.title,
            message: notification.message,
            timestamp: new Date()
          }
        }
      })
    } catch (error) {
      console.error('Failed to log notification:', error)
    }
  }

  // Get notification history for portfolio
  async getNotificationHistory(portfolioId, hours = 24) {
    try {
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
      
      const notifications = await prisma.botEvent.findMany({
        where: {
          portfolioId,
          type: 'risk_notification',
          createdAt: { gte: cutoff }
        },
        select: {
          id: true,
          detail: true,
          metadata: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 50
      })

      return notifications.map(notif => ({
        id: notif.id,
        level: notif.metadata?.level || 'unknown',
        title: notif.metadata?.title || 'Untitled',
        message: notif.metadata?.message || '',
        metadata: notif.metadata?.metadata || {},
        timestamp: notif.createdAt,
        delivered: notif.metadata?.deliveredAt || notif.createdAt
      }))
    } catch (error) {
      console.error('Failed to get notification history:', error)
      return []
    }
  }

  // Get notification statistics
  async getNotificationStatistics(portfolioId, days = 7) {
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      
      const notifications = await prisma.botEvent.findMany({
        where: {
          portfolioId,
          type: 'risk_notification',
          createdAt: { gte: cutoff }
        },
        select: {
          metadata: true,
          createdAt: true
        }
      })

      const stats = {
        total: notifications.length,
        byLevel: { critical: 0, high: 0, medium: 0, low: 0 },
        byDay: {},
        rateLimited: 0,
        cooldownBlocked: 0,
        averagePerDay: 0
      }

      // Count by level and day
      notifications.forEach(notif => {
        const level = notif.metadata?.level || 'unknown'
        const day = notif.createdAt.toISOString().split('T')[0]
        
        if (stats.byLevel[level]) {
          stats.byLevel[level]++
        }
        
        stats.byDay[day] = (stats.byDay[day] || 0) + 1
      })

      // Calculate average per day
      const daysWithNotifications = Object.keys(stats.byDay).length
      stats.averagePerDay = daysWithNotifications > 0 ? stats.total / daysWithNotifications : 0

      // Get rate limit and cooldown stats (would need to track these)
      stats.rateLimited = await this.getRateLimitCount(portfolioId, cutoff)
      stats.cooldownBlocked = await this.getCooldownBlockCount(portfolioId, cutoff)

      return {
        portfolioId,
        period: `${days} days`,
        timestamp: new Date(),
        statistics: stats
      }
    } catch (error) {
      console.error('Failed to get notification statistics:', error)
      return {
        portfolioId,
        statistics: {},
        error: error.message
      }
    }
  }

  // Get rate limit count
  async getRateLimitCount(portfolioId, since) {
    try {
      return await prisma.botEvent.count({
        where: {
          portfolioId,
          type: 'notification_blocked',
          detail: { contains: 'rate_limit_exceeded' },
          createdAt: { gte: since }
        }
      })
    } catch (error) {
      console.error('Failed to get rate limit count:', error)
      return 0
    }
  }

  // Get cooldown block count
  async getCooldownBlockCount(portfolioId, since) {
    try {
      return await prisma.botEvent.count({
        where: {
          portfolioId,
          type: 'notification_blocked',
          detail: { contains: 'cooldown_active' },
          createdAt: { gte: since }
        }
      })
    } catch (error) {
      console.error('Failed to get cooldown block count:', error)
      return 0
    }
  }

  // Send batch notifications (with individual rate limiting)
  async sendBatchNotifications(notifications) {
    const results = []
    
    for (const notification of notifications) {
      const result = await this.sendNotification(
        notification.portfolioId,
        notification.level,
        notification.notification
      )
      results.push(result)
      
      // Add small delay between notifications to prevent overwhelming
      if (results.length < notifications.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    
    return {
      total: notifications.length,
      sent: results.filter(r => r.sent).length,
      blocked: results.filter(r => !r.sent).length,
      results
    }
  }

  // Clear notification cache
  clearCache(portfolioId = null) {
    if (portfolioId) {
      // Clear specific portfolio notifications
      for (const [key] of this.notificationCache) {
        if (key.startsWith(`${portfolioId}:`)) {
          this.notificationCache.delete(key)
        }
      }
    } else {
      this.notificationCache.clear()
    }
  }

  // Update notification preferences
  async updateNotificationPreferences(portfolioId, preferences) {
    try {
      await prisma.portfolio.update({
        where: { id: portfolioId },
        data: {
          notificationPreferences: {
            email: preferences.email || true,
            sms: preferences.sms || false,
            push: preferences.push || true,
            inApp: preferences.inApp || true,
            levels: {
              critical: preferences.levels?.critical !== false,
              high: preferences.levels?.high !== false,
              medium: preferences.levels?.medium !== false,
              low: preferences.levels?.low || false
            },
            quietHours: preferences.quietHours || {
              enabled: false,
              start: '22:00',
              end: '08:00'
            }
          }
        }
      })

      return { success: true }
    } catch (error) {
      console.error('Failed to update notification preferences:', error)
      return { success: false, error: error.message }
    }
  }

  // Get notification preferences
  async getNotificationPreferences(portfolioId) {
    try {
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        select: { notificationPreferences: true }
      })

      return portfolio?.notificationPreferences || {
        email: true,
        sms: false,
        push: true,
        inApp: true,
        levels: {
          critical: true,
          high: true,
          medium: true,
          low: false
        },
        quietHours: {
          enabled: false,
          start: '22:00',
          end: '08:00'
        }
      }
    } catch (error) {
      console.error('Failed to get notification preferences:', error)
      return null
    }
  }

  // Check if notifications are in quiet hours
  async isInQuietHours(portfolioId) {
    try {
      const preferences = await this.getNotificationPreferences(portfolioId)
      
      if (!preferences?.quietHours?.enabled) {
        return false
      }

      const now = new Date()
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
      
      const { start, end } = preferences.quietHours
      
      if (start <= end) {
        // Same day range (e.g., 22:00 to 08:00 crosses midnight)
        return currentTime >= start || currentTime <= end
      } else {
        // Normal range (e.g., 08:00 to 22:00)
        return currentTime >= start && currentTime <= end
      }
    } catch (error) {
      console.error('Failed to check quiet hours:', error)
      return false
    }
  }
}

export const riskNotificationService = new RiskNotificationService()
