import { describe, expect, it } from 'vitest'
import { buildRecentActivity } from '../usePortfolio'

const row = (over) => ({ id: 'x', ticker: 'SPY', side: 'BUY', quantity: 2, price: 500, createdAt: '2026-11-22T10:00:00Z', ...over })

describe('recent activity: refusals are never cancellations', () => {
  it('classifies status "refused" as type refused with a readable reason', () => {
    const [a] = buildRecentActivity([row({ status: 'refused', refusalReason: 'bot_allocation_exceeded' })])
    expect(a).toMatchObject({ type: 'refused', event: 'Refused Buy Order: SPY', value: 'Over this bot’s capital limit.' })
  })

  it('classifies legacy refusals (cancelled + "refused:<reason>") identically', () => {
    const [legacy] = buildRecentActivity([row({ status: 'cancelled', cancelReason: 'refused:bot_allocation_exceeded' })])
    const [current] = buildRecentActivity([row({ status: 'refused', refusalReason: 'bot_allocation_exceeded' })])
    expect(legacy).toEqual(current)
  })

  it('keeps real cancellations as cancelled, and no refusal ever reads as cancelled', () => {
    const items = buildRecentActivity([
      row({ id: 'a', status: 'cancelled', cancelReason: 'user_cancel' }),
      row({ id: 'b', status: 'refused', refusalReason: 'emergency_stop' }),
      row({ id: 'c', status: 'cancelled', cancelReason: 'refused:max_daily_notional' }),
    ])
    expect(items.map((i) => i.type).sort()).toEqual(['cancelled', 'refused', 'refused'])
    expect(items.filter((i) => i.type === 'cancelled').every((i) => !/refus/i.test(i.event + i.value))).toBe(true)
  })
})
