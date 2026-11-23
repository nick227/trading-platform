/**
 * Simulation Market Feed (paper trading & replay).
 *
 * Supports three operational modes:
 *  1. 'continuous_paper': Continuously polls fresh market quotes from Alpha Engine
 *     for all enabled bots' tickers, updating priceCache and advancing bot evaluation.
 *  2. 'advancing_replay': Chronologically advances through historical trading sessions,
 *     allowing multi-day simulation and strategy evaluation over changing regimes.
 *  3. 'historical_replay': Fixed single-session daily close replay (deterministic test mode).
 */
import prisma from '../db/prisma.js'
import { log } from '../logger.js'
import { priceCache } from './priceCache.js'
import { setMarketOpenState } from './calendar.js'
import { engineClient } from '../../../server/src/clients/engine.js'

export const replayFeedConfig = {
  tickMs: Number(process.env.REPLAY_TICK_MS ?? 15_000),
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
 * Historical replay tick: fetches close price for the configured session date.
 */
export async function replayTick({
  session,
  onTick,
  prismaClient = prisma,
  sessionClose = (t, s) => engineClient.getSessionClose(t, s),
}) {
  const tickers = await getEnabledTickers(prismaClient)
  const out = []

  for (const ticker of tickers) {
    try {
      const px = await sessionClose(ticker, session)
      if (!px || (px.session && px.session !== session) || !(Number(px.close) > 0)) {
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
export function startSimulationFeed({ mode = 'historical_replay', session = null, sessions = [], onTick }) {
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
    startReplayFeed({ session: session || '2026-11-20', onTick })
  }
}

/**
 * Preserved for backward compatibility with existing tests and scripts.
 */
export function startReplayFeed({ session, onTick }) {
  setMarketOpenState(true)
  stopSimulationFeed()

  const run = () => replayTick({ session, onTick }).catch((err) => log.error({ err: err.message }, 'replay_feed_error'))
  run()
  timer = setInterval(run, replayFeedConfig.tickMs)
  log.info({ mode: 'historical_replay', session, tickMs: replayFeedConfig.tickMs }, 'replay_feed_started')
}

export function stopSimulationFeed() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export const stopReplayFeed = stopSimulationFeed
