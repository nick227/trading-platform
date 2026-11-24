import { describe, it, expect } from 'vitest'
import { runBacktest } from '../../../worker/src/backtest/historicalRunner.js'
import { calculateFifoAccounting } from '../../src/services/botAccountingService.js'

const days = (n, from = Date.UTC(2025, 0, 6)) => {
  const out = []
  for (let t = from; out.length < n; t += 86_400_000) { const d = new Date(t); if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)) }
  return out
}
const CAL = days(60)
// SPY: flat 100, open = close − 1 (so open/close fills are distinguishable); liquid every day.
const series = (fn, vol = () => 2e6) => CAL.map((d, i) => { const c = fn(i); return [d, c - 1, c + 1, c - 2, c, vol(i)] })
const bot = (config = {}, rules = [{ type: 'price_threshold', config: { operator: 'above', price: 105 } }]) =>
  ({ id: 'bot_bt', config: { tickers: ['SPY'], direction: 'buy', allocatedAmount: 5000, maxOrderNotional: 1000, ...config }, rules })
const run = (b, bars, opts = {}) => runBacktest({ bot: b, symbols: ['SPY'], start: CAL[25], end: CAL[59], startingCash: 100_000,
  data: { bars: { SPY: bars }, calendar: CAL, regimes: {}, unusable: [] }, ...opts })

describe('historical runner', () => {
  const rising = series((i) => 100 + i) // crosses 105 at i=6 (before the range): buys every session in range

  it('realistic model fills at the next open; simulator-parity at the observed close', async () => {
    const real = await run(bot(), rising, { executionModel: 'next_open' })
    const parity = await run(bot(), rising, { executionModel: 'same_close' })
    expect(real.trades[0]).toMatchObject({ decidedSession: CAL[25], session: CAL[26], price: 126 - 1, decisionPrice: 125 })
    expect(parity.trades[0]).toMatchObject({ decidedSession: CAL[25], session: CAL[25], price: 125 })
    expect(real.executionModel).toBe('next_open')
    expect(parity.executionModelLabel).toMatch(/Simulator parity/)
  })

  it('stays within the bot’s capital: 5,000 allocation, 1,000 per order, whole shares', async () => {
    const r = await run(bot(), rising, { executionModel: 'same_close' })
    const spent = r.trades.reduce((s, t) => s + t.quantity * t.price, 0)
    expect(spent).toBeLessThanOrEqual(5000)
    expect(r.trades.every((t) => t.quantity * t.price <= 1000)).toBe(true)
    expect(r.events.some((e) => e.type === 'refused' && e.reason === 'bot_allocation_exceeded')).toBe(true)
  })

  it('never looks ahead: changing bars after a session cannot change decisions up to it', async () => {
    const a = await run(bot(), rising)
    const altered = rising.map((b, i) => (i > 40 ? [b[0], 50, 51, 49, 50, b[5]] : b))
    const b = await run(bot(), altered)
    const upTo = (r) => r.trades.filter((t) => t.decidedSession <= CAL[39])
    expect(upTo(b)).toEqual(upTo(a))
    expect(b.curve.filter((p) => p.date <= CAL[39])).toEqual(a.curve.filter((p) => p.date <= CAL[39]))
  })

  it('P&L reconciles with FIFO accounting of its own hypothetical fills', async () => {
    const r = await run(bot(), rising, { executionModel: 'same_close' })
    const fills = r.trades.map((t, i) => ({ id: `f${i}`, ticker: t.ticker, direction: t.side, filledQuantity: t.quantity, filledPrice: t.price, fees: 0, filledAt: new Date(`${t.session}T21:00:00Z`) }))
    const fifo = calculateFifoAccounting(fills, { currentPrices: { SPY: rising[59][4] } })
    expect(r.metrics.pnl).toBeCloseTo(fifo.performance.totalPnl, 2)
    expect(r.curve.at(-1).equity).toBeCloseTo(5000 + fifo.performance.totalPnl, 2)
  })

  it('applies the normal risk policy on point-in-time liquidity (volume vs its prior 20-session average)', async () => {
    const thin = series((i) => 100 + i, (i) => (i >= 25 ? 2e5 : 2e6)) // volume collapses to 10% inside the range
    const r = await run(bot(), thin)
    // A collapse vs the average scores liquidity 20 → execution 20 < 50: rejected, never traded.
    expect(r.events[0]).toMatchObject({ type: 'risk_blocked', basis: 'rejected', reason: 'execution_weak', scores: { operational: 100, execution: 20 } })
    expect(r.trades.filter((t) => t.decidedSession < CAL[35])).toHaveLength(0)
    // Once the 20-session average reflects the new volume, the same close is ordinary again.
    expect(r.trades.length).toBeGreaterThan(0)
  })

  it('reports buy-and-hold on the same capital and execution model', async () => {
    const r = await run(bot(), rising, { executionModel: 'next_open' })
    expect(r.buyAndHold.capital).toBe(5000)
    expect(r.buyAndHold.shares.SPY).toBe(Math.floor(5000 / (126 - 1))) // bought at the 2nd session's open
    expect(r.hypothetical).toBe(true)
    expect(r.riskPolicyVersion).toMatch(/^normal-[0-9a-f]{12}$/)
  })

  it('sells only what it bought, and respects a cooldown across sessions', async () => {
    const r = await run(bot({ direction: 'sell' }, [{ type: 'price_threshold', config: { operator: 'above', price: 1 } }]), rising)
    expect(r.trades).toHaveLength(0) // holds nothing → never sells
    expect(r.skips.no_position).toBeGreaterThan(0)
    const cd = await run(bot({}, [{ type: 'price_threshold', config: { operator: 'above', price: 105 } }, { type: 'cooldown', config: { cooldownHours: 24 * 7 } }]), rising, { executionModel: 'same_close' })
    const gaps = cd.trades.slice(1).map((t, i) => (Date.parse(t.decidedSession) - Date.parse(cd.trades[i].decidedSession)) / 86_400_000)
    expect(gaps.every((g) => g >= 7)).toBe(true)
  })
})
