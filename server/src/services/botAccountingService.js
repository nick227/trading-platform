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

  // Only broker-reported fills count: filledQuantity/filledPrice are written from broker
  // snapshots (cumulative per order, so repeated updates never double-count). Status is
  // deliberately ignored — a canceled/expired order can carry a real partial fill — and the
  // intended quantity/price are never used as a stand-in for a fill.
  const validFills = executions.filter(isBrokerFill)

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

  const openLotsByTicker = new Map() // ticker -> FIFO lots
  const lotHeads = new Map() // ticker -> first unconsumed lot index
  const perExecutionPnl = new Map()  // executionId -> realizedPnl
  // Closed trades = sells that closed attributable lots; a win realized a positive P/L.
  let closedTrades = 0
  let winningTrades = 0
  let realizedPnlTotal = 0
  let realizedNetTotal = 0
  let totalFees = 0
  const unattributedSellQty = {}

  for (const exec of sorted) {
    const ticker = String(exec.ticker).toUpperCase()
    const dir = String(exec.direction).toLowerCase()
    const qty = Number(exec.filledQuantity)
    const price = Number(exec.filledPrice)
    const fee = Number(exec.fees ?? 0) + Number(exec.commission ?? 0)
    totalFees += fee

    if (!openLotsByTicker.has(ticker)) {
      openLotsByTicker.set(ticker, [])
      lotHeads.set(ticker, 0)
    }
    const lots = openLotsByTicker.get(ticker)

    if (dir === 'buy') {
      lots.push({
        id: exec.id,
        remainingQty: qty,
        price,
        feePerShare: fee / qty,
        filledAt: exec.filledAt || exec.createdAt
      })
      if (exec.id) {
        perExecutionPnl.set(exec.id, 0)
      }
    } else if (dir === 'sell') {
      let remainingToSell = qty
      let fillRealizedPnl = 0
      let matchedBuyFees = 0

      // FIFO head avoids O(n) Array.shift() on every consumed lot.
      // Periodic compaction bounds retention of closed-lot objects.
      let head = lotHeads.get(ticker)
      while (remainingToSell > 1e-7 && head < lots.length) {
        const lot = lots[head]
        const matchQty = Math.min(remainingToSell, lot.remainingQty)
        const pnlChunk = matchQty * (price - lot.price)
        fillRealizedPnl += pnlChunk
        matchedBuyFees += matchQty * (lot.feePerShare || 0)
        remainingToSell -= matchQty
        lot.remainingQty -= matchQty

        if (lot.remainingQty <= 1e-7) {
          head += 1
        }
      }
      // Amortized compaction: do not keep an unbounded prefix of closed lots.
      if (head >= 64 && head * 2 >= lots.length) {
        lots.splice(0, head)
        head = 0
      }
      lotHeads.set(ticker, head)

      // Never invent a short: quantity sold beyond attributable lots realizes nothing
      // and is reported so the mismatch is visible.
      if (remainingToSell > 1e-7) {
        unattributedSellQty[ticker] = (unattributedSellQty[ticker] ?? 0) + remainingToSell
      }

      if (qty - remainingToSell > 1e-7) {
        closedTrades += 1
        if (fillRealizedPnl > 1e-9) winningTrades += 1
      }

      realizedPnlTotal += fillRealizedPnl
      // Net of the sell's own fees and the buy fees of the shares it closed.
      realizedNetTotal += fillRealizedPnl - matchedBuyFees - fee
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
    // Closed FIFO prefix has already been consumed; do not traverse it.
    const head = lotHeads.get(ticker)
    const remainingLots = lots.slice(head).filter(l => l.remainingQty > 1e-7)
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
    closedTrades,
    winningTrades,
    winRate: closedTrades > 0 ? Number((winningTrades / closedTrades).toFixed(4)) : null,
    asOf: new Date().toISOString()
  }

  return {
    hasFills: true,
    performance,
    capitalInUse: Number(totalCapitalInUse.toFixed(2)),
    openPositions,
    perExecutionPnl,
    fillCount: sorted.length,
    // Realized P/L after the fees of the sells and of the buy lots they closed.
    realizedPnlNetOfFees: Number(realizedNetTotal.toFixed(2)),
    unattributedSellQuantity: Object.fromEntries(
      Object.entries(unattributedSellQty).map(([t, q]) => [t, Number(q.toFixed(4))])
    )
  }
}

/** A broker-reported fill: positive filled quantity and price, buy or sell. */
export function isBrokerFill(exec) {
  if (!exec) return false
  const qty = Number(exec.filledQuantity)
  const price = Number(exec.filledPrice)
  const dir = String(exec.direction ?? '').toLowerCase()
  return Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0 && (dir === 'buy' || dir === 'sell')
}

/** Realized P/L of sells filled at or after `since` (FIFO against the full history). */
export function realizedPnlSince(executions, since) {
  const accounting = calculateFifoAccounting(executions)
  if (!accounting.hasFills) return 0
  const sinceMs = new Date(since).getTime()
  let total = 0
  for (const exec of executions) {
    if (!isBrokerFill(exec) || String(exec.direction).toLowerCase() !== 'sell') continue
    const at = new Date(exec.filledAt || exec.createdAt || 0).getTime()
    if (at >= sinceMs) total += accounting.perExecutionPnl.get(exec.id) ?? 0
  }
  return Number(total.toFixed(2))
}

const BROKER_FILL_WHERE = { filledQuantity: { gt: 0 }, filledPrice: { gt: 0 } }

/** All broker-reported fills for a bot, oldest first. */
export async function loadBotFills(botId, { prismaClient = prisma, excludeExecutionId = null } = {}) {
  return prismaClient.execution.findMany({
    where: {
      botId,
      ...BROKER_FILL_WHERE,
      ...(excludeExecutionId ? { id: { not: excludeExecutionId } } : {})
    },
    orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
  })
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
    const fills = await loadBotFills(botId, { prismaClient })
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
    const priorFills = await loadBotFills(execution.botId, { prismaClient, excludeExecutionId: execution.id })

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
  calculateFillPnl,
  isBrokerFill,
  realizedPnlSince,
  loadBotFills
}
