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
import { divMicros, microsTo4Decimals, microsToDollars, mulMicros, toMicros } from '../domain/money.js'

export const SIM_ORDER_PREFIX = 'simreplay_'
export const SIM_DAILY_ORDER_PREFIX = 'simdaily_'
const SIM_ORDER_ID = /^sim(replay|daily)_(\d{4}-\d{2}-\d{2})_(.+)$/
const SESSION_RE = /^\d{4}-\d{2}-\d{2}$/

export function simulationConfig(env = process.env) {
  const requested = env.BROKER_MODE === 'simulated'
  const raw = String(env.SIM_REPLAY_SESSION ?? '').trim()
  const daily = raw.toLowerCase() === 'latest'
  const validSession = SESSION_RE.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))
  const startingCash = Number(env.SIM_STARTING_CASH || 100_000)
  const maxAgeDays = Number(env.SIM_MAX_SESSION_AGE_DAYS || 5)
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
    // paper_daily trades only symbols with a fresh daily close: Alpha Engine's live universe.
    tradableSymbols: daily ? tradableSymbolsFrom(env) : null,
  }
}

export const DEFAULT_TRADABLE_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'JPM', 'XOM', 'META']
function tradableSymbolsFrom(env) {
  const raw = String(env.SIM_TRADABLE_SYMBOLS ?? '').trim()
  const list = raw ? raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : DEFAULT_TRADABLE_SYMBOLS
  return [...new Set(list)]
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
  let cashMicros = toMicros(config.startingCash ?? 0)
  const positions = new Map()
  for (const e of fills) {
    if (!isSimulatedOrderId(e.brokerOrderId)) continue
    const qtyMicros = toMicros(e.filledQuantity ?? 0)
    const pxMicros = toMicros(e.filledPrice ?? 0)
    const feesMicros = toMicros(e.fees ?? 0) + toMicros(e.commission ?? 0)
    const grossMicros = mulMicros(qtyMicros, pxMicros)
    const isSell = String(e.direction).toLowerCase() === 'sell'
    cashMicros -= (isSell ? -grossMicros : grossMicros) + feesMicros
    const p = positions.get(e.ticker) ?? { qtyMicros: 0n, costMicros: 0n }
    p.qtyMicros += isSell ? -qtyMicros : qtyMicros
    p.costMicros += isSell ? -grossMicros : grossMicros
    positions.set(e.ticker, p)
  }
  const open = [...positions.entries()].filter(([, p]) => p.qtyMicros > 0n || p.qtyMicros < 0n)
  const marketValueMicros = open.reduce((s, [, p]) => s + p.costMicros, 0n)
  const cashDollars = microsToDollars(cashMicros)
  return {
    simulated: true,
    mode: config.mode,
    session: config.session,
    cash: cashDollars,
    buying_power: Math.max(0, cashDollars),
    equity: microsToDollars(cashMicros + marketValueMicros),
    positions: open.map(([symbol, p]) => ({
      symbol,
      qty: String(microsTo4Decimals(p.qtyMicros)),
      avg_entry_price: p.qtyMicros !== 0n ? microsTo4Decimals(divMicros(p.costMicros, p.qtyMicros)) : 0
    }))
  }
}
