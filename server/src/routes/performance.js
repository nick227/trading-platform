import prisma from '../loaders/prisma.js'
import { authenticate } from '../middleware/authenticate.js'
import { valueHistory } from '../services/portfolioValuationService.js'

export default async function performanceRoutes(app, opts) {
  // GET /api/performance/stats
  app.get('/stats', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      return reply.send(await calculatePerformanceStats(request.user.id))
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })

  // GET /api/performance/today
  app.get('/today', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const userId = request.user.id
      const executions = await prisma.execution.findMany({
        where: {
          userId,
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

  // GET /api/performance/daily-snapshots — the caller's own daily values only.
  // (The legacy DailySnapshot table is a single global account with no owner, so it is
  // never served to users.)
  app.get('/daily-snapshots', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const history = await valueHistory(request.user.id, { range: '1M' })
      return reply.send(
        history.points
          .filter((p) => p.value !== null)
          .reverse()
          .map((p) => ({ snapshotDate: p.date, equity: p.value, cash: p.cash, positionsValue: Number((p.value - p.cash).toFixed(2)) }))
      )
    } catch (error) {
      return reply.code(500).send({ error: error.message })
    }
  })
}

async function calculatePerformanceStats(userId) {
  if (!userId) {
    return {
      total_trades:       0,
      win_rate:           0,
      total_pnl:          0,
      most_traded_asset:  '—',
      avg_hold_time:      0,
      winning_trades:     0,
      losing_trades:      0
    }
  }

  const executions = await prisma.execution.findMany({
    where:   { userId },
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
