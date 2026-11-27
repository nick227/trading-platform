
import { createExternalEvidenceAdapters } from '../ai/externalEvidenceAdapters.js'
import { validateMandate } from './mandate.js'

// Source selection is platform-owned. User instructions never register new providers.
export const RESEARCH_PARTNER_SOURCE_IDS = Object.freeze(['news', 'filings'])
export function createResearchPartnerEvidenceCollector({
  registry = createExternalEvidenceAdapters(), clock = () => new Date()
} = {}) {
  return async function collect({ mandate }) {
    const validated = validateMandate(mandate)
    const now = clock()
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid evidence cutoff clock')
    const symbols = [...new Set(validated.watchlist)].slice(0, 40)
    const asOfSession = now.toISOString().slice(0, 10)
    const retrievedCutoff = now.toISOString()
    const snapshot = await registry.assemble({
      sourceIds: [...RESEARCH_PARTNER_SOURCE_IDS],
      asOfSession, retrievedCutoff,
      maxBytes: 32_000, maxItems: 24,
      input: {
        screening: { shortlist: symbols.map(symbol => ({ symbol })) },
        portfolio: { positions: [] }
      }
    })
    return {
      records: snapshot.records.map(item => ({
        id: item.id, source: item.sourceId, title: item.title, url: item.url,
        kind: item.kind, quality: item.quality, content: item.content,
        publishedAt: item.publishedAt, availableAt: item.availableAt,
        retrievedAt: item.retrievedAt, contentHash: item.contentHash,
        trustBoundary: item.trustBoundary
      })),
      unavailable: snapshot.unavailable,
      asOfSession: snapshot.asOfSession,
      fingerprint: snapshot.fingerprint
    }
  }
}
