import prisma from '../loaders/prisma.js'

class MetricsService {
  // Event-driven: Process execution fill immediately
  async processExecutionFill(execution) {
    try {
      // 1. Write trade fact (append-only)
      await this.insertTradeFact(execution)
      
      // 2. Update simple aggregates immediately
      await this.updateTemplateSimpleMetrics(execution.templateId, {
        tradeCount: 1,
        totalPnl: Number(execution.pnl) || 0,
        isWin: Number(execution.pnl) > 0
      })
      
      // 3. Mark template dirty for nightly complex calculations
      await this.markTemplateDirty(execution.templateId)
      
      // 4. Update watermark
      await this.updateWatermark('template', execution.id)
      
      console.log(`[metrics] Processed execution fill: ${execution.id}`)
    } catch (error) {
      console.error(`[metrics] Error processing execution fill ${execution.id}:`, error)
      throw error
    }
  }

  // Insert trade fact from execution
  async insertTradeFact(execution) {
    // Calculate return percentage and other metrics
    const returnPct = execution.price > 0 ? ((execution.filledPrice - execution.price) / execution.price) * 100 : 0
    const holdingMinutes = execution.filledAt && execution.submittedAt 
      ? Math.floor((execution.filledAt - execution.submittedAt) / (1000 * 60))
      : 0

    const fact = {
      date: execution.filledAt || new Date(),
      userId: execution.userId,
      botId: execution.botId,
      templateId: execution.templateId,
      sourceExecutionId: execution.id,
      eventType: 'fill',
      sourceType: execution.sourceType || 'UNKNOWN',
      sourceId: execution.sourceId,
      pnl: execution.pnl,
      returnPct: returnPct,
      isWin: Number(execution.pnl) > 0,
      capitalUsed: execution.quantity * execution.price,
      holdingMinutes,
      direction: execution.direction,
      ticker: execution.ticker,
      quantity: execution.quantity,
      entryPrice: execution.price,
      exitPrice: execution.filledPrice,
      dailyEquityReturn: 0, // Will be calculated in nightly job
      allocatedCapital: execution.quantity * execution.price,
      portfolioValue: null, // Will be set by cash flow events
      processed: false
    }

    await prisma.tradeMetricFact.create({ data: fact })
  }

  // Update simple template metrics immediately
  async updateTemplateSimpleMetrics(templateId, changes) {
    if (!templateId) return

    const current = await prisma.templateMetricCurrent.findUnique({
      where: { templateId }
    })

    if (current) {
      // Update existing
      const updates = {
        totalTrades: current.totalTrades + (changes.tradeCount || 0),
        totalPnl: Number(current.totalPnl) + changes.totalPnl,
        winningTrades: changes.isWin ? current.winningTrades + 1 : current.winningTrades,
        lastUpdated: new Date()
      }

      // Recalculate win rate
      updates.winRate = updates.totalTrades > 0 ? (updates.winningTrades / updates.totalTrades) * 100 : 0

      await prisma.templateMetricCurrent.update({
        where: { templateId },
        data: updates
      })
    } else {
      // Create new record
      await prisma.templateMetricCurrent.create({
        data: {
          templateId,
          totalTrades: changes.tradeCount || 0,
          totalPnl: changes.totalPnl,
          winningTrades: changes.isWin ? 1 : 0,
          winRate: changes.isWin ? 100 : 0,
          dataQuality: 'insufficient_data',
          lastUpdated: new Date()
        }
      })
    }
  }

  // Mark template as dirty for nightly processing
  async markTemplateDirty(templateId) {
    if (!templateId) return

    await prisma.metricWatermark.upsert({
      where: { metricType: 'template' },
      update: { isDirty: true },
      create: {
        metricType: 'template',
        isDirty: true
      }
    })
  }

  // Update watermark
  async updateWatermark(metricType, lastProcessedId) {
    await prisma.metricWatermark.upsert({
      where: { metricType },
      update: {
        lastProcessedId,
        lastProcessedAt: new Date()
      },
      create: {
        metricType,
        lastProcessedId,
        lastProcessedAt: new Date()
      }
    })
  }

  // Nightly complex calculations
  async nightlyMetricRecalculation() {
    console.log('[metrics] Starting nightly metric recalculation...')
    
    try {
      // Get dirty watermark
      const watermark = await prisma.metricWatermark.findUnique({
        where: { metricType: 'template' }
      })

      if (!watermark?.isDirty) {
        console.log('[metrics] No dirty templates to process')
        return
      }

      // Get all templates that need recalculation
      const dirtyTemplates = await prisma.templateMetricCurrent.findMany({
        where: {
          lastUpdated: {
            lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // Older than 24h
          }
        },
        select: { templateId: true }
      })

      console.log(`[metrics] Processing ${dirtyTemplates.length} templates`)

      for (const { templateId } of dirtyTemplates) {
        await this.refreshTemplateCurrent(templateId)
      }

      // Clear dirty flag
      await prisma.metricWatermark.update({
        where: { metricType: 'template' },
        data: { isDirty: false }
      })

      console.log('[metrics] ✅ Nightly recalculation completed')
    } catch (error) {
      console.error('[metrics] ❌ Error in nightly recalculation:', error)
      throw error
    }
  }

  // Refresh template current metrics
  async refreshTemplateCurrent(templateId) {
    try {
      // Get last 365 days of data
      const last365Days = await prisma.tradeMetricFact.findMany({
        where: {
          templateId,
          date: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
          eventType: 'fill'
        },
        orderBy: { date: 'asc' }
      })

      if (last365Days.length === 0) {
        console.log(`[metrics] No data for template ${templateId}`)
        return
      }

      // Calculate rolling metrics
      const totalTrades = last365Days.length
      const winningTrades = last365Days.filter(f => f.isWin).length
      const totalPnl = last365Days.reduce((sum, f) => sum + Number(f.pnl), 0)
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0

      // Calculate annualized return (simplified)
      const avgDailyReturn = last365Days.reduce((sum, f) => sum + Number(f.returnPct), 0) / last365Days.length
      const annualReturn = avgDailyReturn * 252

      // Calculate Sharpe ratio (simplified)
      const returns = last365Days.map(f => Number(f.returnPct))
      const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
      const stdDev = Math.sqrt(variance)
      const sharpeRatio = stdDev > 0 ? (meanReturn * 252) / (stdDev * Math.sqrt(252)) : 0

      // Determine data quality
      const dataQuality = this.assessDataQuality(last365Days)

      // Update current metrics
      await prisma.templateMetricCurrent.upsert({
        where: { templateId },
        update: {
          totalTrades,
          winningTrades,
          totalPnl,
          annualReturn,
          winRate,
          sharpeRatio,
          dataQuality,
          lastUpdated: new Date()
        },
        create: {
          templateId,
          totalTrades,
          winningTrades,
          totalPnl,
          annualReturn,
          winRate,
          sharpeRatio,
          dataQuality,
          lastUpdated: new Date()
        }
      })

      console.log(`[metrics] ✅ Refreshed template ${templateId}`)
    } catch (error) {
      console.error(`[metrics] Error refreshing template ${templateId}:`, error)
    }
  }

  // Assess data quality
  assessDataQuality(dailyData) {
    const totalDays = dailyData.length
    const activeUsers = new Set(dailyData.map(d => d.userId)).size
    const totalTrades = dailyData.reduce((sum, d) => sum + 1, 0)
    
    if (totalDays < 30) return 'insufficient_data'
    if (activeUsers < 3) return 'sample_size_low'
    if (totalTrades < 50) return 'insufficient_trades'
    if (this.isVolatile(dailyData)) return 'volatile'
    if (totalDays < 90) return 'new_template'
    
    return 'sufficient'
  }

  // Check volatility
  isVolatile(dailyData) {
    const returns = dailyData.map(d => Number(d.returnPct)).filter(r => r !== 0)
    if (returns.length < 10) return false
    
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
    const stdDev = Math.sqrt(variance)
    
    return stdDev > 0.05 // 5% daily volatility threshold
  }
}

export default new MetricsService()
