import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: 0 }))
vi.mock('../../../worker/src/db/prisma.js', () => ({
  default: { execution: { findFirst: async () => { h.calls += 1; return null } } },
}))

const { evaluateCooldown, noteCooldownExecution } = await import('../../../worker/src/engine/rules/cooldown.js')

describe('cooldown rule cache', () => {
  it('blocks a second order right after one is created, even while a passing result is cached', async () => {
    const cfg = { windowMs: 3_600_000 }
    expect(await evaluateCooldown(cfg, 'bot_c', 'SPY')).toEqual({ pass: true })
    // The passing result is now cached for 30s; without noting the order, the next
    // evaluation would pass again and the bot could exceed its configured cooldown.
    noteCooldownExecution('bot_c', 'SPY')
    const next = await evaluateCooldown(cfg, 'bot_c', 'SPY')
    expect(next.pass).toBe(false)
    expect(next.reason).toBe('cooldown_active')
    expect(h.calls).toBe(1)
  })
})
