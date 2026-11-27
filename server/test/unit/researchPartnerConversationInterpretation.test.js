import { describe, it, expect, vi } from 'vitest'
import {
  validateConversationInterpretation, createConversationInterpreter
} from '../../src/services/researchPartner/conversationInterpretation.js'

describe('Research Partner conversational intent preview', () => {
  it('accepts bounded intent proposals, never autonomous authority', () => {
    expect(validateConversationInterpretation({
      type: 'mandate_proposal', explanation: 'Change the research objective.'
    })).toEqual({
      type: 'mandate_proposal', explanation: 'Change the research objective.',
      clarification: null, requiresConfirmation: true, executesAutomatically: false
    })
  })

  it('refuses model hallucinations and missing clarifications', () => {
    expect(() => validateConversationInterpretation({
      type: 'place_order', explanation: 'Buy now'
    })).toThrow(/Invalid conversation interpretation/)
    expect(() => validateConversationInterpretation({
      type: 'clarify', explanation: 'More detail is required.'
    })).toThrow(/Missing clarification/)
  })

  it('cannot attach a follow-up to an incomplete or absent session', () => {
    const input = { type: 'follow_up', explanation: 'Investigate the previous finding.' }
    expect(validateConversationInterpretation(input).type).toBe('investigation')
    expect(validateConversationInterpretation(input, { hasCompletedSession: true }).type).toBe('follow_up')
  })

  it('requires opt-in enabled budget and never calls the model when disabled', async () => {
    const governor = { enabled: () => false, reserve: vi.fn() }
    const provider = { completeStructured: vi.fn() }
    const runtime = createConversationInterpreter({ governor, provider })
    await expect(runtime.interpret({
      userId: 'owner', partnerId: 'partner', text: 'Investigate utilities'
    })).rejects.toMatchObject({ statusCode: 503 })
    expect(governor.reserve).not.toHaveBeenCalled()
    expect(provider.completeStructured).not.toHaveBeenCalled()
  })

  it('charges usage once, validates the output and does not perform an action', async () => {
    const governor = {
      enabled: () => true,
      reserve: vi.fn().mockResolvedValue({ id: 'budget-reservation' }),
      settle: vi.fn().mockResolvedValue({ settled: true })
    }
    const provider = { completeStructured: vi.fn().mockResolvedValue({
      structured: { type: 'clarify', explanation: 'The sector is unclear.',
        clarification: 'Should I focus on electric utilities or grid equipment?' },
      usage: { prompt_tokens: 100, completion_tokens: 40 }
    }) }
    const runtime = createConversationInterpreter({ governor, provider })
    const result = await runtime.interpret({
      userId: 'owner', partnerId: 'partner', text: 'Research energy'
    })
    expect(result.type).toBe('clarify')
    expect(result.requiresConfirmation).toBe(true)
    expect(result.executesAutomatically).toBe(false)
    expect(governor.reserve).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner', partnerId: 'partner', jobKey: expect.stringMatching(/^rp_intent:/)
    }))
    expect(governor.settle).toHaveBeenCalledOnce()
    expect(provider.completeStructured).toHaveBeenCalledOnce()
  })

  it('conservatively settles unsuccessful model calls', async () => {
    const governor = {
      enabled: () => true,
      reserve: vi.fn().mockResolvedValue({ id: 'budget-reservation' }),
      settle: vi.fn().mockResolvedValue({ settled: true })
    }
    const runtime = createConversationInterpreter({
      governor, provider: { completeStructured: vi.fn().mockRejectedValue(new Error('Provider timeout')) }
    })
    await expect(runtime.interpret({
      userId: 'owner', partnerId: 'partner', text: 'Research energy'
    })).rejects.toThrow('Provider timeout')
    expect(governor.settle).toHaveBeenCalledWith(
      { id: 'budget-reservation' }, { uncertain: true }
    )
  })
})
