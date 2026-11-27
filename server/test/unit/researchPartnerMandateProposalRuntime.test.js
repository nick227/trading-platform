
import { describe, expect, it, vi } from 'vitest'
import { createMandateProposalRuntime } from '../../src/services/researchPartner/mandateProposalRuntime.js'
import { defaultMandate } from '../../src/services/researchPartner/mandate.js'
const partner = { id: 'p', mandate: { content: defaultMandate('Research data centers') } }
describe('RP-07 guarded AI-assisted user mandate proposals', () => {
  it('preserves manual preview without provider invocation', async () => {
    const provider = { completeStructured: vi.fn() }
    const service = createMandateProposalRuntime({ provider, governor: { enabled: () => false } })
    const result = await service.propose({ userId: 'u', partner, instructions: 'Research power infrastructure' })
    expect(result.mode).toBe('manual_preview')
    expect(provider.completeStructured).not.toHaveBeenCalled()
  })
  it('requires explicit enabled user choice for provider spending', async () => {
    const provider = { completeStructured: vi.fn() }
    const service = createMandateProposalRuntime({ provider, governor: { enabled: () => false } })
    await expect(service.propose({ userId: 'u', partner, instructions: 'Research power', useAI: true }))
      .rejects.toMatchObject({ statusCode: 503 })
    expect(provider.completeStructured).not.toHaveBeenCalled()
  })
  it('reserves, validates and settles an explicitly requested proposal', async () => {
    const governor = { enabled: () => true, reserve: vi.fn().mockResolvedValue({ id: 'r' }),
      settle: vi.fn().mockResolvedValue({ settled: true }) }
    const provider = { completeStructured: vi.fn().mockResolvedValue({
      structured: { mandate: partner.mandate.content, clarifyingQuestions: [] },
      usage: { prompt_tokens: 20, completion_tokens: 40 }
    }) }
    const result = await createMandateProposalRuntime({ governor, provider })
      .propose({ userId: 'u', partner, instructions: 'Keep current direction', useAI: true })
    expect(result.mode).toBe('model_proposal')
    expect(governor.reserve).toHaveBeenCalledTimes(1)
    expect(governor.settle).toHaveBeenCalledTimes(1)
  })
})
