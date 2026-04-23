import metricsService from '../services/metricsService.js'
import { STUB_USER_ID } from '../utils/auth.js'
import prisma from '../loaders/prisma.js'

export default async function metricsRoutes(app, opts) {
  // GET /api/metrics/templates/:templateId
  app.get('/templates/:templateId', async (request, reply) => {
    try {
      const { templateId } = request.params
      
      const metrics = await prisma.templateMetricCurrent.findUnique({
        where: { templateId }
      })

      if (!metrics) {
        return reply.code(404).send({ 
          error: 'Template not found',
          templateId 
        })
      }

      // Don't show unreliable metrics
      if (metrics.dataQuality !== 'sufficient') {
        return reply.send({
          templateId,
          dataQuality: metrics.dataQuality,
          message: getQualityMessage(metrics.dataQuality),
          metrics: {
            annualReturn: null,
            winRate: null,
            sharpeRatio: null,
            activeUsers: metrics.activeUsers,
            totalTrades: metrics.totalTrades,
            lastUpdated: metrics.lastUpdated
          }
        })
      }

      return reply.send({
        templateId,
        dataQuality: metrics.dataQuality,
        metrics: {
          annualReturn: metrics.annualReturn,
          winRate: metrics.winRate,
          sharpeRatio: metrics.sharpeRatio,
          maxDrawdown: metrics.maxDrawdown,
          activeUsers: metrics.activeUsers,
          totalTrades: metrics.totalTrades,
          last30dReturn: metrics.last30dReturn,
          lastUpdated: metrics.lastUpdated
        }
      })
    } catch (error) {
      console.error('[metrics] Error fetching template metrics:', error)
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/metrics/portfolio/summary
  app.get('/portfolio/summary', async (request, reply) => {
    try {
      const userId = STUB_USER_ID // TODO: Replace with actual auth
      console.log('[metrics] Portfolio summary requested for userId:', userId)

      // Get user's executions for portfolio KPIs
      const executions = await prisma.execution.findMany({
        where: {
          userId,
          status: 'filled',
          filledAt: { not: null }
        },
        orderBy: { filledAt: 'desc' }
      })
      
      console.log('[metrics] Found executions:', executions.length)

      if (executions.length === 0) {
        return reply.send({
          portfolioReturn: 0,
          totalPnl: 0,
          winRate: 0,
          sharpeRatio: 0,
          maxDrawdown: 0,
          totalTrades: 0,
          activeBots: 0,
          lastUpdated: new Date()
        })
      }

      // Calculate basic portfolio metrics
      const totalTrades = executions.length
      const totalPnl = executions.reduce((sum, e) => sum + Number(e.pnl || 0), 0)
      const winningTrades = executions.filter(e => Number(e.pnl || 0) > 0).length
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0

      console.log('[metrics] Calculated portfolio metrics:', {
        totalTrades,
        totalPnl,
        winningTrades,
        winRate
      })

      // Simple return calculation (starting vs ending value)
      const portfolioReturn = calculateSimpleReturn(executions)

      // Get active bots count
      const activeBots = await prisma.bot.count({
        where: {
          userId,
          enabled: true,
          deletedAt: null
        }
      })

      const response = {
        portfolioReturn,
        totalPnl,
        winRate,
        sharpeRatio: null, // TODO: Calculate from daily returns
        maxDrawdown: null, // TODO: Calculate from equity curve
        totalTrades,
        activeBots,
        lastUpdated: new Date()
      }
      
      console.log('[metrics] Returning portfolio summary:', response)
      return reply.send(response)
    } catch (error) {
      console.error('[metrics] Error fetching portfolio summary:', error)
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/metrics/portfolio/attribution
  app.get('/portfolio/attribution', async (request, reply) => {
    try {
      const userId = STUB_USER_ID // TODO: Replace with actual auth
      const { period = '30d' } = request.query

      // Calculate period dates
      const days = parseInt(period.replace('d', ''))
      const endDate = new Date()
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000)

      const attribution = await calculateAttribution(prisma, userId, { startDate, endDate })
      
      // Format for UI
      const formatted = formatAttributionForUI(attribution)

      return reply.send(formatted)
    } catch (error) {
      console.error('[metrics] Error fetching portfolio attribution:', error)
      return reply.code(500).send({ error: error.message })
    }
  })

  // POST /api/metrics/refresh/:templateId
  app.post('/refresh/:templateId', async (request, reply) => {
    try {
      const { templateId } = request.params
      
      // Mark template as dirty for nightly processing
      await metricsService.markTemplateDirty(templateId)
      
      // Optionally trigger immediate refresh for development
      if (process.env.NODE_ENV === 'development') {
        await metricsService.refreshTemplateCurrent(templateId)
      }

      return reply.send({ 
        message: 'Template marked for refresh',
        templateId 
      })
    } catch (error) {
      console.error('[metrics] Error refreshing template:', error)
      return reply.code(500).send({ error: error.message })
    }
  })

  // POST /api/metrics/nightly (internal endpoint)
  app.post('/nightly', async (request, reply) => {
    try {
      // Only allow internal calls
      const apiKey = request.headers['x-api-key']
      if (apiKey !== process.env.METRICS_API_KEY) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      await metricsService.nightlyMetricRecalculation()
      
      return reply.send({ message: 'Nightly recalculation completed' })
    } catch (error) {
      console.error('[metrics] Error in nightly recalculation:', error)
      return reply.code(500).send({ error: error.message })
    }
  })
}

// Helper functions
function getQualityMessage(quality) {
  const messages = {
    insufficient_data: 'Not enough data yet',
    new_template: 'New template - building track record',
    sample_size_low: 'Limited user base',
    insufficient_trades: 'Not enough trades',
    volatile: 'High volatility - use caution',
    sufficient: null
  }
  return messages[quality] || 'Unknown data quality'
}

function calculateSimpleReturn(executions) {
  if (executions.length === 0) return 0
  
  // Simple return: total PnL / initial capital assumption
  // TODO: Implement proper time-weighted return
  const totalPnl = executions.reduce((sum, e) => sum + Number(e.pnl || 0), 0)
  const totalValue = executions.reduce((sum, e) => sum + (Number(e.quantity) * Number(e.price)), 0)
  
  return totalValue > 0 ? (totalPnl / totalValue) * 100 : 0
}

async function calculateAttribution(prisma, userId, period) {
  const facts = await prisma.tradeMetricFact.findMany({
    where: {
      userId,
      date: { gte: period.startDate, lte: period.endDate },
      eventType: 'fill' // Only trades, not cash flows
    }
  })
  
  // Group by decision source
  const attribution = facts.reduce((acc, fact) => {
    const key = `${fact.sourceType}:${fact.sourceId || 'null'}`
    acc[key] = acc[key] || {
      sourceType: fact.sourceType,
      sourceId: fact.sourceId,
      pnl: 0,
      trades: 0,
      wins: 0
    }
    
    acc[key].pnl += Number(fact.pnl)
    acc[key].trades += 1
    if (fact.isWin) acc[key].wins += 1
    
    return acc
  }, {})
  
  // Resolve source names and calculate percentages
  const totalPnl = Object.values(attribution).reduce((sum, a) => sum + a.pnl, 0)
  const results = await Promise.all(Object.values(attribution).map(async a => {
    let sourceName = 'Unknown'
    
    // Resolve name at query time, not stored
    if (a.sourceType === 'TEMPLATE' && a.sourceId) {
      const template = await prisma.botTemplate.findUnique({ where: { id: a.sourceId } })
      sourceName = template?.name || 'Unknown Template'
    } else if (a.sourceType === 'MANUAL') {
      sourceName = 'Manual Trades'
    } else if (a.sourceType === 'CUSTOM_RULE' && a.sourceId) {
      sourceName = 'Custom Rules'
    }
    
    return {
      ...a,
      sourceName,
      contribution: totalPnl !== 0 ? (a.pnl / totalPnl) * 100 : 0,
      winRate: a.trades > 0 ? (a.wins / a.trades) * 100 : 0
    }
  }))
  
  return results
}

function formatAttributionForUI(attribution, totalReturn = 0) {
  const knownSources = attribution.filter(a => a.sourceType !== 'UNKNOWN')
  const unknownPnl = attribution.find(a => a.sourceType === 'UNKNOWN')?.pnl || 0
  
  // Attribution donut only shows known sources
  const attributionData = knownSources.map(a => ({
    name: a.sourceName,
    value: a.contribution,
    pnl: a.pnl,
    trades: a.trades,
    winRate: a.winRate
  }))
  
  // Sort by contribution
  attributionData.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
  
  return {
    attribution: attributionData,
    totalReturn,
    hasUnknownData: unknownPnl !== 0,
    unknownPnl,
    message: unknownPnl !== 0 ? 'Unclassified trades excluded from attribution breakdown' : null
  }
}
