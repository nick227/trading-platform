/**
 * Internal simulator (historical replay) — shared by the API and the worker.
 *
 * Enabled only when BROKER_MODE=simulated AND SIM_REPLAY_SESSION names a session
 * (YYYY-MM-DD). Fills are labelled replays of that session's daily close from Alpha
 * Engine; they are never broker executions and never touch Alpaca. Live trading and
 * external order submission are unaffected (and stay disabled).
 */
import prisma from '../loaders/prisma.js'

export const SIM_ORDER_PREFIX = 'simreplay_'

export function simulationConfig(env = process.env) {
  const requested = env.BROKER_MODE === 'simulated'
  const session = String(env.SIM_REPLAY_SESSION ?? '').trim()
  const validSession = /^\d{4}-\d{2}-\d{2}$/.test(session) && !Number.isNaN(Date.parse(`${session}T00:00:00Z`))
  const startingCash = Number(env.SIM_STARTING_CASH ?? 100_000)
  return {
    requested,
    enabled: requested && validSession && Number.isFinite(startingCash) && startingCash > 0,
    mode: 'historical_replay',
    session: validSession ? session : null,
    startingCash: Number.isFinite(startingCash) && startingCash > 0 ? startingCash : null,
    // Research decisions are judged at the replayed session's close, not the wall clock.
    clock: validSession ? new Date(`${session}T21:00:00Z`) : null,
  }
}

export function isSimulatedOrderId(id) {
  return typeof id === 'string' && id.startsWith(SIM_ORDER_PREFIX)
}

/** Simulated paper account from the user's simulator fills only (never broker data). */
export async function simulatedAccount(userId, { prismaClient = prisma, config = simulationConfig() } = {}) {
  const fills = await prismaClient.execution.findMany({
    where: { userId, filledQuantity: { gt: 0 } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  })
  let cash = config.startingCash ?? 0
  const positions = new Map()
  for (const e of fills) {
    if (!isSimulatedOrderId(e.brokerOrderId)) continue
    const qty = Number(e.filledQuantity) || 0
    const px = Number(e.filledPrice) || 0
    const fees = Number(e.fees) || 0
    const signed = String(e.direction).toLowerCase() === 'sell' ? -qty : qty
    cash -= signed * px + fees
    const p = positions.get(e.ticker) ?? { qty: 0, cost: 0 }
    p.qty += signed
    p.cost += signed * px
    positions.set(e.ticker, p)
  }
  const open = [...positions.entries()].filter(([, p]) => Math.abs(p.qty) > 1e-9)
  const marketValue = open.reduce((s, [, p]) => s + p.cost, 0) // valued at fill cost in replay
  return {
    simulated: true,
    mode: config.mode,
    session: config.session,
    cash: Number(cash.toFixed(2)),
    buying_power: Number(Math.max(0, cash).toFixed(2)),
    equity: Number((cash + marketValue).toFixed(2)),
    positions: open.map(([symbol, p]) => ({ symbol, qty: String(p.qty), avg_entry_price: p.qty ? Number((p.cost / p.qty).toFixed(4)) : 0 }))
  }
}
