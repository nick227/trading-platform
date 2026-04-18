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
    dailyExecutionAggregate,
    activeCount,
    symbolExecutions,
    dailyFilledExecutions
  ] = await Promise.all([
    prisma.execution.aggregate({
      where: {
        userId: execution.userId,
        createdAt: { gte: dayStart }
      },
      _count: true,
      _sum: {
        quantity: true,
        price: true
      }
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
        ticker: execution.ticker,
        status: 'filled'
      },
      select: {
        direction: true,
        filledPrice: true,
        filledQuantity: true,
        price: true,
        quantity: true
      }
    }),
    prisma.execution.findMany({
      where: {
        userId: execution.userId,
        status: 'filled',
        filledAt: { gte: dayStart }
      },
      select: {
        direction: true,
        filledPrice: true,
        filledQuantity: true,
        price: true,
        quantity: true
      }
    })
  ])

  const pendingNotional = execution.quantity * execution.price
  const dailyNotional = await getDailyNotional(execution.userId, dayStart)
  if (dailyNotional + pendingNotional > caps.maxDailyNotional) {
    return block('max_daily_notional', {
      cap: caps.maxDailyNotional,
      current: dailyNotional,
      attempted: pendingNotional
    })
  }

  if ((dailyExecutionAggregate._count ?? 0) >= caps.maxDailyExecutions) {
    return block('max_daily_executions', {
      cap: caps.maxDailyExecutions,
      current: dailyExecutionAggregate._count ?? 0
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

  const dailyPnl = dailyFilledExecutions.reduce((sum, row) => {
    const quantity = row.filledQuantity ?? row.quantity ?? 0
    const fillPrice = row.filledPrice ?? row.price ?? 0
    const signedNotional = quantity * fillPrice * (row.direction === 'sell' ? 1 : -1)
    return sum + signedNotional
  }, 0)
  if (dailyPnl <= (-1 * caps.maxDailyLoss)) {
    return block('max_daily_loss', {
      cap: caps.maxDailyLoss,
      current: Math.abs(dailyPnl)
    })
  }

  return { allowed: true }
}

async function getDailyNotional(userId, dayStart) {
  const rows = await prisma.execution.findMany({
    where: {
      userId,
      createdAt: { gte: dayStart }
    },
    select: {
      quantity: true,
      price: true
    }
  })

  return rows.reduce((sum, row) => sum + ((row.quantity ?? 0) * (row.price ?? 0)), 0)
}

function block(reason, metrics) {
  return {
    allowed: false,
    reason,
    metrics
  }
}
