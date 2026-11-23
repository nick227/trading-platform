/**
 * Internal simulator — shared by the API and the worker.
 *
 * Supports three simulation modes:
 *  1. 'continuous_paper': Real-time or ongoing paper trading marked to live/fresh market quotes.
 *  2. 'advancing_replay': Multi-session chronological progression stepping forward session by session.
 *  3. 'historical_replay': Deterministic single-session replay (default for static tests).
 *
 * All fills are labelled `simreplay_<session>_<clientOrderId>` and are simulated in-process;
 * live broker accounts (Alpaca) are never contacted.
 */
import prisma from '../loaders/prisma.js'

export const SIM_ORDER_PREFIX = 'simreplay_'

export function simulationConfig(env = process.env) {
  const requested = env.BROKER_MODE === 'simulated'
  const rawSession = String(env.SIM_REPLAY_SESSION ?? '').trim()
  const validSession = /^\d{4}-\d{2}-\d{2}$/.test(rawSession) && !Number.isNaN(Date.parse(`${rawSession}T00:00:00Z`))
  const startingCash = Number(env.SIM_STARTING_CASH ?? 100_000)
  const simMode = String(env.SIM_MODE ?? '').trim().toLowerCase()

  let mode = 'historical_replay'
  let session = validSession ? rawSession : null
  let clock = validSession ? new Date(`${rawSession}T21:00:00Z`) : null
  let enabled = false

  if (requested && Number.isFinite(startingCash) && startingCash > 0) {
    if (simMode === 'continuous' || simMode === 'continuous_paper' || (simMode === '' && !validSession && env.WORKER_ORDER_PROCESSING === 'simulated')) {
      mode = 'continuous_paper'
      enabled = true
      session = new Date().toISOString().slice(0, 10)
      clock = null // live wall clock
    } else if (simMode === 'advancing_replay' || env.SIM_ADVANCING === 'true') {
      mode = 'advancing_replay'
      enabled = true
      session = validSession ? rawSession : '2026-11-20'
      clock = new Date(`${session}T21:00:00Z`)
    } else if (validSession) {
      mode = 'historical_replay'
      enabled = true
      session = rawSession
      clock = new Date(`${rawSession}T21:00:00Z`)
    }
  }

  return {
    requested,
    enabled,
    mode,
    session,
    startingCash: Number.isFinite(startingCash) && startingCash > 0 ? startingCash : null,
    clock,
  }
}

export function isSimulatedOrderId(id) {
  return typeof id === 'string' && id.startsWith(SIM_ORDER_PREFIX)
}

/**
 * Simulated paper account from the user's simulator fills.
 * Computes FIFO cost basis, realized P&L on closed positions,
 * and marks open positions to current market prices (via priceGetter).
 */
export async function simulatedAccount(userId, { prismaClient = prisma, config = simulationConfig(), priceGetter = null } = {}) {
  const fills = await prismaClient.execution.findMany({
    where: { userId, filledQuantity: { gt: 0 } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  })

  let cash = config.startingCash ?? 0
  let realizedPnl = 0
  const positions = new Map() // ticker -> { qty, cost, lots: [{ qty, price }] }

  for (const e of fills) {
    if (!isSimulatedOrderId(e.brokerOrderId)) continue
    const qty = Number(e.filledQuantity) || 0
    const px = Number(e.filledPrice) || 0
    const fees = Number(e.fees) || 0
    const isSell = String(e.direction).toLowerCase() === 'sell'
    const signed = isSell ? -qty : qty
    cash -= signed * px + fees

    const p = positions.get(e.ticker) ?? { qty: 0, cost: 0, lots: [] }
    if (isSell) {
      let remainingToSell = qty
      while (remainingToSell > 0 && p.lots.length > 0) {
        const lot = p.lots[0]
        const matched = Math.min(remainingToSell, lot.qty)
        const costBasis = matched * lot.price
        const proceeds = matched * px
        realizedPnl += proceeds - costBasis
        lot.qty -= matched
        remainingToSell -= matched
        if (lot.qty <= 1e-9) p.lots.shift()
      }
      realizedPnl -= fees
      p.qty -= qty
      const prevTotalQty = p.qty + qty
      if (prevTotalQty > 0) {
        p.cost = Math.max(0, p.cost - (qty * (p.cost / prevTotalQty)))
      } else {
        p.cost = 0
      }
    } else {
      p.qty += qty
      p.cost += qty * px
      p.lots.push({ qty, price: px })
    }
    positions.set(e.ticker, p)
  }

  const open = [...positions.entries()].filter(([, p]) => Math.abs(p.qty) > 1e-9)

  let totalMarketValue = 0
  let totalCostBasis = 0
  const mappedPositions = []

  for (const [symbol, p] of open) {
    const avgEntry = p.qty > 0 ? Number((p.cost / p.qty).toFixed(4)) : 0
    totalCostBasis += p.cost

    let currentPrice = avgEntry
    if (typeof priceGetter === 'function') {
      const livePrice = priceGetter(symbol)
      if (Number.isFinite(livePrice) && livePrice > 0) {
        currentPrice = Number(livePrice.toFixed(4))
      }
    }

    const marketVal = Number((p.qty * currentPrice).toFixed(2))
    totalMarketValue += marketVal
    const unrealized = Number((marketVal - p.cost).toFixed(2))
    const unrealizedPct = p.cost > 0 ? Number(((unrealized / p.cost) * 100).toFixed(2)) : 0

    mappedPositions.push({
      symbol,
      qty: String(p.qty),
      avg_entry_price: avgEntry,
      current_price: currentPrice,
      cost_basis: Number(p.cost.toFixed(2)),
      market_value: marketVal,
      unrealized_pl: unrealized,
      unrealized_pl_pct: unrealizedPct,
    })
  }

  const totalUnrealized = Number((totalMarketValue - totalCostBasis).toFixed(2))
  const equity = Number((cash + totalMarketValue).toFixed(2))

  return {
    simulated: true,
    mode: config.mode,
    session: config.session,
    cash: Number(cash.toFixed(2)),
    buying_power: Number(Math.max(0, cash).toFixed(2)),
    equity,
    total_cost_basis: Number(totalCostBasis.toFixed(2)),
    market_value: Number(totalMarketValue.toFixed(2)),
    unrealized_pnl: totalUnrealized,
    realized_pnl: Number(realizedPnl.toFixed(2)),
    total_pnl: Number((equity - (config.startingCash ?? 0)).toFixed(2)),
    positions: mappedPositions,
  }
}
