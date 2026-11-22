import { describe, it, expect } from 'vitest'
import { describeAction, describeGuards, needsTriggerPrice } from '../describeBot'
import { collapseRoutine, groupTrades, inLens } from '../ActivityFeed'
import { niceTicks } from '../ValueChart'
import { signedMoney, signedPct, money, sessionDate } from '../format'

describe('describeBot (plain-language rules)', () => {
  const dca = { config: { direction: 'buy', tickers: ['SPY'], allocatedAmount: 5000, maxOrderNotional: 750 }, rules: [{ type: 'market_hours', config: {} }, { type: 'cooldown', config: { windowMs: 86_400_000 } }] }

  it('describes what the bot does from its actual config and rules', () => {
    expect(describeAction(dca)).toBe('Buys SPY on a fixed schedule — once every day, whatever the price.')
    expect(describeGuards(dca)).toEqual(['Up to $750 per order', '$5,000 simulated capital', 'Regular market hours only', 'At most one trade per symbol per day'])
  })

  it('omits template capital defaults, which the user chooses', () => {
    expect(describeGuards(dca, { template: true })).toEqual(['Regular market hours only', 'At most one trade per symbol per day'])
  })

  it('never presents an unset trigger price as $0', () => {
    const t = { config: { direction: 'buy', tickers: ['SPY'] }, rules: [{ type: 'price_threshold', config: { price: 0 } }] }
    expect(needsTriggerPrice(t.rules)).toBe(true)
    expect(describeAction(t)).toBe('Buys SPY when the price rises above a trigger price you set.')
    expect(describeAction({ ...t, rules: [{ type: 'price_threshold', config: { price: 725 } }] })).toBe('Buys SPY when the price rises above $725.')
  })

  it('states research requirements, including when edge is not required', () => {
    const r = { config: { signalSource: 'alpha_research', tickers: ['AAPL'], research: { minConfidence: 0.45, maxPredictionAgeHours: 96, maxEntryDriftPct: 5, requireEdgeOverBaseline: false } }, rules: [] }
    expect(describeAction(r)).toMatch(/^Buys AAPL when Alpha Engine publishes current, verified BUY research/)
    expect(describeGuards(r)).toContain('Research must be score ≥ 45, under 96h old, price within 5% of entry')
    expect(describeGuards(r)).toContain('Includes research without a proven edge')
  })
})

describe('activity feed', () => {
  it('collapses routine checks anywhere in the list into their newest entry', () => {
    const items = [
      { id: 1, category: 'skip', title: 'Waiting — cooldown', symbol: 'SPY', botId: 'b', at: '3' },
      { id: 2, category: 'fill', title: 'Bought 1 SPY', symbol: 'SPY', botId: 'b', at: '2' },
      { id: 3, category: 'skip', title: 'Waiting — cooldown', symbol: 'SPY', botId: 'b', at: '1' },
    ]
    const out = collapseRoutine(items)
    expect(out.map((i) => i.id)).toEqual([1, 2])
    expect(out[0].count).toBe(2)
    expect(out[0].since).toBe('1')
  })

  it('filters by lens', () => {
    expect(inLens({ kind: 'trade', steps: [] }, 'trades')).toBe(true)
    expect(inLens({ category: 'skip' }, 'trades')).toBe(false)
    expect(inLens({ category: 'risk' }, 'decisions')).toBe(true)
  })

  it('folds a trade into one row (signal, order, fill) with the outcome as its head, keeping every step', () => {
    const rows = groupTrades([
      { id: 'f', category: 'fill', title: 'Bought 1 SPY', symbol: 'SPY', botId: 'b', executionId: 'x1', at: '2026-11-21T10:00:05Z' },
      { id: 'o', category: 'order', title: 'Buy order placed', symbol: 'SPY', botId: 'b', executionId: 'x1', testScenario: true, at: '2026-11-21T10:00:01Z' },
      { id: 's', category: 'signal', title: 'Signal: buy', symbol: 'SPY', botId: 'b', at: '2026-11-21T10:00:00Z' },
      { id: 'w', category: 'skip', title: 'Waiting — cooldown', symbol: 'SPY', botId: 'b', at: '2026-11-21T09:00:00Z' },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ kind: 'trade', title: 'Bought 1 SPY', testScenario: true, filled: true })
    expect(rows[0].steps.map((x) => x.id)).toEqual(['s', 'o', 'f'])
    expect(rows[1].id).toBe('w')
  })

  it('heads a cancelled trade with its outcome, not the order', () => {
    const [row] = groupTrades([
      { id: 'o', category: 'order', title: 'Sell order placed', symbol: 'SPY', botId: 'b', executionId: 'x2', at: '2026-11-21T10:00:01Z' },
      { id: 'c', category: 'order', outcome: true, title: 'Order cancelled', symbol: 'SPY', botId: 'b', executionId: 'x2', at: '2026-11-21T10:00:00Z' },
    ])
    expect(row).toMatchObject({ title: 'Order cancelled', filled: false })
  })
})

describe('formatting', () => {
  it('formats signed values and never turns missing into zero', () => {
    expect(signedMoney(-33.25)).toBe('−$33.25')
    expect(signedMoney(12)).toBe('+$12.00')
    expect(signedMoney(null)).toBe('—')
    expect(money(undefined)).toBe('—')
    expect(signedPct(-0.16)).toBe('−0.16%')
    expect(sessionDate('2026-11-20')).toBe('Nov 20')
  })

  it('picks round chart ticks', () => {
    expect(niceTicks(99830, 100010, 3)).toEqual([99850, 99900, 99950, 100000])
    expect(niceTicks(318, 362, 3)).toEqual([320, 340, 360])
  })
})
