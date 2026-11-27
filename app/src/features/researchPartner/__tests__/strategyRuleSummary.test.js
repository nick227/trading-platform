import { describe, expect, it } from 'vitest'
import { summarizeRule, summarizeStrategy } from '../strategyRuleSummary'

describe('human-readable paper strategy rules', () => {
  it('explains deterministic thresholds without converting percent values', () => {
    expect(summarizeRule({ field: 'return20dPct', operator: 'gte', value: 5 }))
      .toBe('20-session price change at least 5%')
    expect(summarizeRule({ field: 'price', operator: 'lte', value: 120 }))
      .toBe('Last recorded price at most 120 USD')
  })
  it('preserves all entry and exit conditions and paper limits', () => {
    const summary = summarizeStrategy({
      cadence: 'weekly',
      universe: { symbols: ['AAPL', 'MSFT'] },
      entryRules: [
        { field: 'return20dPct', operator: 'gte', value: 5 },
        { field: 'volumeRatio', operator: 'gte', value: 1.5 }
      ],
      exitRules: [{ field: 'return5dPct', operator: 'lte', value: -3 }],
      risk: { maxPositionPct: 0.1, maxOrderNotional: 1000 }
    })
    expect(summary.universe).toBe('AAPL, MSFT')
    expect(summary.cadence).toBe('Once each week')
    expect(summary.entries).toHaveLength(2)
    expect(summary.exits).toHaveLength(1)
    expect(summary.position).toBe('10% of the paper account')
    expect(summary.order).toBe('$1,000')
  })
  it('does not invent descriptions for unsupported rules', () => {
    expect(summarizeRule({ field: 'arbitraryModelSignal', operator: 'gte', value: 1 }))
      .toBe('Review unsupported rule')
  })
})
