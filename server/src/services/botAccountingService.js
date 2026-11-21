import prisma from '../loaders/prisma.js'

/**
 * Pure FIFO accounting engine for trade executions.
 * Tracks lots, open positions, capital in use, realized P/L and unrealized P/L.
 *
 * @param {Array<Object>} executions - Execution records
 * @param {Object} [options]
 * @param {Object} [options.currentPrices] - Map of ticker -> price for open position valuation
 * @returns {Object}
 */
export function calculateFifoAccounting(executions, { currentPrices = {} } = {}) {
  if (!Array.isArray(executions) || executions.length === 0) {
    return {
      hasFills: false,
      performance: null,
      capitalInUse: null,
      openPositions: {},
      perExecutionPnl: new Map(),
      fillCount: 0
    }
  }

  // Filter to valid fills
  const validFills = executions.filter((exec) => {
    if (!exec) return false
    const status = String(exec.status ?? 'filled').toLowerCase()
    const isFillStatus = status === 'filled' || status === 'partially_filled'
    const qty = Number(exec.filledQuantity ?? exec.quantity ?? 0)
    const price = Number(exec.filledPrice ?? exec.price ?? 0)
    const dir = String(exec.direction ?? '').toLowerCase()
    return isFillStatus && qty > 0 && price > 0 && (dir === 'buy' || dir === 'sell')
  })

  if (validFills.length === 0) {
    return {
      hasFills: false,
      performance: null,
      capitalInUse: null,
      openPositions: {},
      perExecutionPnl: new Map(),
      fillCount: 0
    }
  }

  // Sort chronologically
  const sorted = [...validFills].sort((a, b) => {
    const timeA = new Date(a.filledAt || a.createdAt || 0).getTime()
    const timeB = new Date(b.filledAt || b.createdAt || 0).getTime()
    if (timeA !== timeB) return timeA - timeB
    return String(a.id || '').localeCompare(String(b.id || ''))
  })

  const openLotsByTicker = new Map() // ticker -> Array<{ id, remainingQty, price, filledAt }>
  const perExecutionPnl = new Map()  // executionId -> realizedPnl
  let realizedPnlTotal = 0
  let totalFees = 0

  for (const exec of sorted) {
    const ticker = String(exec.ticker).toUpperCase()
    const dir = String(exec.direction).toLowerCase()
    const qty = Number(exec.filledQuantity ?? exec.quantity)
    const price = Number(exec.filledPrice ?? exec.price)
    const fee = Number(exec.fees ?? 0) + Number(exec.commission ?? 0)
    totalFees += fee

    if (!openLotsByTicker.has(ticker)) {
      openLotsByTicker.set(ticker, [])
    }
    const lots = openLotsByTicker.get(ticker)

    if (dir === 'buy') {
      lots.push({
        id: exec.id,
        remainingQty: qty,
        price,
        filledAt: exec.filledAt || exec.createdAt
      })
      if (exec.id) {
        perExecutionPnl.set(exec.id, 0)
      }
    } else if (dir === 'sell') {
      let remainingToSell = qty
      let fillRealizedPnl = 0

      while (remainingToSell > 1e-7 && lots.length > 0) {
        const lot = lots[0]
        const matchQty = Math.min(remainingToSell, lot.remainingQty)
        const pnlChunk = matchQty * (price - lot.price)
        fillRealizedPnl += pnlChunk
        remainingToSell -= matchQty
        lot.remainingQty -= matchQty

        if (lot.remainingQty <= 1e-7) {
          lots.shift()
        }
      }

      realizedPnlTotal += fillRealizedPnl
      if (exec.id) {
        perExecutionPnl.set(exec.id, Number(fillRealizedPnl.toFixed(2)))
      }
    }
  }

  // Calculate open positions and capital in use
  const openPositions = {}
  let totalCapitalInUse = 0
  let allValuationsAvailable = true
  let totalUnrealizedPnl = 0

  for (const [ticker, lots] of openLotsByTicker.entries()) {
    const remainingLots = lots.filter(l => l.remainingQty > 1e-7)
    if (remainingLots.length === 0) continue

    const totalQty = remainingLots.reduce((sum, l) => sum + l.remainingQty, 0)
    const totalCost = remainingLots.reduce((sum, l) => sum + (l.remainingQty * l.price), 0)
    const avgPrice = totalQty > 0 ? totalCost / totalQty : 0

    totalCapitalInUse += totalCost

    const pos = {
      ticker,
      quantity: Number(totalQty.toFixed(4)),
      costBasis: Number(totalCost.toFixed(2)),
      avgPrice: Number(avgPrice.toFixed(4)),
      lots: remainingLots.map(l => ({
        id: l.id,
        remainingQty: Number(l.remainingQty.toFixed(4)),
        price: l.price,
        filledAt: l.filledAt
      }))
    }

    const currentPriceRaw = currentPrices?.[ticker]
    const currentPrice = currentPriceRaw !== undefined && currentPriceRaw !== null ? Number(currentPriceRaw) : null
    if (currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0) {
      const unrealized = totalQty * (currentPrice - avgPrice)
      totalUnrealizedPnl += unrealized
      pos.currentPrice = currentPrice
      pos.unrealizedPnl = Number(unrealized.toFixed(2))
    } else {
      allValuationsAvailable = false
      pos.currentPrice = null
      pos.unrealizedPnl = null
    }

    openPositions[ticker] = pos
  }

  const hasOpenPositions = Object.keys(openPositions).length > 0
  let unrealizedPnl = null
  let totalPnl = null

  if (!hasOpenPositions) {
    unrealizedPnl = 0
    totalPnl = Number(realizedPnlTotal.toFixed(2))
  } else if (allValuationsAvailable) {
    unrealizedPnl = Number(totalUnrealizedPnl.toFixed(2))
    totalPnl = Number((realizedPnlTotal + unrealizedPnl).toFixed(2))
  } else {
    unrealizedPnl = null
    totalPnl = null
  }

  const performance = {
    realizedPnl: Number(realizedPnlTotal.toFixed(2)),
    unrealizedPnl,
    totalPnl,
    fees: Number(totalFees.toFixed(2)),
    asOf: new Date().toISOString()
  }

  return {
    hasFills: true,
    performance,
    capitalInUse: Number(totalCapitalInUse.toFixed(2)),
    openPositions,
    perExecutionPnl,
    fillCount: sorted.length
  }
}

/**
 * Computes authoritative accounting for a bot from its persisted execution history.
 */
export async function computeBotAccounting(botId, { currentPrices = {}, prismaClient = prisma } = {}) {
  if (!botId) {
    return {
      hasFills: false,
      performance: null,
      capitalInUse: null,
      openPositions: {},
      perExecutionPnl: new Map(),
      fillCount: 0
    }
  }

  try {
    const fills = await prismaClient.execution.findMany({
      where: {
        botId,
        status: { in: ['filled', 'partially_filled'] },
        filledQuantity: { gt: 0 },
        filledPrice: { gt: 0 }
      },
      orderBy: [
        { filledAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' }
      ]
    })

    return calculateFifoAccounting(fills, { currentPrices })
  } catch (err) {
    return {
      hasFills: false,
      performance: null,
      capitalInUse: null,
      openPositions: {},
      perExecutionPnl: new Map(),
      fillCount: 0
    }
  }
}

/**
 * Calculates realized P/L for an execution fill against prior fills of the same bot.
 */
export async function calculateFillPnl({ execution, fillPrice, fillQty, prismaClient = prisma }) {
  if (!execution) return 0
  const dir = String(execution.direction ?? '').toLowerCase()
  if (dir !== 'sell') return 0
  if (!execution.botId) return 0

  try {
    const priorFills = await prismaClient.execution.findMany({
      where: {
        botId: execution.botId,
        status: { in: ['filled', 'partially_filled'] },
        id: { not: execution.id },
        filledQuantity: { gt: 0 },
        filledPrice: { gt: 0 }
      },
      orderBy: [
        { filledAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' }
      ]
    })

    const syntheticCurrent = {
      ...execution,
      status: 'filled',
      filledPrice: Number(fillPrice),
      filledQuantity: Number(fillQty),
      filledAt: new Date()
    }

    const accounting = calculateFifoAccounting([...priorFills, syntheticCurrent])
    return accounting.perExecutionPnl.get(execution.id) ?? 0
  } catch {
    return 0
  }
}

export default {
  calculateFifoAccounting,
  computeBotAccounting,
  calculateFillPnl
}
