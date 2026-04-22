// Operational Risk Score Service
// Measures if the system can execute safely right now

import prisma from '../../db/prisma.js'

export class OperationalRiskService {
  constructor() {
    this.thresholds = {
      quoteFreshnessMax: 10000, // 10 seconds
      dbLatencyMax: 1000, // 1 second
      queueBacklogMax: 50,
      recentErrorMax: 5 // errors in last 5 minutes
    }

    this.penalties = {
      brokerDown: 60,
      staleQuotes: 25,
      recentOrderFailures: 20,
      dbLatencyHigh: 15,
      queueBacklog: 10,
      clockUncertainty: 5
    }

    this.healthCache = new Map()
    this.cacheTtl = 5000 // 5 seconds
  }

  // Calculate operational risk score (0-100)
  async calculateOperationalRisk(portfolioId) {
    try {
      const cacheKey = `ops_risk_${portfolioId}`
      const cached = this.healthCache.get(cacheKey)

      if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
        return cached.data
      }

      const scores = {
        brokerHealth: await this.scoreBrokerHealth(portfolioId),
        quoteFreshness: await this.scoreQuoteFreshness(portfolioId),
        dbLatency: await this.scoreDbLatency(),
        queueBacklog: await this.scoreQueueBacklog(),
        recentErrors: await this.scoreRecentErrors(portfolioId),
        clockCertainty: this.scoreClockCertainty()
      }

      // Start at 100, subtract penalties
      let score = 100
      score -= scores.brokerHealth.penalty
      score -= scores.quoteFreshness.penalty
      score -= scores.dbLatency.penalty
      score -= scores.queueBacklog.penalty
      score -= scores.recentErrors.penalty
      score -= scores.clockCertainty.penalty

      // Correlated-failure cap: if broker is down, cap penalties from related failures
      // Broker outage causes: failed orders, queue backlog, recent errors - count once
      if (scores.brokerHealth.status === 'down') {
        const brokerRelatedPenalties = 
          scores.queueBacklog.penalty + 
          scores.recentErrors.penalty
        // Cap broker-related penalties to brokerDown penalty
        const maxBrokerPenalty = this.penalties.brokerDown
        if (brokerRelatedPenalties > maxBrokerPenalty) {
          // Refund excess penalties
          score += (brokerRelatedPenalties - maxBrokerPenalty)
        }
      }

      score = Math.max(0, score) // Ensure non-negative

      const result = {
        score: Math.round(score),
        label: this.getLabel(score),
        breakdown: scores,
        recommendation: this.getRecommendation(score),
        details: await this.getOperationalDetails(portfolioId)
      }

      this.healthCache.set(cacheKey, { data: result, timestamp: Date.now() })
      return result

    } catch (error) {
      console.error('Failed to calculate operational risk:', error)
      return {
        score: 0,
        label: 'weak',
        breakdown: {},
        recommendation: 'pause_auto_trading',
        error: error.message
      }
    }
  }

  // Score broker health (0-100, penalty to subtract)
  async scoreBrokerHealth(portfolioId) {
    try {
      // Check recent order failures
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
      
      const failedOrders = await prisma.trade.count({
        where: {
          portfolioId,
          status: 'failed',
          createdAt: { gte: fiveMinutesAgo }
        }
      })

      if (failedOrders >= 3) {
        return { score: 0, penalty: this.penalties.brokerDown, status: 'down' }
      }

      if (failedOrders >= 1) {
        return { score: 40, penalty: this.penalties.recentOrderFailures, status: 'degraded' }
      }

      return { score: 100, penalty: 0, status: 'healthy' }

    } catch (error) {
      console.error('Failed to score broker health:', error)
      return { score: 50, penalty: 30, status: 'unknown' }
    }
  }

  // Score quote freshness (0-100, penalty to subtract)
  async scoreQuoteFreshness(portfolioId) {
    try {
      // Check most recent quote timestamp
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        select: { lastQuoteUpdate: true }
      })

      if (!portfolio || !portfolio.lastQuoteUpdate) {
        return { score: 50, penalty: 15, status: 'no_quotes' }
      }

      const freshness = Date.now() - portfolio.lastQuoteUpdate.getTime()

      if (freshness > this.thresholds.quoteFreshnessMax) {
        return { score: 20, penalty: this.penalties.staleQuotes, status: 'stale', age: freshness }
      }

      return { score: 100, penalty: 0, status: 'fresh', age: freshness }

    } catch (error) {
      console.error('Failed to score quote freshness:', error)
      return { score: 50, penalty: 10, status: 'unknown' }
    }
  }

  // Score DB latency (0-100, penalty to subtract)
  async scoreDbLatency() {
    try {
      const start = Date.now()
      await prisma.$queryRaw`SELECT 1`
      const latency = Date.now() - start

      if (latency > this.thresholds.dbLatencyMax) {
        return { score: 40, penalty: this.penalties.dbLatencyHigh, status: 'slow', latency }
      }

      if (latency > 500) {
        return { score: 70, penalty: 5, status: 'moderate', latency }
      }

      return { score: 100, penalty: 0, status: 'fast', latency }

    } catch (error) {
      console.error('Failed to score DB latency:', error)
      return { score: 0, penalty: 50, status: 'error' }
    }
  }

  // Score queue backlog (0-100, penalty to subtract)
  async scoreQueueBacklog() {
    try {
      // Check pending execution queue size
      // This would need to connect to your queue system
      // For V1, we'll use trade count with 'pending' status
      const pendingTrades = await prisma.trade.count({
        where: { status: 'pending' }
      })

      if (pendingTrades > this.thresholds.queueBacklogMax) {
        return { 
          score: 50, 
          penalty: this.penalties.queueBacklog, 
          status: 'backlogged', 
          count: pendingTrades 
        }
      }

      if (pendingTrades > 20) {
        return { score: 80, penalty: 5, status: 'moderate', count: pendingTrades }
      }

      return { score: 100, penalty: 0, status: 'clear', count: pendingTrades }

    } catch (error) {
      console.error('Failed to score queue backlog:', error)
      return { score: 50, penalty: 10, status: 'unknown' }
    }
  }

  // Score recent errors (0-100, penalty to subtract)
  async scoreRecentErrors(portfolioId) {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

      const errorEvents = await prisma.botEvent.count({
        where: {
          portfolioId,
          type: { contains: 'error' },
          createdAt: { gte: fiveMinutesAgo }
        }
      })

      if (errorEvents >= this.thresholds.recentErrorMax) {
        return { score: 30, penalty: 15, status: 'high_errors', count: errorEvents }
      }

      if (errorEvents >= 2) {
        return { score: 70, penalty: 5, status: 'some_errors', count: errorEvents }
      }

      return { score: 100, penalty: 0, status: 'clean', count: errorEvents }

    } catch (error) {
      console.error('Failed to score recent errors:', error)
      return { score: 50, penalty: 10, status: 'unknown' }
    }
  }

  // Score clock/market-hours certainty (0-100, penalty to subtract)
  scoreClockCertainty() {
    try {
      // Use timezone-aware US Eastern time
      const now = new Date()
      const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const hour = easternTime.getHours()
      const minutes = easternTime.getMinutes()
      const day = easternTime.getDay()

      // Weekends are uncertain for trading
      if (day === 0 || day === 6) {
        return { score: 60, penalty: this.penalties.clockUncertainty, status: 'weekend' }
      }

      // Outside market hours (9:30 AM - 4:00 PM ET)
      const timeInMinutes = hour * 60 + minutes
      const marketOpen = 9 * 60 + 30 // 9:30 AM
      const marketClose = 16 * 60 // 4:00 PM

      if (timeInMinutes < marketOpen || timeInMinutes >= marketClose) {
        return { score: 80, penalty: this.penalties.clockUncertainty / 2, status: 'after_hours' }
      }

      return { score: 100, penalty: 0, status: 'market_hours' }

    } catch (error) {
      console.error('Failed to score clock certainty:', error)
      return { score: 50, penalty: 5, status: 'unknown' }
    }
  }

  // Get detailed operational information
  async getOperationalDetails(portfolioId) {
    try {
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        select: { lastQuoteUpdate: true }
      })

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

      const [failedOrders, errorEvents, pendingTrades] = await Promise.all([
        prisma.trade.count({
          where: {
            portfolioId,
            status: 'failed',
            createdAt: { gte: fiveMinutesAgo }
          }
        }),
        prisma.botEvent.count({
          where: {
            portfolioId,
            type: { contains: 'error' },
            createdAt: { gte: fiveMinutesAgo }
          }
        }),
        prisma.trade.count({
          where: { status: 'pending' }
        })
      ])

      return {
        lastQuoteUpdate: portfolio?.lastQuoteUpdate,
        quoteAge: portfolio?.lastQuoteUpdate ? Date.now() - portfolio.lastQuoteUpdate.getTime() : null,
        failedOrdersLast5min: failedOrders,
        errorEventsLast5min: errorEvents,
        pendingQueueSize: pendingTrades,
        currentTime: new Date(),
        isMarketHours: this.isMarketHours()
      }

    } catch (error) {
      console.error('Failed to get operational details:', error)
      return null
    }
  }

  // Check if currently in market hours (timezone-aware US Eastern)
  isMarketHours() {
    const now = new Date()
    const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const hour = easternTime.getHours()
    const minutes = easternTime.getMinutes()
    const day = easternTime.getDay()

    // Weekends
    if (day === 0 || day === 6) return false

    // Market hours 9:30 AM - 4:00 PM ET
    const timeInMinutes = hour * 60 + minutes
    const marketOpen = 9 * 60 + 30 // 9:30 AM
    const marketClose = 16 * 60 // 4:00 PM

    return timeInMinutes >= marketOpen && timeInMinutes < marketClose
  }

  // Get label for score
  getLabel(score) {
    if (score >= 75) return 'good'
    if (score >= 50) return 'moderate'
    return 'weak'
  }

  // Get recommendation based on score
  getRecommendation(score) {
    if (score >= 75) return 'normal_trading'
    if (score >= 60) return 'safe_mode'
    if (score >= 40) return 'disable_market_orders'
    return 'pause_auto_trading'
  }

  // Clear cache
  clearCache(portfolioId = null) {
    if (portfolioId) {
      this.healthCache.delete(`ops_risk_${portfolioId}`)
    } else {
      this.healthCache.clear()
    }
  }

  // Update thresholds
  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds }
  }

  // Update penalties
  updatePenalties(newPenalties) {
    this.penalties = { ...this.penalties, ...newPenalties }
  }
}

export const operationalRiskService = new OperationalRiskService()
