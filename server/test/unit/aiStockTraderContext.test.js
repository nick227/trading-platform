import { describe, expect, it } from 'vitest'
import { createDefaultStockTraderContextRegistry, createStockTraderContextRegistry } from '../../src/services/ai/stockTraderContext.js'
import { createAiStockTraderConfig } from '../../src/services/ai/strategies/aiStockTraderStrategy.js'

const session = '2026-11-25'
const input = () => ({
  screening: { asOfSession: session, shortlist: [], ranking: [], excluded: [] },
  portfolio: { asOfSession: session, cash: 10000, positions: [] },
  config: createAiStockTraderConfig()
})

describe('AI stock trader modular context', () => {
  it('creates stable snapshots independent of module registration order', async () => {
    const registry = createDefaultStockTraderContextRegistry()
    const a = await registry.assemble({ session, input: input() })
    const b = await registry.assemble({
      session, input: input(), modules: ['risk', 'objectives', 'portfolio', 'market']
    })
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.context.market.source).toBe('tradeloom-stock-screener')
    expect(a.byteSize).toBeGreaterThan(0)
  })

  it('fails closed for stale paper portfolio or market context', async () => {
    const registry = createDefaultStockTraderContextRegistry()
    const i = input()
    i.portfolio.asOfSession = '2026-11-24'
    await expect(registry.assemble({ session, input: i })).rejects.toThrow(/portfolio/)
    i.portfolio.asOfSession = session
    i.screening.asOfSession = '2026-11-26'
    await expect(registry.assemble({ session, input: i })).rejects.toThrow(/market/)
  })

  it('records unavailable optional modules without blocking core research', async () => {
    const registry = createDefaultStockTraderContextRegistry()
    registry.register({ id: 'news', version: '1', required: false, collect: async () => { throw new Error('news offline') } })
    const result = await registry.assemble({ session, input: input(), modules: [...registry.list()] })
    expect(result.unavailable).toContainEqual({ id: 'news', version: '1', reason: 'collection_failed' })
    expect(result.context.news).toBeUndefined()
  })

  it('rejects duplicate modules and oversized contexts', async () => {
    const registry = createStockTraderContextRegistry().register({
      id: 'large', version: '1', required: true,
      collect: async () => ({ asOf: session, source: 'test', quality: 'valid', data: { s: 'a'.repeat(5000) } })
    })
    await expect(registry.assemble({ session, input: {}, modules: ['large'], maxBytes: 1024 })).rejects.toThrow(/budget/)
    await expect(registry.assemble({ session, input: {}, modules: ['large', 'large'] })).rejects.toThrow(/unique/)
  })
})
