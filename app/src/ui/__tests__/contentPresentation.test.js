import { describe, it, expect } from 'vitest'
import { evidenceLabel, evidenceState, decisionState, strategyOverview, uniqueStatements, describeEvaluationTiming } from '../contentPresentation'

describe('user-facing evidence terminology', () => {
  it('differentiates historical results from simulated post-publication evidence', () => {
    expect(evidenceLabel('forward')).toContain('since publication')
    expect(evidenceLabel('5Y')).toContain('Historical')
  })
  it('does not turn missing data into zero performance', () => {
    expect(evidenceState(null, 'forward').title).toMatch(/Results pending/)
    expect(evidenceState({ status: 'ok' }, 'forward')).toBeNull()
    expect(evidenceState({ status: 'insufficient_data' }).title).toMatch(/Not enough/)
    expect(evidenceState({ status: 'not_backtestable', reason: 'Forward performance evaluation is not configured for this strategy' }).title).toBe('Evaluation not configured')
    expect(decisionState('error', 0).description).toContain('does not mean')
  })
  it('preserves sourced strategy wording and only specializes confirmed AI type', () => {
    expect(strategyOverview({ description: 'Buys on a condition.' })).toBe('Buys on a condition.')
    expect(strategyOverview({ tags: ['ai'] })).toContain('has not yet been published')
  })
  it('deduplicates exact display clauses and omits unknown scheduling', () => {
    expect(uniqueStatements(['Daily.', 'Daily', 'After close'])).toEqual(['Daily.', 'After close'])
    expect(describeEvaluationTiming({})).toBeNull()
    expect(describeEvaluationTiming({}, { isAi: true })).toMatch(/close/)
  })
})
