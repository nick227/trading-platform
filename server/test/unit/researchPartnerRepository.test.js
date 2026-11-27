
import { describe, expect, it, vi } from 'vitest'
import { createResearchPartnerRepository } from '../../src/services/researchPartner/repository.js'

const content = {
  objective: 'Research clean energy infrastructure',
  interests: [], watchlist: [], hypotheses: [],
  preferences: { horizon: 'long', researchDepth: 'standard' }, exclusions: []
}
const partner = { id: 'partner-1', userId: 'user-a', status: 'draft', currentMandateVersion: 1,
  updatedAt: new Date('2026-11-26T00:00:00Z') }
function mockDb() {
  const db = {
    researchPartner: {
      create: vi.fn().mockResolvedValue(partner),
      findFirst: vi.fn().mockResolvedValue(partner),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([partner])
    },
    researchMandateVersion: {
      create: vi.fn().mockResolvedValue({ partnerId: partner.id, version: 1, content }),
      findUnique: vi.fn().mockResolvedValue({ partnerId: partner.id, version: 1, content }),
      findMany: vi.fn().mockResolvedValue([])
    }
  }
  db.$transaction = vi.fn(fn => fn(db))
  return db
}
describe('RP-02 authenticated research partner repository', () => {
  it('atomically creates a draft with immutable mandate version 1', async () => {
    const db = mockDb()
    const result = await createResearchPartnerRepository(db).create('user-a', { name: 'Energy', mandate: content })
    expect(result.mandate.version).toBe(1)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.researchPartner.create).toHaveBeenCalledWith({
      data: { userId: 'user-a', name: 'Energy', status: 'draft', currentMandateVersion: 1 }
    })
  })
  it('rejects cross-user retrieval and revision by always scoping owner', async () => {
    const db = mockDb()
    db.researchPartner.findFirst.mockResolvedValue(null)
    const repo = createResearchPartnerRepository(db)
    await expect(repo.get('user-b', 'partner-1')).rejects.toMatchObject({ statusCode: 404 })
    await expect(repo.reviseMandate('user-b', 'partner-1', 1, content)).rejects.toMatchObject({ statusCode: 404 })
    expect(db.researchPartner.findFirst).toHaveBeenCalledWith({ where: { id: 'partner-1', userId: 'user-b' } })
  })
  it('uses compare-and-swap for mandate updates and rejects stale versions', async () => {
    const db = mockDb()
    const repo = createResearchPartnerRepository(db)
    await repo.reviseMandate('user-a', 'partner-1', 1, content)
    expect(db.researchPartner.updateMany).toHaveBeenCalledWith({
      where: { id: 'partner-1', userId: 'user-a', status: { not: 'archived' }, currentMandateVersion: 1 },
      data: { currentMandateVersion: 2 }
    })
    db.researchPartner.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(repo.reviseMandate('user-a', 'partner-1', 1, content)).rejects.toMatchObject({ statusCode: 409 })
  })
  it('soft-archives owned partners', async () => {
    const db = mockDb()
    await createResearchPartnerRepository(db).archive('user-a', 'partner-1')
    expect(db.researchPartner.updateMany).toHaveBeenCalledWith({
      where: { id: 'partner-1', userId: 'user-a', status: { not: 'archived' } },
      data: { status: 'archived', archivedAt: expect.any(Date) }
    })
  })
})
