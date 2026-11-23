/**
 * Internal simulator — shared by the API and the worker. Two modes, both labelled simulated
 * money, never broker executions, never Alpaca (live trading stays disabled):
 *
 *   historical_replay  SIM_REPLAY_SESSION=YYYY-MM-DD — every decision and fill uses that one
 *                      session's daily close (demos and tests).
 *   paper_daily        SIM_REPLAY_SESSION=latest — the session is the latest completed daily
 *                      close Alpha Engine has, so it advances every trading day. A bot acts at
 *                      most once per symbol per session; fills are at that session's close.
 *
 * Enabled only when BROKER_MODE=simulated and SIM_REPLAY_SESSION is valid.
 */
import prisma from '../loaders/prisma.js'
import { engineClient } from '../clients/engine.js'

export const SIM_ORDER_PREFIX = 'simreplay_'
export const SIM_DAILY_ORDER_PREFIX = 'simdaily_'
const SIM_ORDER_ID = /^sim(replay|daily)_(\d{4}-\d{2}-\d{2})_(.+)$/
const SESSION_RE = /^\d{4}-\d{2}-\d{2}$/

export function simulationConfig(env = process.env) {
  const requested = env.BROKER_MODE === 'simulated'
  const raw = String(env.SIM_REPLAY_SESSION ?? '').trim()
  const daily = raw.toLowerCase() === 'latest'
  const validSession = SESSION_RE.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))
  const startingCash = Number(env.SIM_STARTING_CASH ?? 100_000)
  const maxAgeDays = Number(env.SIM_MAX_SESSION_AGE_DAYS ?? 5)
  return {
    requested,
    enabled: requested && (daily || validSession) && Number.isFinite(startingCash) && startingCash > 0,
    mode: daily ? 'paper_daily' : 'historical_replay',
    // Fixed for replay; resolved per use with currentSimSession() for paper_daily.
    session: validSession ? raw : null,
    startingCash: Number.isFinite(startingCash) && startingCash > 0 ? startingCash : null,
    // Replay: research is judged at the replayed session's close. paper_daily: real time.
    clock: validSession ? sessionClock(raw) : null,
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
