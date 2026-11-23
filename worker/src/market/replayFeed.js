/**
 * Simulator price feed (replaces the Alpaca stream). Every tick interval, for each enabled
 * bot's tickers, publishes the simulator session's daily close into the price cache and
 * evaluates bots. The session is fixed (historical_replay) or the latest completed close
 * (paper_daily), resolved on every tick. A ticker without a close for that session (stale or
 * outside Alpha Engine's live universe) is skipped — never priced from another session.
 * The calendar is marked open: decisions are attributed to the session's close.
 */
import prisma from '../db/prisma.js'
import { log } from '../logger.js'
import { priceCache } from './priceCache.js'
import { setMarketOpenState } from './calendar.js'
import { engineClient } from '../../../server/src/clients/engine.js'

export const replayFeedConfig = { tickMs: Number(process.env.REPLAY_TICK_MS ?? 30_000) }
let timer = null

export async function replayTick({ session: fixed, resolveSession, onTick, prismaClient = prisma, sessionClose = (t, s) => engineClient.getSessionClose(t, s) }) {
  let session = fixed
  if (resolveSession) {
    try {
      session = await resolveSession()
    } catch (err) {
      log.warn({ err: err.message, code: err.code ?? null }, 'simulator_session_unavailable')
      return []
    }
  }
  const bots = await prismaClient.bot.findMany({ where: { enabled: true, deletedAt: null }, select: { config: true } })
  const tickers = [...new Set(bots.flatMap((b) => (Array.isArray(b.config?.tickers) ? b.config.tickers : [])).map((t) => String(t).toUpperCase()))]
  const out = []
  for (const ticker of tickers) {
    try {
      const px = await sessionClose(ticker, session)
      if (!px || px.session !== session || !(Number(px.close) > 0)) {
        log.warn({ ticker, session, got: px?.session ?? null }, 'replay_price_unavailable')
        continue
      }
      priceCache.set(ticker, { last: Number(px.close), bid: Number(px.close), ask: Number(px.close) })
      await onTick(ticker)
      out.push(ticker)
    } catch (err) {
      log.warn({ ticker, session, err: err.message }, 'replay_tick_error')
    }
  }
  return out
}

export function startReplayFeed({ session, resolveSession, onTick }) {
  setMarketOpenState(true)
  const run = () => replayTick({ session, resolveSession, onTick }).catch((err) => log.error({ err: err.message }, 'replay_feed_error'))
  run()
  timer = setInterval(run, replayFeedConfig.tickMs)
  log.info({ session: session ?? 'latest', tickMs: replayFeedConfig.tickMs }, 'replay_feed_started')
}

export function stopReplayFeed() {
  if (timer) clearInterval(timer)
  timer = null
}
