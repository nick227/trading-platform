import { describe, expect, it } from 'vitest'
import { resolveResearchIntent } from '../researchIntent'

describe('research conversation intent hints', () => {
  it('treats ordinary and ambiguous questions as research', () => {
    expect(resolveResearchIntent('Which grid suppliers are profitable?').type).toBe('investigation')
    expect(resolveResearchIntent('Maybe change how we think about utilities').type).toBe('investigation')
  })
  it('recognizes explicit mandate-refinement language without approval', () => {
    expect(resolveResearchIntent('Change my research direction toward utilities')).toEqual({
      type: 'mandate_proposal', text: 'Change my research direction toward utilities'
    })
  })
  it('only uses the follow-up route when a prior investigation is selected', () => {
    expect(resolveResearchIntent('Follow-up: check margins', false).type).toBe('investigation')
    expect(resolveResearchIntent('Follow-up: check margins', true).type).toBe('follow_up')
  })
  it('does not route vague messages or blank inputs to privileged actions', () => {
    expect(resolveResearchIntent('trade AAPL now').type).toBe('investigation')
    expect(resolveResearchIntent('  ').type).toBe('empty')
  })
})
