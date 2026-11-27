import { describe, expect, it, vi } from 'vitest'
import { createMandateProposalRuntime } from '../../src/services/researchPartner/mandateProposalRuntime.js'
import { defaultMandate } from '../../src/services/researchPartner/mandate.js'
const partner = { id: 'p', mandate: { content: defaultMandate('Research data centers') } }
describe('RP-07 governed AI mandate proposals', () => {
  it('uses no provider for default manual preview', async () => {
    const provider = { completeStructured: vi.fn() }
    const runtime = createMandateProposalRuntime({ provider, governor: { enabled: () => false } })
    const result = await runtime.propose({ userId: 'u', partner, instructions: 'Research power generation' })
    expect(result.mode).toBe('manual_preview')
    expect(provider.completeStructured).not.toHaveBeenCalled()
  })
  it('blocks paid proposals without explicit operator enablement', async () => {
    const provider = { completeStructured: vi.fn() }
    const runtime = createMandateProposalRuntime({ provider, governor: { enabled: () => false } })
    await expect(runtime.propose({ userId: 'u', partner, instructions: 'Research power', useAI: true }))
      .rejects.toMatchObject({ statusCode: 503 })
    expect(provider.completeStructured).not.toHaveBeenCalled()
  })
  it('reserves and settles authorized AI proposal calls', async () => {
    const governor = { enabled: () => true, reserve: vi.fn().mockResolvedValue({ id: 'res' }),
      settle: vi.fn().mockResolvedValue({ settled: true }) }
    const provider = { completeStructured: vi.fn().mockResolvedValue({
      structured: { mandate: partner.mandate.content, clarifyingQuestions: [] },
      usage: { prompt_tokens: 20, completion_tokens: 40 }
    }) }
    const result = await createMandateProposalRuntime({ provider, governor }).propose({
      userId: 'u', partner, instructions: 'Keep current direction', useAI: true
    })
    expect(result.mode).toBe('model_proposal')
    expect(governor.reserve).toHaveBeenCalledOnce()
    expect(governor.settle).toHaveBeenCalledOnce()
  })
})
