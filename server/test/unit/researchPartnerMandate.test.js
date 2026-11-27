
import { describe, it, expect } from 'vitest'
import { defaultMandate, validateMandate, validatePartnerName, validateResearchQuestion } from '../../src/services/researchPartner/mandate.js'
describe('RP-01 research mandates', () => {
  it('normalizes user research preferences and watchlist', () => {
    const m = validateMandate({ objective: '  Research AI power companies  ',
      interests: ['Energy'], watchlist: ['nvda'], hypotheses: ['Demand may rise'],
      preferences: { horizon: 'long', researchDepth: 'deep' }, exclusions: [] })
    expect(m.objective).toBe('Research AI power companies')
    expect(m.watchlist).toEqual(['NVDA'])
    expect(Object.isFrozen(m)).toBe(true)
  })
  it('rejects unsafe extra fields, duplicates and malformed inputs', () => {
    const m = defaultMandate('Research robotics')
    expect(() => validateMandate({ ...m, tools: ['place_order'] })).toThrow(/tools/)
    expect(() => validateMandate({ ...m, preferences: { ...m.preferences, riskPolicyId: 'unlimited' } })).toThrow(/riskPolicyId/)
    expect(() => validateMandate({ ...m, watchlist: ['AAPL', 'aapl'] })).toThrow(/duplicates/)
    expect(() => validateMandate({ ...m, watchlist: ['AAPL;DROP'] })).toThrow(/symbol/)
    expect(() => validateMandate({ ...m, objective: 'x'.repeat(2001) })).toThrow()
    expect(() => validatePartnerName('')).toThrow()
    expect(() => validateResearchQuestion('')).toThrow()
  })
  it('never grants trading authority', () => {
    const m = defaultMandate('Analyze company disclosures')
    expect(m).not.toHaveProperty('portfolioId')
    expect(m).not.toHaveProperty('executionMode')
    expect(m).not.toHaveProperty('riskPolicy')
  })
})
