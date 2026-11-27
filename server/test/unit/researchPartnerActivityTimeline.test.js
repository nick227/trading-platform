import { describe, expect, it, vi } from 'vitest'
import { createResearchActivityTimeline } from '../../src/services/researchPartner/activityTimeline.js'

function makeDb() {
  return {
    researchPartner: { findFirst: vi.fn().mockResolvedValue({ id: 'p' }) },
    researchSession: { findMany: vi.fn().mockResolvedValue([]) },
    researchConversationDraft: { findMany: vi.fn().mockResolvedValue([]) },
    researchPaperStrategy: { findMany: vi.fn().mockResolvedValue([]) },
    researchPaperBacktest: { findMany: vi.fn().mockResolvedValue([]) },
    researchPaperActivation: { findMany: vi.fn().mockResolvedValue([]) }
  }
}
describe('read-only research activity timeline', () => {
  it('checks ownership before querying partner data', async () => {
    const db = makeDb()
    db.researchPartner.findFirst.mockResolvedValue(null)
    await expect(createResearchActivityTimeline({ db }).list('someone-else', 'p'))
      .rejects.toThrow()
    expect(db.researchSession.findMany).not.toHaveBeenCalled()
    expect(db.researchPartner.findFirst).toHaveBeenCalledWith({
      where: { id: 'p', userId: 'someone-else', status: { not: 'archived' } },
      select: { id: true }
    })
  })
  it('distinguishes saved questions, completed reports and failed runs', async () => {
    const db = makeDb()
    db.researchSession.findMany.mockResolvedValue([
      { id: 'a', status: 'queued', question: 'Will earnings improve?',
        createdAt: new Date('2026-11-26T01:00:00Z') },
      { id: 'b', status: 'completed', question: 'What is revenue?',
        createdAt: new Date('2026-11-25T01:00:00Z'),
        completedAt: new Date('2026-11-25T02:00:00Z'),
        report: { summary: 'Research summary' } },
      { id: 'c', status: 'failed', question: 'What happened?',
        createdAt: new Date('2026-11-24T01:00:00Z'),
        completedAt: new Date('2026-11-24T02:00:00Z'), error: 'Budget unavailable' }
    ])
    const rows = await createResearchActivityTimeline({ db }).list('u', 'p')
    expect(rows.map(row => row.kind)).toContain('research_saved')
    expect(rows.find(row => row.kind === 'research_result').detail).toBe('Research summary')
    expect(rows.find(row => row.kind === 'research_failure').status).toBe('failed')
    expect(rows.find(row => row.id === 'research_saved:a').title).toBe('Research question saved')
    expect(db.researchSession.findMany.mock.calls[0][0].take).toBeUndefined()
  })
  it('labels paper fills as simulated and avoids conflating approval with execution', async () => {
    const db = makeDb()
    db.researchPaperStrategy.findMany.mockResolvedValue([{ id: 's', name: 'Momentum',
      status: 'approved_paper_definition', currentVersion: 2,
      createdAt: new Date('2026-11-24T00:00:00Z'),
      updatedAt: new Date('2026-11-25T00:00:00Z') }])
    db.researchPaperActivation.findMany.mockResolvedValue([{ id: 'a', strategyId: 's',
      version: 2, createdAt: new Date('2026-11-26T00:00:00Z'),
      cycles: [{ id: 'c', session: '2026-11-26', createdAt: new Date('2026-11-26T23:00:00Z'),
        result: { filled: [{}] } }] }])
    const rows = await createResearchActivityTimeline({ db }).list('u', 'p')
    expect(rows.find(row => row.kind === 'strategy_approved').detail).toContain('execution not authorized')
    expect(rows.find(row => row.kind === 'paper_cycle').detail).toContain('simulated fills: 1')
    expect(rows.find(row => row.kind === 'paper_activation').detail).toContain('Simulation only')
  })
  it('uses owner-scoped relationship filters for related evidence', async () => {
    const db = makeDb()
    await createResearchActivityTimeline({ db }).list('u', 'p')
    expect(db.researchPaperBacktest.findMany.mock.calls[0][0].where)
      .toEqual({ strategy: { partnerId: 'p' } })
    expect(db.researchPaperActivation.findMany.mock.calls[0][0].where)
      .toEqual({ strategy: { partnerId: 'p' } })
  })
})
