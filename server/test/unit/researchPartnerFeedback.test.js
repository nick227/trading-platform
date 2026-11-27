
import { describe, expect, it, vi } from 'vitest'
import { createResearchSessionService } from '../../src/services/researchPartner/researchSession.js'
function fixture(status = 'completed') {
  const db = {
    researchPartner: { findFirst: vi.fn().mockResolvedValue({ id: 'p', userId: 'u', currentMandateVersion: 3 }) },
    researchSession: {
      findFirst: vi.fn().mockResolvedValue({ id: 's', partnerId: 'p', status, mandateVersion: 1, report: { summary: 'Original' } }),
      create: vi.fn().mockResolvedValue({ id: 's2', parentSessionId: 's', mandateVersion: 3 })
    },
    researchMessage: { create: vi.fn().mockResolvedValue({ id: 'm1' }) }
  }
  db.$transaction = vi.fn(fn => fn(db))
  return db
}
describe('RP-06 research feedback and follow-ups', () => {
  it('appends feedback without changing existing reports', async () => {
    const db = fixture()
    await createResearchSessionService({ db }).addFeedback('u', 'p', 's', {
      text: 'This missed contrary evidence', category: 'challenge'
    })
    expect(db.researchMessage.create).toHaveBeenCalledWith({ data: {
      sessionId: 's', role: 'user', content: 'This missed contrary evidence',
      sources: { kind: 'feedback', category: 'challenge' }
    } })
    expect(db.researchSession).not.toHaveProperty('update')
  })
  it('pins a new follow-up to current mandate version while retaining lineage', async () => {
    const db = fixture()
    await createResearchSessionService({ db }).createFollowUp('u', 'p', 's', 'Reconsider the thesis')
    expect(db.researchSession.create).toHaveBeenCalledWith({ data: {
      partnerId: 'p', parentSessionId: 's', mandateVersion: 3,
      question: 'Reconsider the thesis', status: 'queued'
    } })
  })
  it('rejects feedback to unfinished research', async () => {
    const db = fixture('queued')
    await expect(createResearchSessionService({ db }).addFeedback('u', 'p', 's', {
      text: 'My concern', category: 'challenge'
    })).rejects.toMatchObject({ statusCode: 409 })
  })
})
