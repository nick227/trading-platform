import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ snap: null, history: null, peakRow: null, upserts: [], fills: [] }))
vi.mock('../../../worker/src/risk/accountSnapshot.js', () => ({
  portfolioRiskSnapshot: async () => h.snap,
  portfolioRiskHistory: async () => h.history,
}))
vi.mock('../../../worker/src/db/prisma.js', () => ({ default: { equityPeak: {
  findUnique: async () => h.peakRow,
  upsert: async (a) => { h.upserts.push(a); return a.create },
} } }))
vi.mock('../../src/services/portfolioValuationService.js', () => ({ loadPortfolioFills: async () => h.fills }))

const { drawdownStressService } = await import('../../../worker/src/risk/services/DrawdownStressService.js')
const { stressInputs, drawdownStress, RISK_POLICY_VERSION } = await import('../../../worker/src/risk/riskCore.js')

const NOW = Date.parse('2026-11-24T21:00:00Z')
const fill = (id, dir, qty, px, daysAgo) => ({ id, ticker: 'SPY', direction: dir, filledQuantity: qty, filledPrice: px, fees: 0, filledAt: new Date(NOW - daysAgo * 86_400_000) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) })
  h.snap = { userId: 'u', equity: 100_000 }; h.history = { peak: 100_000 }; h.peakRow = null; h.upserts = []; h.fills = []
})

describe('stress inputs (repair: no longer Execution.pnl / an unwritten EquityPeak)', () => {
  it('uses FIFO realized P&L of closed trades only, newest first', () => {
    const fills = [fill('b1', 'buy', 10, 100, 9), fill('s1', 'sell', 5, 90, 8), fill('s2', 'sell', 5, 95, 0)]
    const pnl = new Map([['b1', 0], ['s1', -50], ['s2', -25]])
    const i = stressInputs({ fills, perExecutionPnl: pnl, peakEquity: 100, equity: 90, now: NOW, dayStart: Date.parse('2026-11-24T00:00:00Z') })
    expect(i).toEqual({ peakEquity: 100, equity: 90, todaysPnls: [-25], recentPnls: [-25, -50], weekPnls: [-25] })
  })
  it('a quiet, flat portfolio stays at 100; drawdown and losing streaks now lower the score', () => {
    expect(drawdownStress({ peakEquity: 100_000, equity: 100_000, todaysPnls: [], recentPnls: [], weekPnls: [] }).score).toBe(100)
    const hurt = drawdownStress({ peakEquity: 100_000, equity: 91_000, todaysPnls: [-1200], recentPnls: [-1200, -400, -300, -200, -100, -50], weekPnls: [-1200, -400, -300, -200, -100] })
    expect(hurt.breakdown).toMatchObject({ drawdown: 40, dailyLoss: 65, losingStreak: 35 })
    expect(hurt.score).toBeLessThan(60) // stress_warning or worse → restricted by the matrix
  })
  it('the policy version changed with the repair', () => {
    expect(RISK_POLICY_VERSION).toMatch(/^normal-[0-9a-f]{12}$/)
  })
})

describe('live stress service', () => {
  it('maintains the equity peak from valuation history and scores drawdown against it', async () => {
    h.snap.equity = 92_000; h.history.peak = 101_000
    const r = await drawdownStressService.calculateDrawdownStress('p')
    expect(h.upserts[0]).toMatchObject({ where: { portfolioId: 'p' }, update: { peakEquity: '101000.00' } })
    expect(r.breakdown.drawdown).toBe(40) // 8.9% below the peak
    expect(r.details).toMatchObject({ peakEquity: 101_000, currentEquity: 92_000 })
  })
  it('never lowers a recorded peak, and reads realized losses from FIFO', async () => {
    h.peakRow = { peakEquity: '105000.00' }; h.history.peak = 100_000; h.snap.equity = 100_000
    h.fills = [fill('b1', 'buy', 10, 100, 2), fill('s1', 'sell', 10, 80, 0)] // realized −200 today
    const r = await drawdownStressService.calculateDrawdownStress('p')
    expect(h.upserts).toHaveLength(0)
    expect(r.details).toMatchObject({ peakEquity: 105_000, realizedToday: -200, closedTradesConsidered: 1 })
    expect(r.breakdown.losingStreak).toBe(90)
  })
  it('fails closed when the portfolio can’t be valued', async () => {
    h.snap = null
    expect((await drawdownStressService.calculateDrawdownStress('p')).score).toBe(0)
  })
})
