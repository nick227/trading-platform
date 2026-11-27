/**
 * Provider-neutral point-in-time research evidence. External text is DATA,
 * never developer instructions or a source of deterministic trade authority.
 */
import { createHash } from 'node:crypto'

const ID = /^[a-z][a-z0-9_-]{1,79}$/
const TYPES = new Set(['structured', 'text', 'mixed'])
const QUALITY = new Set(['verified', 'reported', 'opinion', 'unverified'])
const MAX_ITEM_BYTES = 16_384

export class EvidenceError extends Error {
  constructor(source, reason) {
    super(`Research evidence ${source}: ${reason}`)
    this.name = 'EvidenceError'
    this.source = source
    this.reason = reason
  }
}

function asTimestamp(value, field, source) {
  if (typeof value !== 'string' || !/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value)) {
    throw new EvidenceError(source, `invalid ${field}`)
  }
  const stamp = Date.parse(value)
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString() !== value) {
    throw new EvidenceError(source, `invalid ${field}`)
  }
  return stamp
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}

function encodeCanonical(value, source) {
  let normalized
  let encoded
  try {
    normalized = canonical(value)
    encoded = JSON.stringify(normalized)
  } catch {
    throw new EvidenceError(source, 'content is not JSON serializable')
  }
  if (typeof encoded !== 'string') throw new EvidenceError(source, 'content must be serializable')
  return { normalized, encoded }
}

function safeStringify(value, source) {
  return encodeCanonical(value, source).encoded
}

export function validateEvidenceItem(item, { sourceId, cutoff, retrievedCutoff, maxItemBytes = MAX_ITEM_BYTES }) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new EvidenceError(sourceId, 'invalid evidence item')
  if (item.sourceId !== sourceId || typeof item.id !== 'string' || !item.id.trim() ||
      !TYPES.has(item.kind) || !QUALITY.has(item.quality)) throw new EvidenceError(sourceId, 'invalid identity or classification')
  if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 256) {
    throw new EvidenceError(sourceId, 'invalid title')
  }
  if (item.url != null && (typeof item.url !== 'string' || !/^https:\/\/[^\s/]+/.test(item.url) || item.url.length > 2048)) {
    throw new EvidenceError(sourceId, 'invalid source URL')
  }
  const publishedAt = asTimestamp(item.publishedAt, 'publishedAt', sourceId)
  const availableAt = asTimestamp(item.availableAt, 'availableAt', sourceId)
  const retrievedAt = asTimestamp(item.retrievedAt, 'retrievedAt', sourceId)
  if (publishedAt > availableAt || availableAt > retrievedAt ||
      availableAt > cutoff || retrievedAt > retrievedCutoff) {
    throw new EvidenceError(sourceId, 'future or inconsistent availability')
  }
  if (item.effectiveAt != null && asTimestamp(item.effectiveAt, 'effectiveAt', sourceId) > cutoff) {
    throw new EvidenceError(sourceId, 'future effective date')
  }
  if (item.kind === 'text' && (typeof item.content !== 'string' || !item.content.trim())) {
    throw new EvidenceError(sourceId, 'text evidence must contain text')
  }
  if (item.kind === 'structured' && (!item.content || typeof item.content !== 'object' || Array.isArray(item.content))) {
    throw new EvidenceError(sourceId, 'structured evidence requires an object')
  }
  if (item.kind === 'mixed' && (!item.content || typeof item.content !== 'object' ||
      typeof item.content.text !== 'string' || !item.content.data || typeof item.content.data !== 'object')) {
    throw new EvidenceError(sourceId, 'mixed evidence requires text and data')
  }
  // Canonicalize exactly once: use the same representation for hashing and output.
  const { normalized: normalizedContent, encoded: content } = encodeCanonical(item.content, sourceId)
  if (Buffer.byteLength(content, 'utf8') > maxItemBytes) throw new EvidenceError(sourceId, 'item byte limit exceeded')
  const normalized = {
    id: item.id.trim(), sourceId, kind: item.kind, quality: item.quality,
    title: item.title.trim(), url: item.url || null,
    publishedAt: item.publishedAt, availableAt: item.availableAt,
    retrievedAt: item.retrievedAt, effectiveAt: item.effectiveAt || null,
    content: normalizedContent,
    // Textual evidence is untrusted source material even if the source is credible.
    trustBoundary: item.kind === 'structured' ? 'source_data' : 'untrusted_text'
  }
  normalized.contentHash = createHash('sha256').update(content).digest('hex')
  return normalized
}

export function createEvidenceRegistry() {
  const sources = new Map()
  const api = {
    register({ id, version, required = false, collect }) {
      if (!ID.test(id || '') || typeof version !== 'string' || !version ||
          typeof collect !== 'function' || sources.has(id)) throw new EvidenceError(id, 'invalid or duplicate adapter')
      sources.set(id, { version, required, collect })
      return api
    },
    list() { return [...sources.keys()].sort() },
    async assemble({
      sourceIds, asOfSession, retrievedCutoff, maxBytes = 48_000, maxItems = 40,
      input = {}
    }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfSession || '') ||
          !Number.isFinite(Date.parse(asOfSession + 'T23:59:59.999Z'))) {
        throw new EvidenceError('registry', 'invalid as-of session')
      }
      if (!Array.isArray(sourceIds) || new Set(sourceIds).size !== sourceIds.length ||
          !Number.isInteger(maxBytes) || maxBytes < 1024 ||
          !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 500) {
        throw new EvidenceError('registry', 'invalid source selection or budgets')
      }
      const cutoff = Date.parse(asOfSession + 'T23:59:59.999Z')
      const retrievedLimit = retrievedCutoff == null ? cutoff :
        asTimestamp(retrievedCutoff, 'retrievedCutoff', 'registry')
      const retrievedCap = Math.min(cutoff, retrievedLimit)
      const records = []
      const unavailable = []
      const seenContent = new Set()
      let totalBytes = 0
      for (const id of [...sourceIds].sort()) {
        const adapter = sources.get(id)
        if (!adapter) throw new EvidenceError(id, 'unregistered source')
        let items
        try {
          items = await adapter.collect({ asOfSession, retrievedCutoff: new Date(retrievedCap).toISOString(), input })
          if (!Array.isArray(items)) throw new EvidenceError(id, 'adapter returned a non-array')
        } catch (error) {
          if (adapter.required) throw new EvidenceError(id, `required adapter failed: ${error.message}`)
          unavailable.push({ sourceId: id, version: adapter.version, reason: 'collection_failed' })
          continue
        }
        const normalized = []
        try {
          for (const item of items) {
            normalized.push(validateEvidenceItem(item, {
              sourceId: id, cutoff, retrievedCutoff: retrievedCap
            }))
          }
        } catch (error) {
          if (adapter.required) throw error
          unavailable.push({ sourceId: id, version: adapter.version, reason: 'invalid_or_future_data' })
          continue
        }
        normalized.sort((a, b) => a.availableAt.localeCompare(b.availableAt) || a.id.localeCompare(b.id))
        for (const item of normalized) {
          const unique = `${item.kind}:${item.contentHash}`
          if (seenContent.has(unique)) continue
          const record = { ...item, adapterVersion: adapter.version }
          const bytes = Buffer.byteLength(safeStringify(record, id), 'utf8')
          if (records.length >= maxItems || totalBytes + bytes > maxBytes) {
            unavailable.push({ sourceId: id, version: adapter.version, reason: 'budget_exhausted' })
            break
          }
          seenContent.add(unique)
          records.push(record)
          totalBytes += bytes
        }
      }
      const snapshot = {
        evidenceVersion: '1.0.0',
        asOfSession,
        records,
        unavailable,
        totalBytes
      }
      return {
        ...snapshot,
        fingerprint: createHash('sha256').update(safeStringify(snapshot, 'registry')).digest('hex')
      }
    }
  }
  return api
}
