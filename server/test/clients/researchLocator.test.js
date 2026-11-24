import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const found = (over = {}) => ({
  found: true, ticker: 'SPY', predictionId: 'pub_x:SPY', publicationId: 'pub_x', mode: 'live', marketDate: '2026-11-20', publishedAt: 't',
  run: { intelligenceConfidenceTier: 'full', rankedUnderDegradedRun: false, runStatus: 'HEALTHY' },
  quality: { edgeOverBaseline: false, genuineOutOfSample: false }, ...over,
})

describe('engineClient.locateResearchPrediction (research publications)', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    vi.resetModules()
    process.env.ENGINE_URL = 'http://engine.test'
    process.env.INTERNAL_READ_KEY = 'k'
    delete process.env.RESEARCH_INDEX_TTL_MS
  })
  afterEach(() => {
    global.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('asks for the latest accepted publication with the internal key and returns its gates', async () => {
    global.fetch = vi.fn().mockResolvedValue(json(found()))
    const { engineClient } = await import('../../src/clients/engine.js')
    expect(await engineClient.locateResearchPrediction('spy')).toEqual({
      predictionId: 'pub_x:SPY', ticker: 'SPY', publicationId: 'pub_x', mode: 'live', marketDate: '2026-11-20', rankedAt: 't',
      run: { intelligenceConfidenceTier: 'full', rankedUnderDegradedRun: false, runStatus: 'HEALTHY' },
      quality: { edgeOverBaseline: false, genuineOutOfSample: false },
      researchQuality: null,
    })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('http://engine.test/api/research/latest?ticker=SPY&tenant_id=default&mode=live')
    expect(opts.headers['X-Internal-Key']).toBe('k')
  })

  it('selects a labelled replay publication by session', async () => {
    global.fetch = vi.fn().mockResolvedValue(json(found({ mode: 'historical_replay', marketDate: '2026-11-19' })))
    const { engineClient } = await import('../../src/clients/engine.js')
    const r = await engineClient.locateResearchPrediction('SPY', 'default', { mode: 'historical_replay', session: '2026-11-19' })
    expect(r).toMatchObject({ mode: 'historical_replay', marketDate: '2026-11-19' })
    expect(global.fetch.mock.calls[0][0]).toBe('http://engine.test/api/research/latest?ticker=SPY&tenant_id=default&mode=historical_replay&session=2026-11-19')
  })

  it('returns null for no signal or no publication, and caches the answer', async () => {
    global.fetch = vi.fn().mockResolvedValue(json({ found: false, reason: 'no_signal', ticker: 'QQQ' }))
    const { engineClient } = await import('../../src/clients/engine.js')
    expect(await engineClient.locateResearchPrediction('QQQ')).toBe(null)
    expect(await engineClient.locateResearchPrediction('QQQ')).toBe(null)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('propagates engine errors instead of guessing', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('down', { status: 503 }))
    const { engineClient } = await import('../../src/clients/engine.js')
    await expect(engineClient.locateResearchPrediction('SPY')).rejects.toMatchObject({ statusCode: 503 })
  })

  it('refetches when the clock steps backwards', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T15:00:00Z') })
    global.fetch = vi.fn()
      .mockResolvedValueOnce(json(found({ predictionId: 'old' })))
      .mockResolvedValueOnce(json(found({ predictionId: 'new' })))
    const { engineClient } = await import('../../src/clients/engine.js')
    expect((await engineClient.locateResearchPrediction('SPY')).predictionId).toBe('old')
    vi.setSystemTime(new Date('2026-11-20T14:00:00Z'))
    expect((await engineClient.locateResearchPrediction('SPY')).predictionId).toBe('new')
  })

  it('reads one session close from daily bars', async () => {
    global.fetch = vi.fn().mockResolvedValue(json({ ticker: 'SPY', session: '2026-11-19', close: 715.9, timeframe: '1d' }))
    const { engineClient } = await import('../../src/clients/engine.js')
    expect(await engineClient.getSessionClose('spy', '2026-11-19')).toMatchObject({ session: '2026-11-19', close: 715.9 })
    expect(global.fetch.mock.calls[0][0]).toBe('http://engine.test/api/market/session-close?ticker=SPY&session=2026-11-19')
  })
})
