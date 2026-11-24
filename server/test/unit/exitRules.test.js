import { describe, it, expect } from 'vitest'
import { exitQuantity, exitRulesOf, ruleDecision, runExitRules } from '../../../worker/src/engine/decisionCore.js'
import { runBacktest } from '../../../worker/src/backtest/historicalRunner.js'
import { ruleConfigError } from '../../src/utils/ruleConfig.js'

describe('exit rules (shared decision core)', () => {
  it('stop-loss triggers at pct below the bot’s own average cost', () => {
    expect(ruleDecision({ type: 'stop_loss', config: { pct: 10 } }, { price: 89, avgCost: 100 })).toMatchObject({ pass: true })
    expect(ruleDecision({ type: 'stop_loss', config: { pct: 10 } }, { price: 91, avgCost: 100 })).toMatchObject({ pass: false, reason: 'stop_loss_not_hit' })
    expect(ruleDecision({ type: 'stop_loss', config: { pct: 10 } }, { price: 50, avgCost: null })).toMatchObject({ pass: false, reason: 'stop_loss_no_position' })
    expect(ruleConfigError('stop_loss', { pct: 0 })).toMatch(/between 0% and 90%/)
  })
  it('any exit rule triggers an exit; only supported types count', async () => {
    const bot = { config: { exit: { rules: [{ type: 'stop_loss', config: { pct: 10 } }, { type: 'price_change', config: { sessions: 2, operator: 'below', pct: 5 } }, { type: 'cooldown', config: {} }] } } }
    expect(exitRulesOf(bot).map((r) => r.type)).toEqual(['stop_loss', 'price_change'])
    const ex = await runExitRules(exitRulesOf(bot), (r) => ruleDecision(r, { price: 95, avgCost: 100, closes: [100, 98, 94] }))
    expect(ex).toMatchObject({ exit: true, rule: { type: 'price_change' } })
  })
  it('an exit order sells the bot’s shares in steps of its per-order limit, never more than it holds', () => {
    expect(exitQuantity({ bot: { config: { maxOrderNotional: 2000 } }, price: 400, held: 25 })).toBe(5)
    expect(exitQuantity({ bot: { config: { maxOrderNotional: 2000 } }, price: 400, held: 3 })).toBe(3)
    expect(exitQuantity({ bot: { config: { maxOrderNotional: 100 } }, price: 400, held: 3 })).toBe(0)
    expect(exitQuantity({ bot: { config: {} }, price: 400, held: 7 })).toBe(7)
    expect(exitQuantity({ bot: { config: { maxOrderNotional: 2000 } }, price: 400, held: 0 })).toBe(0)
  })
})

describe('exits in backtests', () => {
  const cal = []
  for (let t = Date.UTC(2025, 0, 6); cal.length < 90; t += 86_400_000) { const d = new Date(t); if (d.getUTCDay() % 6) cal.push(d.toISOString().slice(0, 10)) }
  // Rises to session 40, then falls 30%.
  const bars = cal.map((d, i) => { const c = i <= 40 ? 100 + i : 140 - (i - 40) * 1.2; return [d, c, c, c, c, 2e6] })
  const bot = (exit) => ({ id: 'b', config: { tickers: ['SPY'], direction: 'buy', allocatedAmount: 5000, maxOrderNotional: 1000, ...(exit ? { exit: { rules: exit } } : {}) },
    rules: [{ type: 'cooldown', config: { cooldownHours: 24 * 7 } }] })
  const run = (b) => runBacktest({ bot: b, symbols: ['SPY'], start: cal[25], end: cal[89], executionModel: 'next_open', startingCash: 100_000, data: { bars: { SPY: bars }, calendar: cal, regimes: {}, unusable: [] } })

  it('without exits it holds through the fall; with a stop-loss it sells only its own shares', async () => {
    const hold = await run(bot(null))
    expect(hold.trades.every((t) => t.side === 'buy')).toBe(true)
    const guarded = await run(bot([{ type: 'stop_loss', config: { pct: 10 } }]))
    const sells = guarded.trades.filter((t) => t.side === 'sell')
    expect(sells.length).toBeGreaterThan(0)
    expect(sells.every((s) => s.exit === 'stop_loss' && s.quantity * s.price <= 1000 + 160)).toBe(true) // per-order sized (next-open price drift)
    let held = 0
    for (const t of guarded.trades) { held += t.side === 'buy' ? t.quantity : -t.quantity; expect(held).toBeGreaterThanOrEqual(0) } // never short
    expect(guarded.metrics.maxDrawdown.pct).toBeLessThan(hold.metrics.maxDrawdown.pct)
  })
})
