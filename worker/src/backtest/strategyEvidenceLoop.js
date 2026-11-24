/**
 * Keeps platform strategy evidence current: after each completed session, generates any
 * missing standardized results (idempotent; published snapshots are never rewritten).
 */
import { log } from '../logger.js'
import { generateStrategyEvidence } from '../../../server/src/services/strategyEvidenceService.js'

export const strategyEvidenceConfig = { intervalMs: Number(process.env.STRATEGY_EVIDENCE_INTERVAL_MS ?? 30 * 60_000), startDelayMs: 60_000 }
let timer = null
let running = false

export async function strategyEvidenceTick() {
  if (running) return null
  running = true
  const t0 = Date.now()
  try {
    // Yield between runs so the bot engine and order worker keep their timing.
    const out = await generateStrategyEvidence({ yieldEvery: () => new Promise((r) => setImmediate(r)) })
    if (out.created) log.info({ ...out, ms: Date.now() - t0 }, 'strategy_evidence_generated')
    return out
  } catch (err) {
    log.error({ err: err.message }, 'strategy_evidence_failed')
    return null
  } finally {
    running = false
  }
}

export function startStrategyEvidenceLoop() {
  const loop = async () => {
    await strategyEvidenceTick()
    timer = setTimeout(loop, strategyEvidenceConfig.intervalMs)
    timer.unref?.()
  }
  timer = setTimeout(loop, strategyEvidenceConfig.startDelayMs)
  timer.unref?.()
  log.info({ intervalMs: strategyEvidenceConfig.intervalMs }, 'strategy_evidence_loop_started')
}

export function stopStrategyEvidenceLoop() {
  if (timer) clearTimeout(timer)
  timer = null
}
