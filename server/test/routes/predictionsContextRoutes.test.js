import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('../../src/services/predictionsService.js', () => ({
  default: {
    getPredictions: vi.fn(),
    getPredictionById: vi.fn()
  }
}))

vi.mock('../../src/clients/engine.js', () => ({
  engineClient: {
    getTopRankings: vi.fn()
  }
}))

import predictionsRoutes from '../../src/routes/predictions.js'
import { engineClient } from '../../src/clients/engine.js'
import predictionsService from '../../src/services/predictionsService.js'

let app

describe('predictionsRoutes context proxy', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify()
    await app.register(predictionsRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns unified context payload', async () => {
    predictionsService.getPredictionById.mockResolvedValue({
      id: 'pred_123',
      strategyId: 'strat_1',
      ticker: 'AAPL',
      direction: 'buy',
      confidence: 0.9,
      entryPrice: 100,
      stopPrice: 95,
      targetPrice: 110,
      predictedAt: Date.now(),
      regime: 'trend',
      reasoning: 'test'
    })
    engineClient.getTopRankings.mockResolvedValue({
      rankings: [{
        symbol: 'AAPL',
        score: 1.23,
        rankContext: { basis: ['momentum'], timing: ['stable'], risks: ['fragility low'] }
      }]
    })

    const res = await app.inject({ method: 'GET', url: '/pred_123/context' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.ticker).toBe('AAPL')
    expect(body.data.predictionId).toBe('pred_123')
    expect(body.data.rankScore).toBe(1.23)
    expect(body.data.rankingContext).toEqual(['momentum', 'stable', 'fragility low'])
  })

  it('returns 404 when prediction does not exist', async () => {
    predictionsService.getPredictionById.mockResolvedValue(null)

    const res = await app.inject({ method: 'GET', url: '/pred_missing/context' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Prediction not found' } })
  })
})
