import { describe, expect, it } from 'vitest'
import { decisionCounts, decisionLabel, strategyWindowOptions } from '../strategyPresentation'

describe('strategy presentation', () => {
  it('shows only forward evaluation for autonomous AI strategies', () => {
    expect(strategyWindowOptions(['5Y', '1Y', 'forward', 'development', 'holdout'], {}, { forwardOnly: true })).toEqual(['forward'])
  })
  it('omits inapplicable holdout windows for strategies without development data', () => {
    expect(strategyWindowOptions(['5Y', 'forward', 'development', 'holdout'], {})).toEqual(['5Y', 'forward'])
    expect(strategyWindowOptions(['5Y', 'forward', 'development', 'holdout'], { developmentEnd: '2025-01-01' })).toHaveLength(4)
  })
  it('counts decisions without treating HOLD as an order signal', () => {
    expect(decisionCounts([{ action: 'HOLD' }, { action: 'BUY' }, { action: 'SELL' }])).toEqual({ evaluated: 3, actionable: 2 })
  })
  it('does not present unknown actions as valid trading decisions', () => {
    expect(decisionLabel('HOLD')).toBe('HOLD')
    expect(decisionLabel('UNKNOWN')).toBe('—')
  })
})
