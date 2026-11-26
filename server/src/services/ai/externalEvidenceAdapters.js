/**
 * Optional external research evidence adapters. Credentials and HTTP clients
 * remain with the source-specific fetchers; AI never chooses arbitrary URLs.
 *
 * Each fetcher is a trusted, code-owned read-only function. All raw text is
 * untrusted research DATA, not model/system instructions.
 */
import { createEvidenceRegistry } from './evidenceRegistry.js'

export const EXTERNAL_RESEARCH_SOURCE_IDS = Object.freeze([
  'news', 'reddit', 'search_interest', 'filings'
])

const maximumRows = 25
const maximumText = 1200

function text(value, max = maximumText) {
  return String(value ?? '').replace(/<[^>]{0,500}>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function iso(value, field) {
  if (value == null) throw new Error(`Missing source timestamp: ${field}`)
  const date = new Date(typeof value === 'number' ? (value < 1e11 ? value * 1000 : value) : value)
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid source timestamp: ${field}`)
  return date.toISOString()
}

function url(value, domains = null) {
  let result
  try {
    result = new URL(value)
  } catch {
    throw new Error('Invalid source URL')
  }
  if (result.protocol !== 'https:' || result.username || result.password ||
      result.toString().length > 2048) throw new Error('Unsafe source URL')
  if (domains && !domains.some(domain => result.hostname === domain || result.hostname.endsWith('.' + domain))) {
    throw new Error('Source URL is outside its authorized domain')
  }
  return result.toString()
}

function provenance(row) {
  return {
    publishedAt: iso(row.publishedAt, 'publishedAt'),
    availableAt: iso(row.availableAt ?? row.publishedAt, 'availableAt'),
    retrievedAt: iso(row.retrievedAt, 'retrievedAt'),
    ...(row.effectiveAt != null ? { effectiveAt: iso(row.effectiveAt, 'effectiveAt') } : {})
  }
}

function base(row, sourceId, domain = null) {
  const sourceUrl = url(row.url, domain)
  const title = text(row.title, 256)
  const id = text(row.id, 191)
  if (!id || !title) throw new Error('External research evidence missing id or title')
  return {
    id: sourceId + ':' + id,
    sourceId, title, url: sourceUrl,
    ...provenance(row)
  }
}

function newsItem(row) {
  return {
    ...base(row, 'news'),
    kind: 'text',
    quality: 'reported',
    content: text(row.excerpt ?? row.summary ?? row.body)
  }
}

function redditItem(row) {
  return {
    ...base(row, 'reddit', ['reddit.com']),
    kind: 'text',
    quality: 'opinion',
    content: text([row.title, row.body ?? row.selftext].filter(Boolean).join(' — '))
  }
}

function searchInterestItem(row) {
  const score = Number(row.relativeInterest)
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('Invalid relative search-interest measurement')
  }
  const periodStart = iso(row.periodStart, 'periodStart')
  const periodEnd = iso(row.periodEnd, 'periodEnd')
  if (periodStart > periodEnd) throw new Error('Invalid search-interest period')
  return {
    ...base(row, 'search_interest'),
    effectiveAt: periodEnd,
    kind: 'structured',
    quality: 'reported',
    content: {
      provider: String(row.provider || 'unknown'),
      metric: 'relative_search_interest_not_search_volume',
      term: text(row.term, 120),
      geo: text(row.geo, 40),
      relativeInterest: score,
      periodStart,
      periodEnd
    }
  }
}

function filingItem(row) {
  const canonicalUrl = url(row.url, ['sec.gov'])
  const authoritative = row.verifiedSource === true &&
    /(?:^|\.)sec\.gov$/.test(new URL(canonicalUrl).hostname)
  return {
    ...base(row, 'filings', ['sec.gov']),
    kind: 'mixed',
    quality: authoritative ? 'verified' : 'reported',
    content: {
      text: text(row.excerpt ?? row.summary),
      data: {
        filingType: text(row.filingType, 40),
        accession: text(row.accession, 100),
        issuer: text(row.issuer, 160)
      }
    }
  }
}

export function createExternalEvidenceAdapters(fetchers = {}) {
  if (!fetchers || typeof fetchers !== 'object' || Array.isArray(fetchers)) {
    throw new Error('External research fetchers must be an object')
  }
  const definitions = [
    { id: 'news', fetch: fetchers.news, transform: newsItem },
    { id: 'reddit', fetch: fetchers.reddit, transform: redditItem },
    { id: 'search_interest', fetch: fetchers.searchInterest, transform: searchInterestItem },
    { id: 'filings', fetch: fetchers.filings, transform: filingItem }
  ]
  const registry = createEvidenceRegistry()
  for (const entry of definitions) {
    registry.register({
      id: entry.id, version: '1.0.0', required: false,
      collect: async ({ asOfSession, retrievedCutoff, input }) => {
        if (typeof entry.fetch !== 'function') throw new Error('Provider is not connected')
        const symbols = [...new Set([
          ...(input?.screening?.shortlist || []).map(r => r.symbol),
          ...(input?.portfolio?.positions || []).map(p => p.symbol)
        ])].filter(s => typeof s === 'string' && /^[A-Z][A-Z0-9.]{0,9}$/.test(s)).slice(0, 100)
        const rows = await entry.fetch({
          symbols, asOfSession, retrievedCutoff,
          limit: maximumRows
        })
        if (!Array.isArray(rows) || rows.length > maximumRows) {
          throw new Error('Provider returned invalid or unbounded evidence')
        }
        return rows.map(entry.transform)
      }
    })
  }
  return registry
}
