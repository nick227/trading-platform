import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

describe('engineClient', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetModules()
    process.env.ENGINE_URL = 'http://engine.test'
    delete process.env.INTERNAL_READ_KEY
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('retries symbol aliases when engine rejects the raw symbol', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ symbol: 'BRK-B', price: 123.45 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )

    global.fetch = fetchMock

    const { engineClient } = await import('../../src/clients/engine.js')
    const quote = await engineClient.getQuote('BRK.B')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('http://engine.test/api/quote/BRK.B')
    expect(fetchMock.mock.calls[1][0]).toContain('http://engine.test/api/quote/BRK-B')

    expect(quote.symbol).toBe('BRK.B')
    expect(quote._engineSymbol).toBe('BRK-B')
    expect(quote.price).toBe(123.45)
  })

  it('throws a 502 when alpha-engine is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('connect ECONNREFUSED'))
    global.fetch = fetchMock

    const { engineClient } = await import('../../src/clients/engine.js')

    await expect(engineClient.getQuote('AAPL')).rejects.toMatchObject({
      message: 'Alpha Engine unreachable',
      statusCode: 502
    })
  })
})

