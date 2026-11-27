import { describe, expect, it, vi } from 'vitest'
import { createResearchPartnerEvidenceCollector, RESEARCH_PARTNER_EVIDENCE_SOURCES } from '../../src/services/researchPartner/evidenceBridge.js'
import { defaultMandate } from '../../src/services/researchPartner/mandate.js'
describe('RP-07 evidence bridge', () => {
  it('uses shared registry with bounded watchlist and retrieval cutoff', async () => {
    const registry = { assemble: vi.fn().mockResolvedValue({
      records: [{ id: 'news:x', sourceId: 'news', title: 'Article', url: 'https://example.com',
        kind: 'text', quality: 'reported', content: 'Untrusted source text',
        publishedAt: '2026-11-26T10:00:00.000Z', availableAt: '2026-11-26T10:00:00.000Z',
        retrievedAt: '2026-11-26T12:00:00.000Z', contentHash: 'hash', trustBoundary: 'untrusted_text' }],
      unavailable: [], asOfSession: '2026-11-26', fingerprint: 'fingerprint'
    }) }
    const collect = createResearchPartnerEvidenceCollector({ registry, clock: () => new Date('2026-11-26T13:00:00.000Z') })
    const result = await collect({ mandate: { ...defaultMandate('Research AI'), watchlist: ['NVDA'] } })
    expect(RESEARCH_PARTNER_EVIDENCE_SOURCES).toEqual(['news', 'filings'])
    expect(registry.assemble).toHaveBeenCalledWith(expect.objectContaining({
      sourceIds: ['news', 'filings'], retrievedCutoff: '2026-11-26T13:00:00.000Z',
      input: expect.objectContaining({ screening: { shortlist: [{ symbol: 'NVDA' }] } })
    }))
    expect(result.records[0].source).toBe('news')
    expect(result.records[0].trustBoundary).toBe('untrusted_text')
  })
})
