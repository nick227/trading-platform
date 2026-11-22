import { useState } from 'react'
import { controlErrorMessage, deriveStatus, pauseBot, resumeBot } from '../api/services/botDashboardService'

/**
 * Pause/Resume for bot rows on Home and Bots (one behaviour everywhere). `setBots(fn)`
 * receives the current list and must return the updated list.
 */
export function useBotControls(setBots) {
  const [busy, setBusy] = useState({})
  const [errors, setErrors] = useState({})
  const [pausingAll, setPausingAll] = useState(false)

  const patch = (ids, running) => setBots((bots) => bots.map((b) => {
    if (!ids.includes(b.id)) return b
    const next = { ...b, enabled: running, running }
    return { ...next, status: deriveStatus(next, next.lastActivity ? [next.lastActivity] : []) }
  }))

  const toggle = async (bot) => {
    const resuming = !bot.running
    setBusy((b) => ({ ...b, [bot.id]: true }))
    setErrors((e) => ({ ...e, [bot.id]: null }))
    try {
      await (resuming ? resumeBot(bot.id) : pauseBot(bot.id))
      patch([bot.id], resuming)
    } catch (err) {
      setErrors((e) => ({ ...e, [bot.id]: controlErrorMessage(err, resuming ? 'resume' : 'pause') }))
    } finally {
      setBusy((b) => ({ ...b, [bot.id]: false }))
    }
  }

  // Pauses every running bot. Not the emergency stop: open orders are left alone.
  const pauseAll = async (bots) => {
    setPausingAll(true)
    const targets = bots.filter((b) => b.running)
    const results = await Promise.all(targets.map(async (b) => {
      try { await pauseBot(b.id); return { id: b.id, ok: true } } catch (err) { return { id: b.id, ok: false, err } }
    }))
    patch(results.filter((r) => r.ok).map((r) => r.id), false)
    setErrors((e) => ({ ...e, ...Object.fromEntries(results.filter((r) => !r.ok).map((r) => [r.id, controlErrorMessage(r.err, 'pause')])) }))
    setPausingAll(false)
  }

  return { busy, errors, toggle, pauseAll, pausingAll }
}
