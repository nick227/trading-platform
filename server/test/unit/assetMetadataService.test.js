import { describe, it, expect, beforeEach } from 'vitest'
import { getAssetMetadata, resetAssetCache, ASSET_TTL_MS } from '../../src/services/assetMetadataService.js'

const env = { ALPACA_MARKET_DATA_KEY: 'k', ALPACA_MARKET_DATA_SECRET: 's' }
const config = { tradableSymbols: ['AAPL', 'SPY'] }
const AAPL = { symbol: 'AAPL', name: 'Apple Inc. Common Stock', exchange: 'NASDAQ', class: 'us_equity', tradable: true, fractionable: true, shortable: true, status: 'active' }

function fakeFetch(reply) {
  const calls = []
  const f = async (url, init) => { calls.push({ url, init }); return typeof reply === 'function' ? reply(url) : reply }
  f.calls = calls
  return f
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => resetAssetCache())

describe('asset metadata (Alpaca, on demand)', () => {
  it('returns company metadata for a supported symbol via a read-only GET with service credentials', async () => {
    const f = fakeFetch(ok(AAPL))
    const r = await getAssetMetadata('aapl', { fetchImpl: f, env, config })
    expect(r).toMatchObject({ status: 'available', symbol: 'AAPL', name: 'Apple Inc. Common Stock', exchange: 'NASDAQ', tradable: true, fractionable: true, source: 'alpaca' })
    expect(f.calls[0].url).toBe('https://paper-api.alpaca.markets/v2/assets/AAPL')
    expect(f.calls[0].init.method ?? 'GET').toBe('GET')
    expect(f.calls[0].init.headers['APCA-API-KEY-ID']).toBe('k')
  })
  it('refuses symbols outside the supported universe without calling Alpaca', async () => {
    const f = fakeFetch(ok(AAPL))
    expect(await getAssetMetadata('TSLA', { fetchImpl: f, env, config })).toMatchObject({ status: 'unsupported' })
    expect(f.calls).toHaveLength(0)
  })
  it('caches for a day; failures are not cached', async () => {
    let t = 1_000
    const now = () => t
    const fail = fakeFetch({ ok: false, status: 503, json: async () => ({}) })
    expect(await getAssetMetadata('AAPL', { fetchImpl: fail, env, config, now })).toMatchObject({ status: 'unavailable', reason: 'http_503' })
    const f = fakeFetch(ok(AAPL))
    await getAssetMetadata('AAPL', { fetchImpl: f, env, config, now })
    await getAssetMetadata('AAPL', { fetchImpl: f, env, config, now })
    expect(f.calls).toHaveLength(1)
    t += ASSET_TTL_MS + 1
    await getAssetMetadata('AAPL', { fetchImpl: f, env, config, now })
    expect(f.calls).toHaveLength(2)
  })
  it('degrades cleanly when unconfigured, unreachable or answered for a different symbol', async () => {
    expect(await getAssetMetadata('AAPL', { fetchImpl: fakeFetch(ok(AAPL)), env: {}, config })).toMatchObject({ status: 'unavailable', reason: 'not_configured' })
    expect(await getAssetMetadata('AAPL', { fetchImpl: async () => { throw new Error('dns') }, env, config })).toMatchObject({ status: 'unavailable', reason: 'unreachable' })
    expect(await getAssetMetadata('AAPL', { fetchImpl: fakeFetch(ok({ ...AAPL, symbol: 'MSFT' })), env, config })).toMatchObject({ status: 'unavailable', reason: 'invalid_response' })
  })
})
