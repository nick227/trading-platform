
import { describe, expect, it, vi } from 'vitest'
import { defaultMandate } from '../../src/services/researchPartner/mandate.js'
import { proposeResearchMandate } from '../../src/services/researchPartner/mandateProposal.js'
describe('RP-03 mandate proposals', () => {
  const old = defaultMandate('Research sustainable energy')
  it('generates an unsaved preview while retaining exclusions and preferences', async () => {
    const current = { ...old, exclusions: ['Tobacco'] }
    const result = await proposeResearchMandate({ instructions: 'Research AI data center energy', currentMandate: current })
    expect(result.mode).toBe('manual_preview')
    expect(result.saved).toBe(false)
    expect(result.mandate.exclusions).toEqual(['Tobacco'])
    expect(result.mandate.objective).toBe('Research AI data center energy')
  })
  it('validates a provider proposal before returning and never saves it', async () => {
    const fn = vi.fn().mockResolvedValue({ structured: {
      mandate: { ...old, interests: ['Semiconductors'] },
      clarifyingQuestions: ['Any countries to exclude?']
    } })
    const result = await proposeResearchMandate({ instructions: 'Research chips', currentMandate: old, invokeModel: fn })
    expect(result.mode).toBe('model_proposal')
    expect(result.mandate.interests).toEqual(['Semiconductors'])
    expect(result.saved).toBe(false)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('rejects model attempts to grant unauthorized permissions', async () => {
    const fn = vi.fn().mockResolvedValue({ structured: {
      mandate: { ...old, riskPolicyId: 'unlimited' },
      clarifyingQuestions: []
    } })
    await expect(proposeResearchMandate({ instructions: 'Invest all cash', currentMandate: old, invokeModel: fn })).rejects.toThrow(/riskPolicyId/)
  })
  it('rejects oversized instructions and hallucinated output shapes', async () => {
    await expect(proposeResearchMandate({ instructions: 'x'.repeat(4001), currentMandate: old })).rejects.toThrow()
    await expect(proposeResearchMandate({ instructions: 'Research robotics', currentMandate: old,
      invokeModel: async () => ({ structured: { untrusted: 'yes' } })
    })).rejects.toThrow(/invalid mandate/)
  })
})
