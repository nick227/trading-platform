/**
 * Production external evidence registry factory.
 * Instantiates verified adapters for news and SEC filings with server-side credentials.
 */
import { createExternalEvidenceAdapters } from '../externalEvidenceAdapters.js'
import { fetchNewsEvidence } from './newsEvidenceFetcher.js'
import { fetchSecFilingsEvidence } from './secFilingsEvidenceFetcher.js'

export function createProductionExternalEvidenceRegistry(fetcherOverrides = {}) {
  return createExternalEvidenceAdapters({
    news: fetcherOverrides.news || (params => fetchNewsEvidence(params)),
    filings: fetcherOverrides.filings || (params => fetchSecFilingsEvidence(params)),
    ...(fetcherOverrides.reddit ? { reddit: fetcherOverrides.reddit } : {}),
    ...(fetcherOverrides.searchInterest ? { searchInterest: fetcherOverrides.searchInterest } : {})
  })
}
