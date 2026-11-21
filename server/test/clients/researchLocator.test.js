import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ranking = (rows, run = { intelligenceConfidenceTier: 'full', rankedUnderDegradedRun: false, runStatus: 'SUCCESS' }) => ({ ...run, notActionable: true, rankings: rows })

describe('engineClient.locateResearchPrediction', () => {
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

  it('indexes the whole target universe with the internal key and returns run gates', async () => {
    global.fetch = vi.fn().mockResolvedValue(json(ranking([{ ticker: 'SPY', predictionId: 'p1', timestamp: 't' }])))
    const { engineClient } = await import('../../src/clients/engine.js')
    expect(await engineClient.locateResearchPrediction('spy')).toEqual({
      predictionId: 'p1', ticker: 'SPY', rankedAt: 't',
      run: { intelligenceConfidenceTier: 'full', rankedUnderDegradedRun: false, runStatus: 'SUCCESS' }
    })
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('http://engine.test/ranking/top?limit=500&tenant_id=default')
    expect(opts.headers['X-Internal-Key']).toBe('k')
  })

  it('matches engine symbol aliases and ignores rows without a predictionId', async () => {
    global.fetch = vi.fn().mockResolvedValue(json(ranking([{ ticker: 'BRK-B', predictionId: 'p2' }, { ticker: 'QQQ' }])))
    const { engineClient } = await import('../../src/clients/engine.js')
    expect((await engineClient.locateResearchPrediction('BRK.B')).predictionId).toBe('p2')
    expect(await engineClient.locateResearchPrediction('QQQ')).toBe(null)
    expect(await engineClient.locateResearchPrediction('AAPL')).toBe(null)
    expect(global.fetch).toHaveBeenCalledTimes(1) // cached index
  })

  it('propagates engine errors instead of guessing', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('down', { status: 503 }))
    const { engineClient } = await import('../../src/clients/engine.js')
    await expect(engineClient.locateResearchPrediction('SPY')).rejects.toMatchObject({ statusCode: 503 })
  })

  it('refetches when the clock steps backwards', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T15:00:00Z') })
    global.fetch = vi.fn()
      .mockResolvedValueOnce(json(ranking([{ ticker: 'SPY', predictionId: 'old' }])))
      .mockResolvedValueOnce(json(ranking([{ ticker: 'SPY', predictionId: 'new' }])))
    const { engineClient } = await import('../../src/clients/engine.js')
    expect((await engineClient.locateResearchPrediction('SPY')).predictionId).toBe('old')
    vi.setSystemTime(new Date('2026-11-20T14:00:00Z'))
    expect((await engineClient.locateResearchPrediction('SPY')).predictionId).toBe('new')
  })
})
