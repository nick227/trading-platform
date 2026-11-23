/**
 * Simulator price feed (replaces the Alpaca stream).
 *
 * Supports:
 *  1. 'paper_daily': Latest completed daily close from Alpha Engine, advancing each day.
 *  2. 'historical_replay': Fixed single-session daily close replay (demos and tests).
 *  3. 'continuous_paper': Real-time quotes polled continuously.
 *  4. 'advancing_replay': Chronologically advances through historical trading sessions.
 */
import prisma from '../db/prisma.js'
import { log } from '../logger.js'
import { priceCache } from './priceCache.js'
import { setMarketOpenState } from './calendar.js'
import { engineClient } from '../../../server/src/clients/engine.js'

export const replayFeedConfig = {
  tickMs: Number(process.env.REPLAY_TICK_MS ?? 30_000),
  continuousTickMs: Number(process.env.SIM_CONTINUOUS_TICK_MS ?? 15_000),
  advanceEveryNTicks: Number(process.env.SIM_ADVANCE_TICKS ?? 4),
}

let timer = null
let currentAdvancingIndex = 0

async function getEnabledTickers(prismaClient = prisma) {
  const bots = await prismaClient.bot.findMany({
    where: { enabled: true, deletedAt: null },
    select: { config: true },
  })
  return [...new Set(bots.flatMap((b) => (Array.isArray(b.config?.tickers) ? b.config.tickers : [])).map((t) => String(t).toUpperCase()))]
}

/**
 * Continuous paper trading tick: polls live quotes for enabled tickers.
 */
export async function continuousTick({
  onTick,
  prismaClient = prisma,
  getQuote = (t) => engineClient.getQuote(t).catch(() => engineClient.getSessionClose(t)),
}) {
  const tickers = await getEnabledTickers(prismaClient)
  const out = []

  for (const ticker of tickers) {
    try {
      const q = await getQuote(ticker)
      const last = Number(q?.price ?? q?.last ?? q?.close)
      if (!Number.isFinite(last) || last <= 0) {
        log.warn({ ticker, got: q }, 'continuous_quote_unavailable')
        continue
      }

      const bid = Number(q?.bid ?? (last * 0.9995).toFixed(2))
      const ask = Number(q?.ask ?? (last * 1.0005).toFixed(2))

      priceCache.set(ticker, { last, bid, ask, timestamp: new Date() })
      await onTick(ticker)
      out.push(ticker)
    } catch (err) {
      log.warn({ ticker, err: err.message }, 'continuous_tick_error')
    }
  }

  return out
}

/**
 * Simulator replay tick: publishes session daily close into price cache and evaluates bots.
 */
export async function replayTick({
  session: fixed,
  resolveSession,
  onTick,
  prismaClient = prisma,
  sessionClose = (t, s) => engineClient.getSessionClose(t, s),
}) {
  let session = fixed
  if (resolveSession) {
    try {
      session = await resolveSession()
    } catch (err) {
      log.warn({ err: err.message, code: err.code ?? null }, 'simulator_session_unavailable')
      return []
    }
  }

  const tickers = await getEnabledTickers(prismaClient)
  const out = []

  for (const ticker of tickers) {
    try {
      const px = await sessionClose(ticker, session)
      if (!px || px.session !== session || !(Number(px.close) > 0)) {
        log.warn({ ticker, session, got: px?.session ?? null }, 'replay_price_unavailable')
        continue
      }
      const close = Number(px.close)
      priceCache.set(ticker, { last: close, bid: close, ask: close, timestamp: new Date() })
      await onTick(ticker)
      out.push(ticker)
    } catch (err) {
      log.warn({ ticker, session, err: err.message }, 'replay_tick_error')
    }
  }

  return out
}

/**
 * Advancing replay tick: steps forward through sessions.
 */
export async function advancingReplayTick({
  sessions = [],
  onTick,
  prismaClient = prisma,
  sessionClose = (t, s) => engineClient.getSessionClose(t, s),
}) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return []
  }

  const currentSession = sessions[currentAdvancingIndex % sessions.length]
  const out = await replayTick({ session: currentSession, onTick, prismaClient, sessionClose })

  currentAdvancingIndex = (currentAdvancingIndex + 1) % sessions.length
  return out
}

/**
 * Starts the continuous paper trading feed.
 */
export function startContinuousFeed({ onTick }) {
  setMarketOpenState(true)
  stopSimulationFeed()

  const run = () => continuousTick({ onTick }).catch((err) => log.error({ err: err.message }, 'continuous_feed_error'))
  run()
  timer = setInterval(run, replayFeedConfig.continuousTickMs)
  log.info({ mode: 'continuous_paper', tickMs: replayFeedConfig.continuousTickMs }, 'continuous_feed_started')
}

/**
 * Starts the unified simulation feed based on configured mode.
 */
export function startSimulationFeed({ mode = 'historical_replay', session = null, resolveSession = null, sessions = [], onTick }) {
  if (mode === 'continuous_paper') {
    startContinuousFeed({ onTick })
  } else if (mode === 'advancing_replay' && Array.isArray(sessions) && sessions.length > 0) {
    setMarketOpenState(true)
    stopSimulationFeed()
    const run = () => advancingReplayTick({ sessions, onTick }).catch((err) => log.error({ err: err.message }, 'advancing_feed_error'))
    run()
    timer = setInterval(run, replayFeedConfig.tickMs)
    log.info({ mode: 'advancing_replay', sessionsCount: sessions.length, tickMs: replayFeedConfig.tickMs }, 'advancing_feed_started')
  } else {
    startReplayFeed({ session, resolveSession, onTick })
  }
}

/**
 * Replay feed startup.
 */
export function startReplayFeed({ session, resolveSession, onTick }) {
  setMarketOpenState(true)
  stopSimulationFeed()

  const run = () => replayTick({ session, resolveSession, onTick }).catch((err) => log.error({ err: err.message }, 'replay_feed_error'))
  run()
  timer = setInterval(run, replayFeedConfig.tickMs)
  log.info({ session: session ?? 'latest', tickMs: replayFeedConfig.tickMs }, 'replay_feed_started')
}

export function stopSimulationFeed() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export const stopReplayFeed = stopSimulationFeed
