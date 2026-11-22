import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ fills: [] }))
vi.mock('../../../worker/src/db/prisma.js', () => ({ default: { execution: { findMany: async () => h.fills } } }))
const { evaluateDailyLoss, resetDailyLossCache } = await import('../../../worker/src/engine/rules/dailyLoss.js')

const today = new Date(); today.setHours(12, 0, 0, 0)
const yesterday = new Date(today.getTime() - 86_400_000)
const f = (id, direction, qty, px, at) => ({ id, ticker: 'SPY', direction, filledQuantity: qty, filledPrice: px, filledAt: at, createdAt: at, fees: 0, commission: 0 })

beforeEach(() => resetDailyLossCache())

describe('daily loss rule (realized P/L, FIFO)', () => {
  it('a purchase is not a loss (previously its cost was counted as one)', async () => {
    h.fills = [f('a', 'buy', 10, 100, today)]
    expect(await evaluateDailyLoss({ maxLoss: 50 }, 'p1')).toEqual({ pass: true, currentLoss: 0 })
  })

  it('blocks once today’s realized loss reaches the limit (threshold unchanged)', async () => {
    h.fills = [f('a', 'buy', 10, 100, yesterday), f('b', 'sell', 10, 90, today)]
    const r = await evaluateDailyLoss({ maxLoss: 100 }, 'p1')
    expect(r).toMatchObject({ pass: false, reason: 'daily_loss_limit_reached' })
  })

  it('ignores losses realized on earlier days and counts gains as no loss', async () => {
    h.fills = [f('a', 'buy', 10, 100, yesterday), f('b', 'sell', 5, 80, yesterday), f('c', 'sell', 5, 120, today)]
    expect(await evaluateDailyLoss({ maxLoss: 1 }, 'p1')).toEqual({ pass: true, currentLoss: 0 })
  })
})
