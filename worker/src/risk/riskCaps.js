import prisma from '../db/prisma.js'

const ACTIVE_EXECUTION_STATUSES = ['queued', 'processing', 'submitted', 'partially_filled']

function envNumber(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

const caps = {
  maxDailyNotional: envNumber('WORKER_MAX_DAILY_NOTIONAL_PER_USER', 250_000),
  maxDailyExecutions: envNumber('WORKER_MAX_DAILY_EXECUTIONS_PER_USER', 200),
  maxConcurrentActiveOrders: envNumber('WORKER_MAX_CONCURRENT_ACTIVE_ORDERS_PER_USER', 20),
  maxSymbolNotional: envNumber('WORKER_MAX_SYMBOL_NOTIONAL_PER_USER', 50_000),
  maxDailyLoss: envNumber('WORKER_MAX_DAILY_LOSS_PER_USER', 25_000)
}

export async function evaluateRiskCaps(execution) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)

  const [
    dailyRows,
    activeCount,
    dailyFilledExecutions
  ] = await Promise.all([
    // Fetch raw daily rows so we can compute both count and notional in one query.
    prisma.execution.findMany({
      where: { userId: execution.userId, createdAt: { gte: dayStart } },
      select: { quantity: true, price: true }
    }),
    prisma.execution.count({
      where: {
        userId: execution.userId,
        status: { in: ACTIVE_EXECUTION_STATUSES }
      }
    }),
    prisma.execution.findMany({
      where: {
        userId: execution.userId,
        status: 'filled',
        filledAt: { gte: dayStart }
      },
      select: {
        ticker: true,
        direction: true,
        filledPrice: true,
        filledQuantity: true,
        price: true,
        quantity: true
      }
    })
  ])

  // symbolExecutions is a strict subset of dailyFilledExecutions — filter in memory
  // rather than making a separate DB round-trip.
  const symbolExecutions = dailyFilledExecutions.filter(r => r.ticker === execution.ticker)

  const pendingNotional = execution.quantity * execution.price
  const dailyNotional = dailyRows.reduce((sum, r) => sum + (r.quantity ?? 0) * (r.price ?? 0), 0)
  if (dailyNotional + pendingNotional > caps.maxDailyNotional) {
    return block('max_daily_notional', {
      cap: caps.maxDailyNotional,
      current: dailyNotional,
      attempted: pendingNotional
    })
  }

  if (dailyRows.length >= caps.maxDailyExecutions) {
    return block('max_daily_executions', {
      cap: caps.maxDailyExecutions,
      current: dailyRows.length
    })
  }

  if (activeCount >= caps.maxConcurrentActiveOrders) {
    return block('max_concurrent_active_orders', {
      cap: caps.maxConcurrentActiveOrders,
      current: activeCount
    })
  }

  const currentSymbolNotional = symbolExecutions.reduce((sum, row) => {
    const quantity = row.filledQuantity ?? row.quantity ?? 0
    const fillPrice = row.filledPrice ?? row.price ?? 0
    return sum + (quantity * fillPrice)
  }, 0)
  if (currentSymbolNotional + pendingNotional > caps.maxSymbolNotional) {
    return block('max_symbol_notional', {
      cap: caps.maxSymbolNotional,
      current: currentSymbolNotional,
      attempted: pendingNotional
    })
  }

  // Net cash flow proxy: sell proceeds minus buy cost. Negative means more cash
  // spent buying than received from selling today. This is not realized P&L (no
  // cost-basis matching), but is a conservative risk signal: if it reaches
  // -maxDailyLoss the user has deployed at least that much capital net.
  const dailyNetCashFlow = dailyFilledExecutions.reduce((sum, row) => {
    const quantity = row.filledQuantity ?? row.quantity ?? 0
    const fillPrice = row.filledPrice ?? row.price ?? 0
    return sum + quantity * fillPrice * (row.direction === 'sell' ? 1 : -1)
  }, 0)
  if (dailyNetCashFlow <= (-1 * caps.maxDailyLoss)) {
    return block('max_daily_loss', {
      cap: caps.maxDailyLoss,
      current: Math.abs(dailyNetCashFlow)
    })
  }

  return { allowed: true }
}

function block(reason, metrics) {
  return {
    allowed: false,
    reason,
    metrics
  }
}
