/**
 * Processes queued backtests one at a time, in the worker, off the order path. A run never
 * creates executions or touches a broker; a crash leaves at most one run 'running', which
 * failStaleBacktests frees on the next start.
 */
import { log } from '../logger.js'
import { failStaleBacktests, processNextBacktest } from '../../../server/src/services/backtestService.js'

export const backtestLoopConfig = { idleMs: Number(process.env.BACKTEST_POLL_MS ?? 5_000) }
let timer = null
let busy = false

export async function backtestTick() {
  if (busy) return null
  busy = true
  try {
    const run = await processNextBacktest()
    if (run) log.info({ backtestId: run.id, status: run.status, error: run.error ?? null }, 'backtest_finished')
    return run
  } catch (err) {
    log.error({ err: err.message }, 'backtest_loop_error')
    return null
  } finally {
    busy = false
  }
}

export async function startBacktestLoop() {
  try {
    const stale = await failStaleBacktests()
    if (stale.count) log.warn({ count: stale.count }, 'backtests_interrupted_marked_failed')
  } catch (err) {
    log.warn({ err: err.message }, 'backtest_stale_sweep_failed')
  }
  const loop = async () => {
    const run = await backtestTick()
    timer = setTimeout(loop, run ? 0 : backtestLoopConfig.idleMs)
    timer.unref?.()
  }
  timer = setTimeout(loop, backtestLoopConfig.idleMs)
  timer.unref?.()
  log.info({ idleMs: backtestLoopConfig.idleMs }, 'backtest_loop_started')
}

export function stopBacktestLoop() {
  if (timer) clearTimeout(timer)
  timer = null
}
