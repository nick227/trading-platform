
import { describe, expect, it, vi } from 'vitest'
import { createResearchSessionService, validateResearchReport } from '../../src/services/researchPartner/researchSession.js'

describe('RP-04 research only sessions', () => {
  it('rejects invented source references and unverified claims', () => {
    const base = { summary: 'Preliminary summary', findings: [{
      claim: 'Demand could rise', assessment: 'supported', reasoning: 'No independent sources', evidenceIds: []
    }], uncertainties: [], followUpQuestions: [] }
    expect(validateResearchReport(base).findings[0].assessment).toBe('inconclusive')
    expect(validateResearchReport(base).limitations).toHaveLength(1)
    expect(() => validateResearchReport({ ...base, findings: [{ ...base.findings[0], evidenceIds: ['fabricated'] }] })).toThrow(/unavailable evidence/)
  })
  it('does not claim sessions or call providers when spending is disabled', async () => {
    const db = { researchPartner: { findFirst: vi.fn() } }
    const provider = { completeStructured: vi.fn() }
    const service = createResearchSessionService({
      db, provider, governor: { enabled: () => false }
    })
    await expect(service.run('user', 'partner', 'session')).rejects.toMatchObject({ statusCode: 503 })
    expect(provider.completeStructured).not.toHaveBeenCalled()
    expect(db.researchPartner.findFirst).not.toHaveBeenCalled()
  })
  it('pins mandate versions and saves an auditable report', async () => {
    const db = {
      researchPartner: { findFirst: vi.fn().mockResolvedValue({ id: 'p', userId: 'u' }) },
      researchSession: {
        findFirst: vi.fn().mockResolvedValue({ id: 's', partnerId: 'p', mandateVersion: 2, question: 'Study robotics' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({})
      },
      researchMandateVersion: { findUnique: vi.fn().mockResolvedValue({ content: { objective: 'Robotics', interests: [], watchlist: [], hypotheses: [], preferences: { horizon: 'medium', researchDepth: 'standard' }, exclusions: [] } }) },
      researchMessage: { create: vi.fn() }
    }
    db.$transaction = vi.fn(fn => fn(db))
    const governor = {
      enabled: () => true,
      reserve: vi.fn().mockResolvedValue({ id: 'bill-1' }),
      settle: vi.fn().mockResolvedValue({ settled: true })
    }
    const provider = { completeStructured: vi.fn().mockResolvedValue({
      structured: { summary: 'No verified sources provided', findings: [], uncertainties: [], followUpQuestions: [] },
      usage: { prompt_tokens: 30, completion_tokens: 40 }
    }) }
    const result = await createResearchSessionService({ db, provider, governor, evidenceCollector: async () => ({ records: [], unavailable: [], asOfSession: '2026-11-26', fingerprint: 'empty-fixture' }) }).run('u', 'p', 's')
    expect(result.limitations).toHaveLength(1)
    expect(db.researchMandateVersion.findUnique).toHaveBeenCalledWith({
      where: { partnerId_version: { partnerId: 'p', version: 2 } }
    })
    expect(governor.reserve).toHaveBeenCalledTimes(1)
    expect(db.researchSession.update).toHaveBeenCalledWith({
      where: { id: 's' }, data: { status: 'completed', report: expect.any(Object),
        completedAt: expect.any(Date), error: null }
    })
  })
})
