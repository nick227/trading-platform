import prisma from '../loaders/prisma.js'
import {
  divMicros,
  microsTo4Decimals,
  microsToDollars,
  mulMicros,
  toMicros
} from '../domain/money.js'

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

  const openLotsByTicker = new Map() // ticker -> FIFO lots (exact BigInt micro-units)
  const lotHeads = new Map() // ticker -> first unconsumed lot index
  const perExecutionPnl = new Map()  // executionId -> realizedPnl
  // Closed trades = sells that closed attributable lots; a win realized a positive P/L.
  let closedTrades = 0
  let winningTrades = 0
  let realizedPnlMicrosTotal = 0n
  let realizedNetMicrosTotal = 0n
  let totalFeesMicros = 0n
  const unattributedSellQtyMicros = {}

  for (const exec of sorted) {
    const ticker = String(exec.ticker).toUpperCase()
    const dir = String(exec.direction).toLowerCase()
    const qtyMicros = toMicros(exec.filledQuantity)
    const priceMicros = toMicros(exec.filledPrice)
    const feeMicros = toMicros(exec.fees ?? 0) + toMicros(exec.commission ?? 0)
    totalFeesMicros += feeMicros

    if (!openLotsByTicker.has(ticker)) {
      openLotsByTicker.set(ticker, [])
      lotHeads.set(ticker, 0)
    }
    const lots = openLotsByTicker.get(ticker)

    if (dir === 'buy') {
      lots.push({
        id: exec.id,
        remainingQtyMicros: qtyMicros,
        priceMicros,
        feePerShareMicros: qtyMicros > 0n ? divMicros(feeMicros, qtyMicros) : 0n,
        filledAt: exec.filledAt || exec.createdAt
      })
      if (exec.id) {
        perExecutionPnl.set(exec.id, 0)
      }
    } else if (dir === 'sell') {
      let remainingToSellMicros = qtyMicros
      let fillRealizedPnlMicros = 0n
      let matchedBuyFeesMicros = 0n

      let head = lotHeads.get(ticker)
      while (remainingToSellMicros > 0n && head < lots.length) {
        const lot = lots[head]
        const matchQtyMicros = remainingToSellMicros < lot.remainingQtyMicros
          ? remainingToSellMicros
          : lot.remainingQtyMicros
        const pnlChunkMicros = mulMicros(matchQtyMicros, priceMicros - lot.priceMicros)
        fillRealizedPnlMicros += pnlChunkMicros
        matchedBuyFeesMicros += mulMicros(matchQtyMicros, lot.feePerShareMicros || 0n)
        remainingToSellMicros -= matchQtyMicros
        lot.remainingQtyMicros -= matchQtyMicros

        if (lot.remainingQtyMicros <= 0n) {
          head += 1
        }
      }
      if (head >= 64 && head * 2 >= lots.length) {
        lots.splice(0, head)
        head = 0
      }
      lotHeads.set(ticker, head)

      if (remainingToSellMicros > 0n) {
        unattributedSellQtyMicros[ticker] = (unattributedSellQtyMicros[ticker] ?? 0n) + remainingToSellMicros
      }

      if (qtyMicros - remainingToSellMicros > 0n) {
        closedTrades += 1
        if (fillRealizedPnlMicros > 0n) winningTrades += 1
      }

      realizedPnlMicrosTotal += fillRealizedPnlMicros
      realizedNetMicrosTotal += fillRealizedPnlMicros - matchedBuyFeesMicros - feeMicros
      if (exec.id) {
        perExecutionPnl.set(exec.id, microsToDollars(fillRealizedPnlMicros))
      }
    }
  }

  // Calculate open positions and capital in use using exact BigInt micro-units
  const openPositions = {}
  let totalCapitalInUseMicros = 0n
  let allValuationsAvailable = true
  let totalUnrealizedPnlMicros = 0n

  for (const [ticker, lots] of openLotsByTicker.entries()) {
    const head = lotHeads.get(ticker)
    const remainingLots = lots.slice(head).filter(l => l.remainingQtyMicros > 0n)
    if (remainingLots.length === 0) continue

    const totalQtyMicros = remainingLots.reduce((sum, l) => sum + l.remainingQtyMicros, 0n)
    const totalCostMicros = remainingLots.reduce((sum, l) => sum + mulMicros(l.remainingQtyMicros, l.priceMicros), 0n)
    const avgPriceMicros = totalQtyMicros > 0n ? divMicros(totalCostMicros, totalQtyMicros) : 0n

    totalCapitalInUseMicros += totalCostMicros

    const pos = {
      ticker,
      quantity: microsTo4Decimals(totalQtyMicros),
      costBasis: microsToDollars(totalCostMicros),
      avgPrice: microsTo4Decimals(avgPriceMicros),
      lots: remainingLots.map(l => ({
        id: l.id,
        remainingQty: microsTo4Decimals(l.remainingQtyMicros),
        price: microsTo4Decimals(l.priceMicros),
        filledAt: l.filledAt
      }))
    }

    const currentPriceRaw = currentPrices?.[ticker]
    const currentPrice = currentPriceRaw !== undefined && currentPriceRaw !== null ? Number(currentPriceRaw) : null
    if (currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0) {
      const currentPriceMicros = toMicros(currentPrice)
      const unrealizedMicros = mulMicros(totalQtyMicros, currentPriceMicros) - totalCostMicros
      totalUnrealizedPnlMicros += unrealizedMicros
      pos.currentPrice = currentPrice
      pos.unrealizedPnl = microsToDollars(unrealizedMicros)
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
    totalPnl = microsToDollars(realizedPnlMicrosTotal)
  } else if (allValuationsAvailable) {
    unrealizedPnl = microsToDollars(totalUnrealizedPnlMicros)
    totalPnl = microsToDollars(realizedPnlMicrosTotal + totalUnrealizedPnlMicros)
  } else {
    unrealizedPnl = null
    totalPnl = null
  }

  const performance = {
    realizedPnl: microsToDollars(realizedPnlMicrosTotal),
    unrealizedPnl,
    totalPnl,
    fees: microsToDollars(totalFeesMicros),
    closedTrades,
    winningTrades,
    winRate: closedTrades > 0 ? Number((winningTrades / closedTrades).toFixed(4)) : null,
    asOf: new Date().toISOString()
  }

  return {
    hasFills: true,
    performance,
    capitalInUse: microsToDollars(totalCapitalInUseMicros),
    openPositions,
    perExecutionPnl,
    fillCount: sorted.length,
    realizedPnlNetOfFees: microsToDollars(realizedNetMicrosTotal),
    unattributedSellQuantity: Object.fromEntries(
      Object.entries(unattributedSellQtyMicros).map(([t, q]) => [t, microsTo4Decimals(q)])
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
