
import { describe, expect, it, vi } from 'vitest'
import { createMandateDialogueService } from '../../src/services/researchPartner/mandateDialogue.js'
import { defaultMandate } from '../../src/services/researchPartner/mandate.js'
const mandate = defaultMandate('Research robotics')
function fixture() {
  const partner = { id: 'p', currentMandateVersion: 2, mandate: { content: mandate } }
  const dialogue = { id: 'd', partnerId: 'p', baseVersion: 2, status: 'draft', revision: 1,
    transcript: [{ role: 'user', content: 'Research robotics' }], proposal: { mandate } }
  const db = { researchMandateDialogue: {
    create: vi.fn().mockResolvedValue(dialogue),
    findFirst: vi.fn().mockResolvedValue(dialogue),
    updateMany: vi.fn().mockResolvedValue({ count: 1 })
  } }
  const partnerRepo = { get: vi.fn().mockResolvedValue(partner), reviseMandate: vi.fn().mockResolvedValue({ version: 3 }) }
  const proposals = { propose: vi.fn().mockResolvedValue({ mandate, saved: false, clarifyingQuestions: ['What time horizon?'] }) }
  return { db, partnerRepo, proposals, dialogue }
}
describe('RP-09 conversational research mandate', () => {
  it('saves an unsanctioned draft with explicit user input', async () => {
    const f = fixture()
    await createMandateDialogueService(f).start('u','p','Research robotics')
    expect(f.db.researchMandateDialogue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ partnerId: 'p', baseVersion: 2, status: 'draft', revision: 1 })
    })
    expect(f.partnerRepo.reviseMandate).not.toHaveBeenCalled()
  })
  it('persists bounded turns using optimistic revision checks', async () => {
    const f = fixture()
    await createMandateDialogueService(f).addTurn('u','p','d',{ text: 'Focus on durable margins', expectedRevision: 1 })
    expect(f.db.researchMandateDialogue.updateMany).toHaveBeenCalledWith({
      where: { id: 'd', partnerId: 'p', revision: 1, status: 'draft' },
      data: expect.objectContaining({ revision: 2, transcript: expect.any(Array) })
    })
  })
  it('only approval writes an immutable mandate revision', async () => {
    const f = fixture()
    await createMandateDialogueService(f).approve('u','p','d',1)
    expect(f.partnerRepo.reviseMandate).toHaveBeenCalledWith('u','p',2,mandate)
    await expect(createMandateDialogueService(f).approve('u','p','d',2)).rejects.toMatchObject({ statusCode: 409 })
  })
})
