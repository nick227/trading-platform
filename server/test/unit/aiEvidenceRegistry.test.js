import { describe, expect, it } from 'vitest'
import {
  createEvidenceRegistry, validateEvidenceItem
} from '../../src/services/ai/evidenceRegistry.js'
import { createDefaultStockTraderContextRegistry } from '../../src/services/ai/stockTraderContext.js'
import { createAiStockTraderConfig } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'

const day = '2026-11-25'
const published = '2026-11-25T12:00:00.000Z'
const retrieved = '2026-11-25T14:00:00.000Z'
const article = (id, overrides = {}) => ({
  id, sourceId: 'news', kind: 'text', quality: 'reported',
  title: 'Dated company statement', url: 'https://example.com/story',
  publishedAt: published, availableAt: published,
  retrievedAt: retrieved, content: 'Source reports a new development.',
  ...overrides
})
const fixed = () => ({
  screening: { asOfSession: day, shortlist: [], ranking: [], excluded: [] },
  portfolio: { asOfSession: day, cash: 10000, positions: [] },
  config: createAiStockTraderConfig()
})

describe('MR 12 universal research evidence', () => {
  it('builds a stable, typed, provenance-preserving mixed snapshot', async () => {
    const registry = createEvidenceRegistry()
      .register({ id: 'news', version: '1.0', collect: async () => [article('story')] })
      .register({ id: 'metrics', version: '1.0', required: true, collect: async () => [{
        id: 'metrics-1', sourceId: 'metrics', kind: 'structured', quality: 'verified',
        title: 'Known metrics', publishedAt: published, availableAt: published,
        retrievedAt: retrieved, content: { volatility: 0.2 }
      }] })
    const first = await registry.assemble({ asOfSession: day, sourceIds: ['news','metrics'] })
    const second = await registry.assemble({ asOfSession: day, sourceIds: ['metrics','news'] })
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.records.map(r => r.sourceId)).toEqual(['metrics', 'news'])
    expect(first.records[1].trustBoundary).toBe('untrusted_text')
    expect(first.records[0].trustBoundary).toBe('source_data')
  })

  it('fails closed for future publication, availability or retrieval timestamps', async () => {
    for (const changes of [
      { publishedAt: '2026-11-26T09:00:00.000Z', availableAt: '2026-11-26T09:00:00.000Z', retrievedAt: '2026-11-26T09:00:00.000Z' },
      { availableAt: '2026-11-26T09:00:00.000Z', retrievedAt: '2026-11-26T09:00:00.000Z' },
      { retrievedAt: '2026-11-26T09:00:00.000Z' },
      { effectiveAt: '2026-11-26T09:00:00.000Z' }
    ]) {
      expect(() => validateEvidenceItem(article('bad', changes), {
        sourceId: 'news', cutoff: Date.parse(day + 'T23:59:59.999Z'),
        retrievedCutoff: Date.parse(day + 'T23:59:59.999Z')
      })).toThrow()
    }
  })

  it('treats optional provider outages as unavailable but fails on required outages', async () => {
    const optional = createEvidenceRegistry().register({
      id: 'news', version: 'v1', collect: async () => { throw new Error('offline') }
    })
    const result = await optional.assemble({ asOfSession: day, sourceIds: ['news'] })
    expect(result.records).toEqual([])
    expect(result.unavailable[0].reason).toBe('collection_failed')
    const mandatory = createEvidenceRegistry().register({
      id: 'news', version: 'v1', required: true, collect: async () => { throw new Error('offline') }
    })
    await expect(mandatory.assemble({ asOfSession: day, sourceIds: ['news'] })).rejects.toThrow(/required adapter/)
  })

  it('deduplicates syndicated evidence and enforces hard context budgets', async () => {
    const registry = createEvidenceRegistry().register({
      id: 'news', version: 'v1', collect: async () => [
        article('first'), article('syndicated'),
        article('other', { content: 'Different report' })
      ]
    })
    const snapshot = await registry.assemble({ asOfSession: day, sourceIds: ['news'] })
    expect(snapshot.records).toHaveLength(2)
    const bounded = await registry.assemble({ asOfSession: day, sourceIds: ['news'], maxItems: 1 })
    expect(bounded.records).toHaveLength(1)
    expect(bounded.unavailable[0].reason).toBe('budget_exhausted')
  })

  it('rejects unsupported schemas, dangerous source URLs, and unregistered adapters', async () => {
    expect(() => validateEvidenceItem(article('bad', { url: 'javascript:alert(1)' }), {
      sourceId: 'news', cutoff: Date.parse(day + 'T23:59:59.999Z'),
      retrievedCutoff: Date.parse(day + 'T23:59:59.999Z')
    })).toThrow(/URL/)
    await expect(createEvidenceRegistry().assemble({
      asOfSession: day, sourceIds: ['unregistered']
    })).rejects.toThrow(/unregistered/)
  })

  it('can attach versioned evidence to flagship context without changing baseline prompts', async () => {
    const context = createDefaultStockTraderContextRegistry()
    const baseline = await context.assemble({ session: day, input: fixed() })
    const source = createEvidenceRegistry().register({
      id: 'news', version: 'v1', collect: async () => [article('story')]
    })
    const extended = await context.assemble({
      session: day, input: fixed(), evidenceRegistry: source,
      evidenceSourceIds: ['news']
    })
    expect(baseline.evidence).toBeUndefined()
    expect(extended.evidence.records).toHaveLength(1)
    expect(extended.fingerprint).not.toBe(baseline.fingerprint)
  })

  it('canonicalizes nested input without mutating it and keeps hash independent of key order', () => {
    const common = {
      sourceId: 'news',
      cutoff: Date.parse(day + 'T23:59:59.999Z'),
      retrievedCutoff: Date.parse(day + 'T23:59:59.999Z')
    }
    const firstContent = { z: [{ y: 2, a: 1 }], b: { n: 3, a: 4 } }
    const secondContent = { b: { a: 4, n: 3 }, z: [{ a: 1, y: 2 }] }
    const first = validateEvidenceItem(article('x', { kind: 'structured', content: firstContent }), common)
    const second = validateEvidenceItem(article('x', { kind: 'structured', content: secondContent }), common)
    expect(first.contentHash).toBe(second.contentHash)
    expect(first.content).toEqual(second.content)
    expect(Object.keys(firstContent)).toEqual(['z', 'b'])
    expect(first.trustBoundary).toBe('source_data')
  })
})
