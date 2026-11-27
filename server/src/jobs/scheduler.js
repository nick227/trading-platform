import { runRegimeSnapshot } from './regimeSnapshotJob.js'
import { runAiStrategyDailyJob } from './aiStrategyDailyJob.js'
import { runAiStrategyMarketOpenJob } from './aiStrategyMarketOpenJob.js'
import { runStockTraderDailyJob } from './aiStockTraderDailyJob.js'
import { runStockTraderMarketOpenJob } from './aiStockTraderMarketOpenJob.js'
import { runResearchPartnerMonitorJob } from './researchPartnerMonitorJob.js'

const DEFAULT_SYMBOLS = ['SPY']

// Backfill reconciler function
async function runBackfillReconciler() {
  try {
    const { runBackfillReconciler } = await import('./backfillReconcilerJob.js')
    await runBackfillReconciler()
  } catch (error) {
    console.error('[scheduler] backfill reconciler failed:', error)
  }
}

/**
 * Starts background schedulers for the API server process.
 *
 * Primary behavior (preferred):
 * - If `node-cron` is available, schedule:
 *   - 9:45 AM ET Mon–Fri → `runAiStrategyMarketOpenJob()` (Market Open execution of pending next_open orders)
 *   - 4:15 PM ET Mon–Fri → `runRegimeSnapshot(['SPY'])`
 *   - 4:30 PM ET Mon–Fri → `runAiStrategyDailyJob()` (Autonomous AI post-close cycle)
 *   - 2:00 AM ET Daily → `runBackfillReconciler()`
 *
 * Authoritative guard:
 * - Controlled by `ENABLE_AI_SCHEDULER` (defaults to true; set to false to disable).
 *
 * Fallback behavior:
 * - If `node-cron` is not installed, uses a simple setTimeout-based scheduler
 *   for the same wall-clock times in America/New_York.
 */
export async function startSchedulers() {
  if (process.env.ENABLE_AI_SCHEDULER === 'false') {
    console.log('[scheduler] AI scheduler disabled by ENABLE_AI_SCHEDULER=false')
    return false
  }

  const started = await startCronSchedulers().catch((err) => {
    console.warn('[scheduler] cron failed to start:', err?.message ?? err)
    return false
  })

  if (!started) {
    console.warn('[scheduler] using fallback scheduler (node-cron not available)')
    startFallbackMarketOpenScheduler()
    startFallbackRegimeScheduler()
    startFallbackAiStrategyScheduler()
    if (process.env.ENABLE_FLAGSHIP_STOCK_TRADER === 'true') {
      startFallbackStockTraderScheduler()
      startFallbackStockTraderMarketOpenScheduler()
    }
    if (process.env.ENABLE_RESEARCH_PARTNER_MONITORING === 'true') {
      startFallbackResearchPartnerMonitorScheduler()
    }
  }
}

async function startCronSchedulers() {
  let cron
  try {
    cron = (await import('node-cron')).default
  } catch {
    return false
  }

  // Once daily at 9:45 AM ET, Mon–Fri (Market-Open Order Execution).
  cron.schedule('45 9 * * 1-5', () => runAiStrategyMarketOpenJob().catch((err) => {
    console.error('[scheduler] autonomous AI market-open job error:', err?.message ?? err)
  }), {
    timezone: 'America/New_York'
  })

  // Once daily at 4:15 PM ET, Mon–Fri.
  cron.schedule('15 16 * * 1-5', () => runRegimeSnapshot(DEFAULT_SYMBOLS), {
    timezone: 'America/New_York'
  })

  // Once daily at 4:30 PM ET, Mon–Fri (Autonomous AI Post-Close Cycle).
  cron.schedule('30 16 * * 1-5', () => runAiStrategyDailyJob().catch((err) => {
    console.error('[scheduler] autonomous AI strategy job error:', err?.message ?? err)
  }), {
    timezone: 'America/New_York'
  })

  // Flagship is explicitly opt-in, independent of the legacy momentum schedule.
  if (process.env.ENABLE_FLAGSHIP_STOCK_TRADER === 'true') {
    cron.schedule('50 9 * * 1-5', () => runStockTraderMarketOpenJob().catch(err => {
      console.error('[scheduler] flagship paper market-open job error:', err?.message ?? err)
    }), { timezone: 'America/New_York' })
    cron.schedule('45 16 * * 1-5', () => runStockTraderDailyJob().catch(err => {
      console.error('[scheduler] flagship AI Stock Trader job error:', err?.message ?? err)
    }), { timezone: 'America/New_York' })
  }

  // Read-only evidence checks are separately opt-in, never paid LLM calls.
  if (process.env.ENABLE_RESEARCH_PARTNER_MONITORING === 'true') {
    cron.schedule('20 17 * * 1-5', () => runResearchPartnerMonitorJob().catch(err => {
      console.error('[scheduler] Research Partner monitor failed:', err?.message ?? err)
    }), { timezone: 'America/New_York' })
  }

  // Once daily at 2:00 AM ET, every day.
  cron.schedule('0 2 * * *', () => runBackfillReconciler(), {
    timezone: 'America/New_York'
  })

  console.log('[scheduler] autonomous AI market-open cron scheduled (9:45 AM ET, Mon–Fri)')
  console.log('[scheduler] regime snapshot cron scheduled (4:15 PM ET, Mon–Fri)')
  console.log('[scheduler] autonomous AI strategy cron scheduled (4:30 PM ET, Mon–Fri)')
  console.log('[scheduler] backfill reconciler cron scheduled (2:00 AM ET, daily)')
  return true
}

function startFallbackMarketOpenScheduler() {
  const scheduleNext = () => {
    const delayMs = msUntilNextEasternWeekdayTime(9, 45)
    setTimeout(async () => {
      try {
        await runAiStrategyMarketOpenJob()
      } catch (err) {
        console.error('[scheduler] fallback market open execution error:', err?.message ?? err)
      } finally {
        scheduleNext()
      }
    }, delayMs)
  }

  scheduleNext()
  console.log('[scheduler] fallback market open scheduler armed (9:45 AM ET, Mon–Fri)')
}

function startFallbackAiStrategyScheduler() {
  const scheduleNext = () => {
    const delayMs = msUntilNextEasternWeekdayTime(16, 30)
    setTimeout(async () => {
      try {
        await runAiStrategyDailyJob()
      } catch (err) {
        console.error('[scheduler] fallback autonomous AI strategy unexpected error:', err?.message ?? err)
      } finally {
        scheduleNext()
      }
    }, delayMs)
  }

  scheduleNext()
  console.log('[scheduler] fallback autonomous AI scheduler armed (4:30 PM ET, Mon–Fri)')
}

function startFallbackStockTraderMarketOpenScheduler() {
  const scheduleNext = () => {
    setTimeout(async () => {
      try { await runStockTraderMarketOpenJob() }
      catch (error) { console.error('[scheduler] fallback flagship market open failed:', error) }
      finally { scheduleNext() }
    }, msUntilNextEasternWeekdayTime(9, 50))
  }
  scheduleNext()
}

function startFallbackStockTraderScheduler() {
  const scheduleNext = () => {
    const delayMs = msUntilNextEasternWeekdayTime(16, 45)
    setTimeout(async () => {
      try {
        await runStockTraderDailyJob()
      } catch (error) {
        console.error('[scheduler] fallback flagship Stock Trader job failed:', error)
      } finally {
        scheduleNext()
      }
    }, delayMs)
  }
  scheduleNext()
}

function startFallbackRegimeScheduler() {
  const scheduleNext = () => {
    const delayMs = msUntilNextEasternWeekdayTime(16, 15)
    setTimeout(async () => {
      try {
        await runRegimeSnapshot(DEFAULT_SYMBOLS)
      } catch (err) {
        // runRegimeSnapshot never throws by contract, but keep the scheduler resilient.
        console.error('[scheduler] regime snapshot unexpected error:', err?.message ?? err)
      } finally {
        scheduleNext()
      }
    }, delayMs)
  }

  scheduleNext()
  console.log('[scheduler] fallback regime scheduler armed (4:15 PM ET, Mon–Fri)')
}

// Compute ms until next Mon–Fri at HH:MM in America/New_York.
function msUntilNextEasternWeekdayTime(targetHour, targetMinute) {
  const now = new Date()

  // Represent "now" as a Date whose clock fields match America/New_York.
  const nyNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))

  const nyTarget = new Date(nyNow)
  nyTarget.setHours(targetHour, targetMinute, 0, 0)

  // Advance to the next valid weekday/time in NY.
  while (nyTarget <= nyNow || isWeekend(nyTarget)) {
    nyTarget.setDate(nyTarget.getDate() + 1)
    nyTarget.setHours(targetHour, targetMinute, 0, 0)
  }

  const ms = nyTarget.getTime() - nyNow.getTime()
  return Number.isFinite(ms) ? Math.max(1_000, ms) : 60_000
}

function isWeekend(d) {
  const day = d.getDay() // local representation of NY wall-clock
  return day === 0 || day === 6
}

function startFallbackResearchPartnerMonitorScheduler() {
  const scheduleNext = () => {
    setTimeout(async () => {
      try { await runResearchPartnerMonitorJob() }
      catch (error) { console.error('[scheduler] research monitoring failed:', error?.message ?? error) }
      finally { scheduleNext() }
    }, msUntilNextEasternWeekdayTime(17,20))
  }
  scheduleNext()
}
