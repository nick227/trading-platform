import { describe, it, expect } from 'vitest'
import { relativeVolumeDecision, priceChangeDecision } from '../../../worker/src/engine/rules/marketConditions.js'
import { ruleDecision } from '../../../worker/src/engine/decisionCore.js'
import { ruleConfigError } from '../../src/utils/ruleConfig.js'
import { runBacktest } from '../../../worker/src/backtest/historicalRunner.js'

describe('market-aware conditions', () => {
  it('relative volume compares the session with its prior 20-session average', () => {
    expect(relativeVolumeDecision({ minRatio: 1.5 }, { volume: 3e6, avgVolume: 2e6 })).toMatchObject({ pass: true, detail: 'volume 1.5× average' })
    expect(relativeVolumeDecision({ minRatio: 1.5 }, { volume: 2e6, avgVolume: 2e6 })).toMatchObject({ pass: false, reason: 'relative_volume_below' })
    expect(relativeVolumeDecision({ minRatio: 1 }, { volume: 2e6, avgVolume: null })).toMatchObject({ pass: false, reason: 'relative_volume_unavailable' })
  })
  it('price change compares the close with the close N sessions earlier, failing closed without history', () => {
    const closes = [100, 101, 99, 104, 106]
    expect(priceChangeDecision({ sessions: 4, operator: 'above', pct: 5 }, { closes })).toMatchObject({ pass: true, detail: '6% over 4 sessions' })
    expect(priceChangeDecision({ sessions: 4, operator: 'above', pct: 7 }, { closes })).toMatchObject({ pass: false, reason: 'price_change_rise_not_met' })
    expect(priceChangeDecision({ sessions: 2, operator: 'below', pct: 1 }, { closes: [100, 98, 97] })).toMatchObject({ pass: true })
    expect(priceChangeDecision({ sessions: 10, operator: 'above', pct: 1 }, { closes })).toMatchObject({ pass: false, reason: 'price_change_unavailable' })
  })
  it('are evaluated by the shared decision core and validated like other rules', () => {
    expect(ruleDecision({ type: 'relative_volume', config: { minRatio: 2 } }, { volume: 5, avgVolume: 2 }).pass).toBe(true)
    expect(ruleDecision({ type: 'price_change', config: { sessions: 1, operator: 'above', pct: 1 } }, { closes: [100, 102] }).pass).toBe(true)
    expect(ruleConfigError('relative_volume', { minRatio: 0 })).toMatch(/between 0 and 10/)
    expect(ruleConfigError('price_change', { sessions: 61, operator: 'above', pct: 2 })).toMatch(/1–60/)
    expect(ruleConfigError('price_change', { sessions: 5, operator: 'sideways', pct: 2 })).toMatch(/rise/)
    expect(ruleConfigError('price_change', { sessions: 5, operator: 'below', pct: 3 })).toBeNull()
  })
  it('backtests use only bars known at each session for both conditions', async () => {
    const cal = []
    for (let t = Date.UTC(2025, 0, 6); cal.length < 80; t += 86_400_000) { const d = new Date(t); if (d.getUTCDay() % 6) cal.push(d.toISOString().slice(0, 10)) }
    // Flat 100 with one 8% jump on session 60 and a volume spike that day.
    const bars = cal.map((d, i) => { const c = i >= 60 ? 108 : 100; return [d, c, c, c, c, i === 60 ? 6e6 : 2e6] })
    const r = await runBacktest({ bot: { id: 'b', config: { tickers: ['SPY'], direction: 'buy', allocatedAmount: 5000, maxOrderNotional: 1000 },
      rules: [{ type: 'price_change', config: { sessions: 5, operator: 'above', pct: 5 } }, { type: 'relative_volume', config: { minRatio: 2 } }] },
      symbols: ['SPY'], start: cal[30], end: cal[79], executionModel: 'same_close', startingCash: 100_000,
      data: { bars: { SPY: bars }, calendar: cal, regimes: {}, unusable: [] } })
    expect(r.trades.map((t) => t.decidedSession)).toEqual([cal[60]]) // only the jump-and-spike session
  })
})
