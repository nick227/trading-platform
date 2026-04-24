import { runRegimeSnapshot } from './regimeSnapshotJob.js'

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
 *   - 4:15 PM ET Mon–Fri → `runRegimeSnapshot(['SPY'])`
 *
 * Fallback behavior:
 * - If `node-cron` is not installed, uses a simple setTimeout-based scheduler
 *   for the same wall-clock time in America/New_York.
 */
export async function startSchedulers() {
  const started = await startRegimeCron().catch((err) => {
    console.warn('[scheduler] regime cron failed to start:', err?.message ?? err)
    return false
  })

  if (!started) {
    console.warn('[scheduler] using fallback scheduler (node-cron not available)')
    startFallbackRegimeScheduler()
  }
}

async function startRegimeCron() {
  let cron
  try {
    cron = (await import('node-cron')).default
  } catch {
    return false
  }

  // Once daily at 4:15 PM ET, Mon–Fri.
  cron.schedule('15 16 * * 1-5', () => runRegimeSnapshot(DEFAULT_SYMBOLS), {
    timezone: 'America/New_York'
  })

  // Once daily at 2:00 AM ET, every day.
  cron.schedule('0 2 * * *', () => runBackfillReconciler(), {
    timezone: 'America/New_York'
  })

  console.log('[scheduler] regime snapshot cron scheduled (4:15 PM ET, Mon–Fri)')
  console.log('[scheduler] backfill reconciler cron scheduled (2:00 AM ET, daily)')
  return true
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
