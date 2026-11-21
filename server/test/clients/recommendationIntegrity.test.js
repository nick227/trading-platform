import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../src/loaders/prisma.js', () => ({ default: {} }))
import { engineClient } from '../../src/clients/engine.js'

const quality = () => ({ status: 'healthy', actionable: true, suppressionReasons: [], evaluatedAt: new Date().toISOString() })
const row = () => ({ ticker: 'TST', action: 'BUY', actionable: true, confidence: null,
  successProbability: null, score: 0.8, suppressionReasons: [], qualityStatus: quality(),
  confidenceMethodology: { status: 'unavailable', method: 'not_calibrated' } })
const payload = () => ({ intelligenceConfidenceTier: 'full', qualityStatus: quality(),
  pipelineSignals: { predictionPipelineActive: true, serviceMode: 'normal' }, recommendations: [row()] })

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('recommendation contract boundary', () => {
  it('does not promote uncalibrated research into order signals', async () => {
    vi.spyOn(engineClient, 'getRecommendationsLatest').mockResolvedValue(payload())
    expect(await engineClient.getActiveSignals()).toEqual([])
  })

  it.each(['limited', 'suppressed', 'degraded', undefined])('fails closed for %s tier', async tier => {
    const data = payload()
    data.intelligenceConfidenceTier = tier
    vi.spyOn(engineClient, 'getRecommendationsLatest').mockResolvedValue(data)
    expect(await engineClient.getActiveSignals()).toEqual([])
  })

  it('requires fresh explicit quality and calibrated probability, not legacy confidence', async () => {
    const data = payload()
    data.recommendations[0].confidence = 99
    data.recommendations[0].successProbability = 0.8
    data.recommendations[0].confidenceMethodology = { status: 'available', method: 'empirically_calibrated' }
    vi.spyOn(engineClient, 'getRecommendationsLatest').mockResolvedValue(data)
    expect((await engineClient.getActiveSignals())[0].confidence).toBe(0.8)
    data.qualityStatus.evaluatedAt = '2020-01-01'
    expect(await engineClient.getActiveSignals()).toEqual([])
  })

  it('does not treat missing quality as healthy', async () => {
    vi.spyOn(engineClient, 'getRecommendationsLatest').mockResolvedValue({ recommendations: [{ action: 'BUY', confidence: 99 }] })
    expect(await engineClient.getActiveSignals()).toEqual([])
  })

  it('preserves suppression metadata and emits research-only price-cap fallbacks', async () => {
    const data = { recommendations: [], qualityStatus: { status: 'suppressed', actionable: false },
      suppressionReasons: ['PREDICTIONS_STALE_OR_MISSING'], intelligenceConfidenceTier: 'suppressed' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })))
    vi.spyOn(engineClient, 'getTopRankings').mockResolvedValue({ rankings: [{ticker:'TST', price:1.5, confidence:99, score:0.8}] })
    const result = await engineClient.getRecommendationsUnder(2)
    expect(result.suppressionReasons).toEqual(data.suppressionReasons)
    expect(result.qualityStatus.actionable).toBe(false)
    expect(result.meta.liveOnly).toBe(false)
    expect(result.recommendations[0]).toMatchObject({ action:'WATCH', actionable:false, confidence:null, entryZone:null, referencePrice:1.5 })
  })
})
