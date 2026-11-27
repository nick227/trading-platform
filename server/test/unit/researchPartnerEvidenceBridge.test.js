
import { describe, expect, it, vi } from 'vitest'
import { createResearchPartnerEvidenceCollector, RESEARCH_PARTNER_SOURCE_IDS } from '../../src/services/researchPartner/evidenceBridge.js'
import { defaultMandate } from '../../src/services/researchPartner/mandate.js'
describe('RP-07 evidence provider bridge', () => {
  it('queries only approved evidence sources using an as-of bounded watchlist', async () => {
    const registry = { assemble: vi.fn().mockResolvedValue({
      records: [{ id: 'news:x', sourceId: 'news', title: 'Story', url: 'https://example.com/x',
        kind: 'text', quality: 'reported', content: 'Untrusted text',
        publishedAt: '2026-11-26T10:00:00.000Z', availableAt: '2026-11-26T10:00:00.000Z',
        retrievedAt: '2026-11-26T12:00:00.000Z', contentHash: 'abc', trustBoundary: 'untrusted_text' }],
      unavailable: [], asOfSession: '2026-11-26', fingerprint: 'fingerprint'
    }) }
    const collector = createResearchPartnerEvidenceCollector({ registry, clock: () => new Date('2026-11-26T13:00:00.000Z') })
    const result = await collector({ mandate: { ...defaultMandate('Investigate NVDA'), watchlist: ['NVDA'] } })
    expect(RESEARCH_PARTNER_SOURCE_IDS).toEqual(['news', 'filings'])
    expect(registry.assemble).toHaveBeenCalledWith(expect.objectContaining({
      sourceIds: ['news', 'filings'], retrievedCutoff: '2026-11-26T13:00:00.000Z',
      input: expect.objectContaining({ screening: { shortlist: [{ symbol: 'NVDA' }] } })
    }))
    expect(result.records[0].source).toBe('news')
    expect(result.records[0].trustBoundary).toBe('untrusted_text')
  })
})
