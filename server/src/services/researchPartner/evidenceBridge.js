import { createProductionExternalEvidenceRegistry } from '../ai/evidence/productionEvidenceFetchers.js'
import { validateMandate } from './mandate.js'

// Only code-owned providers can supply source material.
export const RESEARCH_PARTNER_EVIDENCE_SOURCES = Object.freeze(['news', 'filings'])

export function createResearchPartnerEvidenceCollector({
  registry = createProductionExternalEvidenceRegistry(),
  clock = () => new Date()
} = {}) {
  return async function collect({ mandate }) {
    const validated = validateMandate(mandate)
    const now = clock()
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid evidence cutoff clock')
    const asOfSession = now.toISOString().slice(0, 10)
    const symbols = [...new Set(validated.watchlist)].slice(0, 40)
    const snapshot = await registry.assemble({
      sourceIds: [...RESEARCH_PARTNER_EVIDENCE_SOURCES],
      asOfSession, retrievedCutoff: now.toISOString(),
      maxBytes: 32000, maxItems: 24,
      input: { screening: { shortlist: symbols.map(symbol => ({ symbol })) }, portfolio: { positions: [] } }
    })
    return {
      asOfSession: snapshot.asOfSession,
      fingerprint: snapshot.fingerprint,
      unavailable: snapshot.unavailable,
      records: snapshot.records.map(item => ({
        id: item.id, source: item.sourceId, title: item.title, url: item.url,
        kind: item.kind, quality: item.quality, content: item.content,
        publishedAt: item.publishedAt, availableAt: item.availableAt,
        retrievedAt: item.retrievedAt, contentHash: item.contentHash,
        trustBoundary: item.trustBoundary
      }))
    }
  }
}
