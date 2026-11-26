/**
 * Authoritative, deterministic paper ledger reconstruction.
 * All cash movements come from persisted fills, never inferred from unrealized P&L.
 */
import { calculateFifoAccounting, isBrokerFill } from '../botAccountingService.js'

const money = value => Math.round((value + Number.EPSILON) * 100) / 100
const validNumber = value => value !== null && value !== undefined && Number.isFinite(Number(value))

export const STOCK_TRADER_ACTIVE_ORDER_STATUSES = Object.freeze([
  'queued', 'processing', 'submitted', 'partially_filled', 'needs_reconciliation'
])

export function reconcileStockTraderFills({
  fills,
  allocatedCapital,
  asOfSession,
  quotes = {},
  accountant = calculateFifoAccounting
}) {
  if (!Array.isArray(fills) || !validNumber(allocatedCapital) || Number(allocatedCapital) <= 0 ||
      typeof asOfSession !== 'string') {
    throw new Error('A complete paper fill ledger, capital, and as-of session are required')
  }
  const capital = Number(allocatedCapital)
  let cash = capital
  let totalFees = 0

  for (const fill of fills) {
    if (!isBrokerFill(fill) ||
        !fill.simSession || fill.simSession > asOfSession ||
        !validNumber(fill.fees ?? 0) || !validNumber(fill.commission ?? 0)) {
      throw new Error('Invalid or future-dated paper fill')
    }
    const qty = Number(fill.filledQuantity)
    const price = Number(fill.filledPrice)
    const fees = Number(fill.fees ?? 0) + Number(fill.commission ?? 0)
    if (fees < 0) throw new Error('Negative paper fees are invalid')
    const notional = qty * price
    cash += String(fill.direction).toLowerCase() === 'sell' ? notional : -notional
    cash -= fees
    totalFees += fees
  }

  const accounting = accountant(fills)
  if (!accounting || typeof accounting !== 'object') throw new Error('FIFO paper accounting unavailable')
  if (Object.values(accounting.unattributedSellQuantity ?? {}).some(q => Number(q) > 0)) {
    throw new Error('Paper sells exceed attributable holdings')
  }
  const realizedPnl = accounting.hasFills === false ? 0 : Number(accounting.performance?.realizedPnl)
  if (!Number.isFinite(realizedPnl)) throw new Error('FIFO realized paper P&L unavailable')

  const positions = []
  let marketValue = 0
  let unrealizedPnl = 0
  for (const [symbol, p] of Object.entries(accounting.openPositions ?? {})) {
    const quantity = Number(p.quantity)
    if (!(quantity > 0)) continue
    const averageCost = Number(p.avgPrice)
    const price = Number(quotes[symbol])
    if (!Number.isFinite(quantity) || !Number.isFinite(averageCost) || averageCost <= 0 ||
        !Number.isFinite(price) || price <= 0) {
      throw new Error(`Missing valid paper position mark: ${symbol}`)
    }
    const markedValue = quantity * price
    const gain = quantity * (price - averageCost)
    marketValue += markedValue
    unrealizedPnl += gain
    positions.push({
      symbol, quantity, averageCost,
      marketValue: money(markedValue),
      unrealizedPnl: money(gain)
    })
  }
  positions.sort((a, b) => a.symbol.localeCompare(b.symbol))
  if (cash < -0.01 || !Number.isFinite(cash)) throw new Error('Paper cash reconciliation failed')
  const equity = money(cash + marketValue)
  const expectedEquity = money(capital + realizedPnl + unrealizedPnl - totalFees)
  if (Math.abs(equity - expectedEquity) > 0.02) {
    throw new Error('Paper portfolio equity does not reconcile with FIFO results')
  }
  return {
    asOfSession,
    allocatedCapital: capital,
    cash: money(Math.max(0, cash)),
    totalEquity: equity,
    totalFees: money(totalFees),
    realizedPnl: money(realizedPnl),
    unrealizedPnl: money(unrealizedPnl),
    positions,
    fillCount: fills.length
  }
}

export function calculateStockTraderSessionRealizedPnl({
  fills, session, accountant = calculateFifoAccounting
}) {
  if (!Array.isArray(fills) || !/^\d{4}-\d{2}-\d{2}$/.test(session)) {
    throw new Error('Session and paper fills are required')
  }
  const before = fills.filter(f => f.simSession < session)
  const through = fills.filter(f => f.simSession <= session)
  if (fills.some(f => !f.simSession || !isBrokerFill(f))) {
    throw new Error('Cannot calculate daily P&L from invalid paper fills')
  }
  const net = xs => {
    const a = accountant(xs)
    if (a.hasFills === false) return 0
    if (!validNumber(a.realizedPnlNetOfFees)) {
      throw new Error('Net FIFO daily P&L unavailable')
    }
    return Number(a.realizedPnlNetOfFees)
  }
  return money(net(through) - net(before))
}

/** Only outstanding portions of active orders count as reserved. */
export function summarizeStockTraderReservations(orders) {
  if (!Array.isArray(orders)) throw new Error('Outstanding order records are required')
  const sells = new Map()
  const buys = new Map()
  let totalBuyNotional = 0
  for (const order of orders) {
    if (!STOCK_TRADER_ACTIVE_ORDER_STATUSES.includes(order.status)) continue
    const quantity = Number(order.quantity)
    const filled = Number(order.filledQuantity ?? 0)
    const price = Number(order.price)
    if (!Number.isFinite(quantity) || !Number.isFinite(filled) || !Number.isFinite(price) ||
        quantity < 0 || filled < 0 || filled > quantity || price <= 0) {
      throw new Error('Invalid active paper order reservation')
    }
    const remaining = quantity - filled
    const symbol = String(order.ticker || '').toUpperCase()
    if (!symbol) throw new Error('Active paper order missing symbol')
    if (order.direction === 'buy') {
      const value = remaining * price
      totalBuyNotional += value
      buys.set(symbol, (buys.get(symbol) || 0) + value)
    } else if (order.direction === 'sell') {
      sells.set(symbol, (sells.get(symbol) || 0) + remaining)
    } else {
      throw new Error('Unsupported paper order direction')
    }
  }
  return { totalBuyNotional: money(totalBuyNotional), buyNotionalBySymbol: buys, sellQuantityBySymbol: sells }
}
