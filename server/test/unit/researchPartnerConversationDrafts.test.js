import { describe, expect, it, vi } from 'vitest'
import { createConversationDraftService } from '../../src/services/researchPartner/conversationDrafts.js'

const partner = { id: 'p1', currentMandateVersion: 2 }
const initial = {
  id: 'd1', partnerId: 'p1', sessionId: 's1', mandateVersion: 2,
  revision: 1, requestText: 'Research utilities', answerText: null,
  status: 'pending', proposal: { type: 'clarify', clarification: 'Which segment?' }
}
function fixture(draft = initial) {
  const db = {
    researchSession: {
      findMany: vi.fn().mockResolvedValue([{ question: 'Earlier research', status: 'completed' }])
    },
    researchConversationDraft: {
      findFirst: vi.fn().mockResolvedValue(draft),
      findMany: vi.fn().mockResolvedValue([draft]),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'd1', ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    }
  }
  const partners = { get: vi.fn().mockResolvedValue(partner) }
  const sessions = { get: vi.fn().mockResolvedValue({ id: 's1', status: 'completed' }) }
  const interpreter = { interpret: vi.fn().mockResolvedValue({
    type: 'investigation', explanation: 'Research equipment suppliers.',
    clarification: null, requiresConfirmation: true, executesAutomatically: false
  }) }
  return { db, partners, sessions, interpreter, service: createConversationDraftService({
    db, partners, sessions, interpreter
  }) }
}
describe('persisted Research Partner conversation proposals', () => {
  it('creates an owned, version-pinned proposal with no executable authority', async () => {
    const { service, db, interpreter } = fixture()
    await service.start('u1', 'p1', { text: 'Research utilities', sessionId: 's1' })
    expect(interpreter.interpret).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', partnerId: 'p1', hasCompletedSession: true,
      context: expect.objectContaining({
        recentInvestigations: [{ question: 'Earlier research', status: 'completed' }]
      })
    }))
    expect(db.researchConversationDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mandateVersion: 2, sessionId: 's1', status: 'pending' })
    })
  })
  it('requires ownership before listing or reading drafts', async () => {
    const { service, partners, db } = fixture()
    await service.list('u1', 'p1')
    expect(partners.get).toHaveBeenCalledWith('u1', 'p1')
    expect(db.researchConversationDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { partnerId: 'p1' }, take: 25
    }))
    await service.get('u1', 'p1', 'd1')
    expect(db.researchConversationDraft.findFirst).toHaveBeenCalledWith({
      where: { id: 'd1', partnerId: 'p1' }
    })
  })
  it('resumes with original request, question, and answer, then CAS updates', async () => {
    const { service, interpreter, db } = fixture()
    const result = await service.answer('u1', 'p1', 'd1', {
      text: 'Grid equipment', expectedRevision: 1
    })
    expect(interpreter.interpret.mock.calls[0][0].text).toContain('Original request: Research utilities')
    expect(interpreter.interpret.mock.calls[0][0].text).toContain('User answer: Grid equipment')
    expect(db.researchConversationDraft.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'd1', revision: 1, answerText: null }),
      data: expect.objectContaining({ revision: { increment: 1 }, answerText: 'Grid equipment' })
    })
    expect(result.revision).toBe(2)
  })
  it('rejects stale answers before invoking the model', async () => {
    const { service, interpreter } = fixture()
    await expect(service.answer('u1', 'p1', 'd1', {
      text: 'Grid equipment', expectedRevision: 4
    })).rejects.toThrow(/stale/)
    expect(interpreter.interpret).not.toHaveBeenCalled()
  })
  it('never confirms unresolved clarification or confirms twice', async () => {
    const { service, db } = fixture()
    await expect(service.close('u1', 'p1', 'd1', {
      status: 'confirmed', expectedRevision: 1
    })).rejects.toThrow(/Answer the clarification/)
    expect(db.researchConversationDraft.updateMany).not.toHaveBeenCalled()
    await expect(service.close('u1', 'p1', 'd1', {
      status: 'confirmed', expectedRevision: 3
    })).rejects.toThrow(/stale/)
  })
  it('rejects current mandate changes when continuing', async () => {
    const ctx = fixture()
    ctx.partners.get.mockResolvedValue({ ...partner, currentMandateVersion: 3 })
    await expect(ctx.service.answer('u1', 'p1', 'd1', {
      text: 'Grid equipment', expectedRevision: 1
    })).rejects.toThrow(/Research direction changed/)
    expect(ctx.interpreter.interpret).not.toHaveBeenCalled()
  })
})
