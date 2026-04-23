import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import Fastify from 'fastify'

vi.mock('../../src/clients/engine.js', () => ({
  engineClient: {
    checkHealth: vi.fn(),
    getTickers: vi.fn(),
    getQuote: vi.fn(),
    getHistory: vi.fn(),
    getStats: vi.fn(),
    getCompany: vi.fn(),
    getRegime: vi.fn(),
    getTickerExplainability: vi.fn(),
    getTickerPerformance: vi.fn(),
    getAdmissionChanges: vi.fn(),
    getDashboardData: vi.fn(),
    getActiveSignals: vi.fn()
  }
}))

import { engineClient } from '../../src/clients/engine.js'
import marketRoutes from '../../src/routes/marketRoutes.js'

let app

describe('marketRoutes', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    app = Fastify()
    await app.register(marketRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /health', () => {
    it('returns health check data', async () => {
      engineClient.checkHealth.mockResolvedValue({ status: 'ok' })

      const response = await request(app.server)
        .get('/health')
        .expect(200)

      expect(response.body).toEqual({ success: true, data: { status: 'ok' } })
    })

    it('returns 500 on error', async () => {
      engineClient.checkHealth.mockRejectedValue(new Error('Service unavailable'))

      const response = await request(app.server)
        .get('/health')
        .expect(500)

      expect(response.body).toEqual({ success: false, error: 'Service unavailable' })
    })
  })

  describe('GET /api/tickers', () => {
    it('returns tickers list', async () => {
      engineClient.getTickers.mockResolvedValue([{ symbol: 'AAPL', name: 'Apple' }])

      const response = await request(app.server)
        .get('/api/tickers?q=AAPL')
        .expect(200)

      expect(response.body).toEqual({ success: true, data: [{ symbol: 'AAPL', name: 'Apple' }] })
      expect(engineClient.getTickers).toHaveBeenCalledWith('AAPL')
    })
  })

  describe('GET /api/quote/:symbol', () => {
    it('returns quote data with valid shape', async () => {
      const quote = { symbol: 'AAPL', price: 150.25, dailyChangePct: 1.5 }
      engineClient.getQuote.mockResolvedValue(quote)

      const response = await request(app.server)
        .get('/api/quote/AAPL')
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toEqual(quote)
      expect(typeof response.body.data.price).toBe('number')
      expect(response.body.data.price).not.toBeNaN()
    })
  })

  describe('GET /api/history/:symbol', () => {
    it('returns history data', async () => {
      const history = [{ date: '2024-01-01', close: 150 }]
      engineClient.getHistory.mockResolvedValue(history)

      const response = await request(app.server)
        .get('/api/history/AAPL?range=1Y&interval=1D')
        .expect(200)

      expect(response.body).toEqual({ success: true, data: history })
      expect(engineClient.getHistory).toHaveBeenCalledWith('AAPL', '1Y', '1D')
    })
  })

  describe('GET /api/stats/:symbol', () => {
    it('returns stats data', async () => {
      const stats = { symbol: 'AAPL', marketCap: 2500000000000 }
      engineClient.getStats.mockResolvedValue(stats)

      const response = await request(app.server)
        .get('/api/stats/AAPL')
        .expect(200)

      expect(response.body).toEqual({ success: true, data: stats })
    })
  })

  describe('GET /api/company/:symbol', () => {
    it('returns company data', async () => {
      const company = { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology' }
      engineClient.getCompany.mockResolvedValue(company)

      const response = await request(app.server)
        .get('/api/company/AAPL')
        .expect(200)

      expect(response.body).toEqual({ success: true, data: company })
    })
  })

  describe('GET /api/regime/:symbol', () => {
    it('returns regime data', async () => {
      const regime = { symbol: 'AAPL', regime: 'bullish' }
      engineClient.getRegime.mockResolvedValue(regime)

      const response = await request(app.server)
        .get('/api/regime/AAPL')
        .expect(200)

      expect(response.body).toEqual({ success: true, data: regime })
    })
  })

  describe('GET /ticker/:symbol/explainability', () => {
    it('returns explainability data', async () => {
      const explainability = { symbol: 'AAPL', factors: [{ name: 'momentum', weight: 0.5 }] }
      engineClient.getTickerExplainability.mockResolvedValue(explainability)

      const response = await request(app.server)
        .get('/ticker/AAPL/explainability')
        .expect(200)

      expect(response.body).toEqual({ success: true, data: explainability })
    })
  })

  describe('GET /ticker/:symbol/performance', () => {
    it('returns performance data', async () => {
      const performance = { symbol: 'AAPL', return: 0.15, window: '30d' }
      engineClient.getTickerPerformance.mockResolvedValue(performance)

      const response = await request(app.server)
        .get('/ticker/AAPL/performance?window=30d')
        .expect(200)

      expect(response.body).toEqual({ success: true, data: performance })
      expect(engineClient.getTickerPerformance).toHaveBeenCalledWith('AAPL', '30d')
    })
  })

  describe('GET /admission/changes', () => {
    it('returns admission changes', async () => {
      const changes = [{ ticker: 'AAPL', action: 'added' }]
      engineClient.getAdmissionChanges.mockResolvedValue(changes)

      const response = await request(app.server)
        .get('/admission/changes?hours=24')
        .expect(200)

      expect(response.body).toEqual({ success: true, data: changes })
      expect(engineClient.getAdmissionChanges).toHaveBeenCalledWith(24)
    })
  })

  describe('GET /dashboard', () => {
    it('returns dashboard data', async () => {
      const dashboard = { rankings: [], signals: [] }
      engineClient.getDashboardData.mockResolvedValue(dashboard)

      const response = await request(app.server)
        .get('/dashboard')
        .expect(200)

      expect(response.body).toEqual({ success: true, data: dashboard })
    })
  })

  describe('GET /signals/active', () => {
    it('returns active signals', async () => {
      const signals = [{ ticker: 'AAPL', signal: 'buy' }]
      engineClient.getActiveSignals.mockResolvedValue(signals)

      const response = await request(app.server)
        .get('/signals/active')
        .expect(200)

      expect(response.body).toEqual({ success: true, data: signals })
    })
  })
})
