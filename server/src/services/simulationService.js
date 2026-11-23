/**
 * Internal simulator — shared by the API and the worker. Supports:
 *
 *   paper_daily        SIM_REPLAY_SESSION=latest — the session is the latest completed daily
 *                      close Alpha Engine has, advancing every trading day. A bot acts at
 *                      most once per symbol per session; fills are at that session's close.
 *   historical_replay  SIM_REPLAY_SESSION=YYYY-MM-DD — every decision and fill uses that one
 *                      session's daily close (demos and tests).
 *   continuous_paper   SIM_MODE=continuous_paper — ongoing paper trading against live/fresh quotes.
 *   advancing_replay   SIM_MODE=advancing_replay — multi-day progression.
 *
 * Enabled only when BROKER_MODE=simulated and SIM_REPLAY_SESSION / SIM_MODE is valid.
 */
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'

export const SIM_ORDER_PREFIX = 'simreplay_'
export const SIM_DAILY_ORDER_PREFIX = 'simdaily_'
const SIM_ORDER_ID = /^sim(replay|daily)_(\d{4}-\d{2}-\d{2}|[A-Za-z0-9-]+)_(.+)$/
const SESSION_RE = /^\d{4}-\d{2}-\d{2}$/

export function simulationConfig(env = process.env) {
  const requested = env.BROKER_MODE === 'simulated'
  const raw = String(env.SIM_REPLAY_SESSION ?? '').trim()
  const daily = raw.toLowerCase() === 'latest'
  const validSession = SESSION_RE.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))
  const startingCash = Number(env.SIM_STARTING_CASH ?? 100_000)
  const maxAgeDays = Number(env.SIM_MAX_SESSION_AGE_DAYS ?? 5)
  const simMode = String(env.SIM_MODE ?? '').trim().toLowerCase()

  let mode = daily ? 'paper_daily' : 'historical_replay'
  let session = validSession ? raw : null
  let clock = validSession ? sessionClock(raw) : null
  let enabled = requested && (daily || validSession) && Number.isFinite(startingCash) && startingCash > 0

  if (requested && Number.isFinite(startingCash) && startingCash > 0) {
    if (simMode === 'continuous' || simMode === 'continuous_paper') {
      mode = 'continuous_paper'
      enabled = true
      session = new Date().toISOString().slice(0, 10)
      clock = null
    } else if (simMode === 'advancing_replay' || env.SIM_ADVANCING === 'true') {
      mode = 'advancing_replay'
      enabled = true
      session = validSession ? raw : '2026-11-20'
      clock = new Date(`${session}T21:00:00Z`)
    }
  }

  return {
    requested,
    enabled,
    mode,
    // Fixed for replay; resolved per use with currentSimSession() for paper_daily.
    session,
    startingCash: Number.isFinite(startingCash) && startingCash > 0 ? startingCash : null,
    // Replay: research is judged at the replayed session's close. paper_daily: real time.
    clock,
    referenceTicker: String(env.SIM_REFERENCE_TICKER ?? 'SPY').toUpperCase(),
    maxSessionAgeDays: Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? maxAgeDays : 5,
  }
}

/** The moment a session's daily close is attributed to (decisions, research clock, fills). */
export function sessionClock(session) {
  return new Date(`${session}T21:00:00Z`)
}

export function isSimulatedOrderId(id) {
  return typeof id === 'string' && SIM_ORDER_ID.test(id)
}

/** { mode, session, clientOrderId } from a simulator order id, else null. */
export function parseSimOrderId(id) {
  const m = typeof id === 'string' ? id.match(SIM_ORDER_ID) : null
  return m ? { mode: m[1] === 'daily' ? 'paper_daily' : 'historical_replay', session: m[2], clientOrderId: m[3] } : null
}

export function simOrderId(config, session, clientOrderId) {
  return `${config.mode === 'paper_daily' ? SIM_DAILY_ORDER_PREFIX : SIM_ORDER_PREFIX}${session}_${clientOrderId}`
}

let sessionCache = { value: null, at: 0 }
export function resetSimSessionCache() { sessionCache = { value: null, at: 0 } }

/**
 * The session the simulator trades on right now. Replay: the configured session.
 * paper_daily: the latest completed session Alpha Engine has a close for (reference ticker),
 * cached briefly. Fails closed when market data is missing or older than maxSessionAgeDays.
 */
export async function currentSimSession({ config = simulationConfig(), engine = engineClient, now = Date.now(), cacheMs = 5 * 60_000 } = {}) {
  if (!config.enabled) return null
  if (config.mode !== 'paper_daily') return config.session
  if (sessionCache.value && now - sessionCache.at < cacheMs) return sessionCache.value
  const sc = await engine.getSessionClose(config.referenceTicker)
  const session = sc?.session
  if (!SESSION_RE.test(String(session ?? ''))) throw Object.assign(new Error('no current market session'), { code: 'SIM_NO_SESSION' })
  const ageDays = (now - Date.parse(`${session}T00:00:00Z`)) / 86_400_000
  if (ageDays > config.maxSessionAgeDays) {
    throw Object.assign(new Error(`market data is stale (latest close ${session})`), { code: 'SIM_STALE_SESSION', session })
  }
  sessionCache = { value: session, at: now }
  return session
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
