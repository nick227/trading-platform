import prisma from '../loaders/prisma.js'
import { STUB_USER_ID } from '../utils/auth.js'

export default async function performanceRoutes(app, opts) {
  // GET /api/performance/stats
  app.get('/stats', async (request, reply) => {
    try {
      return reply.send(await calculatePerformanceStats())
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/performance/today
  app.get('/today', async (request, reply) => {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const executions = await prisma.execution.findMany({
        where: {
          userId:    STUB_USER_ID,
          createdAt: { gte: today }
        }
      })

      const totalPnL      = executions.reduce((sum, e) => sum + Number(e.pnl ?? 0), 0)
      const winningTrades = executions.filter(e => Number(e.pnl ?? 0) > 0).length

      return reply.send({
        pnl:          totalPnL,
        trades:       executions.length,
        winningTrades,
        winRate:      executions.length > 0 ? (winningTrades / executions.length) * 100 : 0
      })
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/performance/daily-snapshots
  app.get('/daily-snapshots', async (request, reply) => {
    try {
      const snapshots = await prisma.dailySnapshot.findMany({
        orderBy: { snapshotDate: 'desc' },
        take:    30
      })
      return reply.send(snapshots)
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })
}

async function calculatePerformanceStats() {
  const executions = await prisma.execution.findMany({
    where:   { userId: STUB_USER_ID },
    orderBy: { createdAt: 'desc' }
  })

  const totalTrades   = executions.length
  const pnls          = executions.map(e => Number(e.pnl ?? 0))
  const winningTrades = pnls.filter(p => p > 0).length
  const totalPnL      = pnls.reduce((s, p) => s + p, 0)

  // Most traded asset
  const tickerCounts = {}
  for (const e of executions) {
    tickerCounts[e.ticker] = (tickerCounts[e.ticker] ?? 0) + 1
  }
  const entries = Object.entries(tickerCounts)
  const mostTradedAsset = entries.length > 0
    ? entries.reduce((a, b) => (a[1] >= b[1] ? a : b))[0]
    : '—'

  // Average hold time in minutes (submission → fill), filled trades only
  const filled = executions.filter(e => e.filledAt && e.submittedAt)
  const avgHoldTime = filled.length > 0
    ? filled.reduce((sum, e) => sum + (e.filledAt - e.submittedAt) / 60000, 0) / filled.length
    : 0

  return {
    total_trades:       totalTrades,
    win_rate:           totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
    total_pnl:          totalPnL,
    most_traded_asset:  mostTradedAsset,
    avg_hold_time:      Math.round(avgHoldTime * 10) / 10,
    winning_trades:     winningTrades,
    losing_trades:      totalTrades - winningTrades
  }
}
