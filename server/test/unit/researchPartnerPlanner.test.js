
import { describe, it, expect, vi } from 'vitest'
import { validateResearchPlan, planResearchInvestigation } from '../../src/services/researchPartner/researchPlanner.js'
import { defaultMandate } from '../../src/services/researchPartner/mandate.js'
describe('RP-10 bounded research planning', () => {
  it('normalizes permissible ticker hypotheses and source selection', () => {
    expect(validateResearchPlan({ symbols: ['nvda'], sourceIds: ['filings','news'],
      questions: ['What do the filings say?'], rationale: 'Evaluate demand' })).toEqual({
        symbols: ['NVDA'], sourceIds: ['filings','news'], questions: ['What do the filings say?'],
        rationale: 'Evaluate demand'
      })
  })
  it('rejects tool escalation, arbitrary URLs and unbounded symbols', () => {
    const base = { symbols: ['AAPL'], sourceIds: ['news'], questions: [], rationale: '' }
    expect(() => validateResearchPlan({ ...base, sourceIds: ['broker_orders'] })).toThrow(/Unauthorized/)
    expect(() => validateResearchPlan({ ...base, symbols: ['https://example.org'] })).toThrow()
    expect(() => validateResearchPlan({ ...base, symbols: Array.from({length: 9}, (_,i)=>'ABC'+i) })).toThrow()
  })
  it('reserves and settles planning separately from final synthesis', async () => {
    const governor = { reserve: vi.fn().mockResolvedValue({ id: 'r' }), settle: vi.fn().mockResolvedValue({ settled: true }) }
    const provider = { completeStructured: vi.fn().mockResolvedValue({
      structured: { symbols: ['AAPL'], sourceIds: ['filings'], questions: [], rationale: 'Look at filings' },
      usage: { prompt_tokens: 300, completion_tokens: 100 }
    }) }
    const plan = await planResearchInvestigation({
      userId: 'u', partnerId: 'p', sessionId: 's', question: 'Research margins',
      mandate: defaultMandate('Investigate industrial technology'), governor, provider
    })
    expect(plan.status).toBe('proposed_unverified')
    expect(governor.reserve).toHaveBeenCalledWith(expect.objectContaining({jobKey:'rp_plan:s'}))
    expect(governor.settle).toHaveBeenCalledOnce()
  })
})
