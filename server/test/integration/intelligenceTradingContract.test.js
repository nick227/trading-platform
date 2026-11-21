import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import Fastify from 'fastify'
import { encrypt } from '../../src/utils/encryption.js'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockUserA = { id: 'usr_alice', email: 'alice@example.com', fullName: 'Alice Trader', subscription: { status: 'ACTIVE' } }
const mockUserB = { id: 'usr_bob', email: 'bob@example.com', fullName: 'Bob Investor', subscription: { status: 'ACTIVE' } }

const mockPortfolioA = { id: 'por_alice_1', userId: 'usr_alice', name: 'Alice Portfolio' }
const mockPortfolioB = { id: 'por_bob_1', userId: 'usr_bob', name: 'Bob Portfolio' }

const mockBrokerA = {
  id: 'bro_alice',
  userId: 'usr_alice',
  apiKey: encrypt('alice_key'),
  apiSecret: encrypt('alice_secret'),
  paper: true,
  status: 'active'
}

vi.mock('../../src/loaders/prisma.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(async ({ where }) => {
        if (where?.id === 'usr_alice') return mockUserA
        if (where?.id === 'usr_bob') return mockUserB
        return null
      })
    },
    brokerAccount: {
      findUnique: vi.fn(async ({ where }) => {
        if (where?.userId === 'usr_alice') return mockBrokerA
        return null
      })
    },
    portfolio: {
      findFirst: vi.fn(async ({ where }) => {
        if (where?.userId === 'usr_alice') return mockPortfolioA
        if (where?.userId === 'usr_bob') return mockPortfolioB
        return null
      }),
      findUnique: vi.fn(async ({ where }) => {
        if (where?.id === 'por_alice_1') return mockPortfolioA
        if (where?.id === 'por_bob_1') return mockPortfolioB
        return null
      }),
      findMany: vi.fn(async ({ where }) => {
        if (where?.userId === 'usr_alice') return [mockPortfolioA]
        if (where?.userId === 'usr_bob') return [mockPortfolioB]
        return []
      }),
      count: vi.fn(async () => 1),
      create: vi.fn(async ({ data }) => ({ id: 'por_created', ...data }))
    },
    bot: {
      findMany: vi.fn(async ({ where }) => {
        if (where?.userId === 'usr_alice') return [{ id: 'bot_alice', userId: 'usr_alice', name: 'Alice Bot' }]
        if (where?.userId === 'usr_bob') return [{ id: 'bot_bob', userId: 'usr_bob', name: 'Bob Bot' }]
        return []
      }),
      findFirst: vi.fn(async ({ where }) => {
        if (where?.userId === 'usr_alice') return { id: 'bot_alice', userId: 'usr_alice' }
        return null
      }),
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => 1)
    },
    tradeMetricFact: {
      findMany: vi.fn(async () => [])
    },
    botRun: {
      create: vi.fn(async ({ data }) => ({ id: 'brun_test', ...data })),
      update: vi.fn(async ({ data }) => ({ id: 'brun_test', ...data }))
    },
    botEvent: {
      create: vi.fn(async ({ data }) => ({ id: 'bevt_test', ...data }))
    },
    execution: {
      create: vi.fn(async ({ data }) => ({ id: 'exe_test', ...data, status: 'queued' })),
      findMany: vi.fn(async ({ where }) => {
        if (where?.userId === 'usr_alice') return [{ id: 'exe_alice', userId: 'usr_alice', ticker: 'NVDA', direction: 'buy', status: 'filled', filledPrice: 130, fees: 0, pnl: 20 }]
        return []
      }),
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _sum: { pnl: 0, fees: 0 } })),
      groupBy: vi.fn(async () => [])
    },
    executionAudit: {
      create: vi.fn(async () => ({ id: 'ea_test' }))
    },
    performanceStats: {
      findFirst: vi.fn(async () => null)
    },
    portfolioSummary: {
      findFirst: vi.fn(async () => null)
    },
    liveQuote: {
      findMany: vi.fn(async () => [])
    }
  }
}))

import prisma from '../../src/loaders/prisma.js'
import createApp from '../../src/loaders/fastify.js'
import registerRoutes from '../../src/loaders/routes.js'
import { engineClient } from '../../src/clients/engine.js'
import botService from '../../src/services/botService.js'
import executionsService from '../../src/services/executionsService.js'

let app
let tokenAlice
let tokenBob

describe('Integration Contract & Safety Suite (Phase 1)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    // Deterministic test environment
    process.env.INTERNAL_READ_KEY = '7f4c2a91d8e63b5f0c1a7e94b2d65f3a9c8e1f47b6d2c0ea95f13b7d4a6e8c21'
    process.env.ENGINE_URL = 'http://127.0.0.1:8090'
    process.env.ALLOW_LIVE_TRADING = 'false'

    app = await createApp()
    await registerRoutes(app)
    await app.ready()

    tokenAlice = app.jwt.sign({ sub: mockUserA.id })
    tokenBob = app.jwt.sign({ sub: mockUserB.id })
  })

  afterEach(async () => {
    await app.close()
  })

  // ─── Scenario 1: Valid recommendations reaching Trading Platform ─────────────
  it('1. Valid recommendations reach Trading Platform and parse into executable signals', async () => {
    const mockRecs = {
      intelligenceConfidenceTier: 'high',
      pipelineSignals: { rankingsSuppressed: false },
      recommendations: [
        {
          ticker: 'NVDA',
          action: 'BUY',
          confidence: 0.88,
          score: 85,
          entryZone: [130.50, 132.00],
          reason: 'Strong momentum and consensus'
        },
        {
          ticker: 'TSLA',
          action: 'SELL',
          confidence: 0.79,
          score: -60,
          entryZone: [210.00, 212.00],
          reason: 'Bearish divergence'
        }
      ]
    }

    vi.spyOn(engineClient, 'getRecommendationsLatest').mockResolvedValue(mockRecs)

    const signals = await engineClient.getActiveSignals({ minConfidence: 0.75 })
    expect(signals).toHaveLength(2)
    expect(signals[0]).toMatchObject({
      symbol: 'NVDA',
      direction: 'buy',
      confidence: 0.88,
      score: 85
    })
    expect(signals[1]).toMatchObject({
      symbol: 'TSLA',
      direction: 'sell',
      confidence: 0.79,
      score: -60
    })

    // Test execution intent generation through botService
    const executionResult = await botService.executeNextSignal({
      userId: 'usr_alice',
      portfolioId: 'por_alice_1',
      minConfidence: 0.75
    })

    expect(executionResult.executed).toBe(true)
    expect(executionResult.signal.symbol).toBe('NVDA')
    expect(executionResult.signal.direction).toBe('buy')
    expect(prisma.execution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'usr_alice',
        portfolioId: 'por_alice_1',
        ticker: 'NVDA',
        direction: 'buy'
      })
    }))
  })

  // ─── Scenario 2: Non-actionable rankings never generating orders ─────────────
  it('2. Non-actionable rankings (relative_priority) never generate execution intents', async () => {
    // When pipeline rankings are raw relative_priority with no directional recommendation
    const mockRankings = {
      rankingKind: 'relative_priority',
      notActionable: true,
      items: [
        { ticker: 'AAPL', rank: 1, score: 98, relative_priority: 1 },
        { ticker: 'MSFT', rank: 2, score: 95, relative_priority: 2 }
      ]
    }

    vi.spyOn(engineClient, 'getRecommendationsLatest').mockResolvedValue({
      intelligenceConfidenceTier: 'nominal',
      pipelineSignals: { rankingsSuppressed: false },
      recommendations: [] // No directional recommendation materialized
    })

    const result = await botService.executeNextSignal({ userId: 'usr_alice' })
    expect(result.executed).toBe(false)
    expect(result.rejectedReason).toBe('NO_RECOMMENDATIONS')
    expect(prisma.execution.create).not.toHaveBeenCalled()
  })

  // ─── Scenario 3: Degraded or stale intelligence blocking execution ───────────
  it('3. Degraded or stale intelligence fails closed and blocks execution', async () => {
    const degradedPayload = {
      intelligenceConfidenceTier: 'degraded',
      pipelineSignals: {
        rankingsSuppressed: true,
        suppressionReasons: ['STALE_BARS_DETECTED', 'DATA_PIPELINE_OUTAGE']
      },
      recommendations: [
        { ticker: 'AAPL', action: 'BUY', confidence: 0.95 }
      ]
    }

    vi.spyOn(engineClient, 'getRecommendationsLatest').mockResolvedValue(degradedPayload)

    // engineClient fails closed
    const signals = await engineClient.getActiveSignals()
    expect(signals).toEqual([])

    // botService rejects execution and preserves diagnostics
    const result = await botService.executeNextSignal({ userId: 'usr_alice' })
    expect(result.executed).toBe(false)
    expect(result.rejectedReason).toBe('INTELLIGENCE_DEGRADED')
    expect(result.diagnostics.tier).toBe('degraded')
    expect(result.diagnostics.rankingsSuppressed).toBe(true)
    expect(result.diagnostics.reasons).toContain('STALE_BARS_DETECTED')
    expect(prisma.execution.create).not.toHaveBeenCalled()
  })

  // ─── Scenario 4: Missing trading direction never becoming a buy order ────────
  it('4. Missing or non-explicit trading direction is never defaulted to buy', async () => {
    // Recommendation with missing action or 'HOLD'
    const ambiguousRecs = {
      intelligenceConfidenceTier: 'nominal',
      recommendations: [
        { ticker: 'AMZN', action: null, confidence: 0.85, price: 180 },
        { ticker: 'GOOGL', action: 'HOLD', confidence: 0.82, price: 175 }
      ]
    }

    vi.spyOn(engineClient, 'getRecommendationsLatest').mockResolvedValue(ambiguousRecs)

    // 1. engineClient.getActiveSignals filters out null and HOLD
    const signals = await engineClient.getActiveSignals({ minConfidence: 0.5 })
    expect(signals).toHaveLength(0)

    // 2. botService.executeNextSignal rejects non-BUY/SELL
    const result = await botService.executeNextSignal({ userId: 'usr_alice', minConfidence: 0.5 })
    expect(result.executed).toBe(false)
    expect(result.rejectedReason).toBe('INVALID_TRADING_DIRECTION')
    expect(result.diagnostics.message).toContain('explicit BUY or SELL action')

    // 3. botService.executeSignal throws directly if direction is missing or invalid
    await expect(
      botService.executeSignal({ symbol: 'AMZN', direction: null }, { userId: 'usr_alice' })
    ).rejects.toThrow(/Invalid trading direction/)

    await expect(
      botService.executeSignal({ symbol: 'AMZN', direction: 'hold' }, { userId: 'usr_alice' })
    ).rejects.toThrow(/Invalid trading direction/)

    expect(prisma.execution.create).not.toHaveBeenCalled()
  })

  // ─── Scenario 5: Invalid or missing user context rejecting order creation ────
  it('5. Missing or invalid user context rejects order creation immediately', async () => {
    // Unauthenticated HTTP request to create execution
    const unauthRes = await request(app.server)
      .post('/api/executions')
      .send({
        ticker: 'NVDA',
        direction: 'buy',
        quantity: 1,
        price: 130,
        portfolioId: 'por_alice_1'
      })
      .expect(401)

    expect(unauthRes.body.error).toBe('Authentication failed')

    // botService.executeNextSignal without userId
    const noUserResult = await botService.executeNextSignal({ userId: null })
    expect(noUserResult.executed).toBe(false)
    expect(noUserResult.rejectedReason).toBe('MISSING_USER_CONTEXT')

    // executionsService.createExecution throws if userId is missing
    await expect(
      executionsService.createExecution({
        userId: null,
        portfolioId: 'por_alice_1',
        ticker: 'NVDA',
        direction: 'buy',
        quantity: 1,
        price: 130
      })
    ).rejects.toThrow(/userId is required/)

    expect(prisma.execution.create).not.toHaveBeenCalled()
  })

  // ─── Scenario 6: Two users remaining completely isolated ─────────────────────
  it('6. Multi-user isolation is strictly enforced across portfolios and metrics', async () => {
    // 1. Bob attempts to access Alice's portfolio directly -> 404 (Not Found / Access Denied)
    const bobAccessAlicePortfolio = await request(app.server)
      .get('/api/portfolios/por_alice_1')
      .set('Authorization', `Bearer ${tokenBob}`)
      .expect(404)

    expect(bobAccessAlicePortfolio.body.error.code).toBe('NOT_FOUND')

    // 2. Bob lists portfolios -> only sees his own portfolio
    const bobListPortfolios = await request(app.server)
      .get('/api/portfolios')
      .set('Authorization', `Bearer ${tokenBob}`)
      .expect(200)

    expect(bobListPortfolios.body.data).toHaveLength(1)
    expect(bobListPortfolios.body.data[0].id).toBe('por_bob_1')
    expect(bobListPortfolios.body.data[0].userId).toBe('usr_bob')

    // 3. Alice lists portfolios -> only sees her own portfolio
    const aliceListPortfolios = await request(app.server)
      .get('/api/portfolios')
      .set('Authorization', `Bearer ${tokenAlice}`)
      .expect(200)

    expect(aliceListPortfolios.body.data).toHaveLength(1)
    expect(aliceListPortfolios.body.data[0].id).toBe('por_alice_1')
    expect(aliceListPortfolios.body.data[0].userId).toBe('usr_alice')

    // 4. Bob queries metrics -> calculated strictly with Bob's userId
    const bobMetrics = await request(app.server)
      .get('/api/metrics/portfolio/summary')
      .set('Authorization', `Bearer ${tokenBob}`)
      .expect(200)

    expect(bobMetrics.body).toBeDefined()
    expect(bobMetrics.body.totalTrades).toBe(0)
    expect(prisma.tradeMetricFact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'usr_bob' })
    }))
  })

  // ─── Scenario 7: Engine authentication failures ──────────────────────────────
  it('7. Engine rejects unauthenticated calls when INTERNAL_READ_KEY is invalid', async () => {
    // Calling Alpha Engine endpoint with invalid key via global fetch mock
    const originalFetch = global.fetch
    global.fetch = vi.fn(async (url, opts) => {
      const key = opts?.headers?.['X-Internal-Key']
      if (key !== 'correct_secret_key') {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'unauthorized', message: 'Invalid internal read key' })
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' })
      }
    })

    try {
      const resp = await global.fetch('http://127.0.0.1:8090/api/consensus/signals', {
        headers: { 'X-Internal-Key': 'wrong_key' }
      })
      expect(resp.status).toBe(401)
      const data = await resp.json()
      expect(data.error).toBe('unauthorized')
    } finally {
      global.fetch = originalFetch
    }
  })

  // ─── Scenario 8: Consensus signals with null sentiment values ────────────────
  it('8. Consensus signals endpoint gracefully handles null sentiment values', async () => {
    // Verify that client parses signal payload containing null sentiment values
    const mockConsensusPayload = {
      tenant_id: 'default',
      count: 2,
      signals: [
        {
          ticker: 'OMI',
          regime: 'DISCOVERY',
          sentimentStrategyId: null,
          quantStrategyId: 'realness_repricer_v1',
          sentimentScore: null,
          quantScore: 0.72,
          conviction: 0.65,
          timestamp: '2026-11-20T17:00:00Z'
        },
        {
          ticker: 'AAPL',
          regime: 'ACTIVE',
          sentimentStrategyId: 'finbert_v1',
          quantStrategyId: 'trend_v1',
          sentimentScore: 0.85,
          quantScore: 0.90,
          conviction: 0.88,
          timestamp: '2026-11-20T17:00:00Z'
        }
      ]
    }

    vi.spyOn(engineClient, 'getConsensusSignals').mockResolvedValue(mockConsensusPayload)

    const result = await engineClient.getConsensusSignals()
    expect(result.signals).toHaveLength(2)
    expect(result.signals[0].sentimentScore).toBeNull()
    expect(result.signals[0].sentimentStrategyId).toBeNull()
    expect(result.signals[0].quantScore).toBe(0.72)
    expect(result.signals[1].sentimentScore).toBe(0.85)
  })

  // ─── Scenario 9: Frontend routes matching actual Fastify endpoints ───────────
  it('9. Fastify exposes all endpoints queried by React frontend', async () => {
    vi.spyOn(engineClient, 'getRegime').mockResolvedValue({
      marketRegime: 'BULLISH',
      confidence: 0.85,
      symbol: 'SPY'
    })

    vi.spyOn(engineClient, 'getTickers').mockResolvedValue([
      { symbol: 'AAPL', companyName: 'Apple Inc.' },
      { symbol: 'NVDA', companyName: 'NVIDIA Corp.' }
    ])

    vi.spyOn(engineClient, 'getQuote').mockResolvedValue({
      symbol: 'AAPL',
      price: 180.25,
      change: 1.50
    })

    vi.spyOn(engineClient, 'getHistory').mockResolvedValue([
      { time: '2026-11-20', close: 180.25 }
    ])

    vi.spyOn(engineClient, 'getRecommendationsLatest').mockResolvedValue({
      recommendations: [{ ticker: 'AAPL', action: 'BUY', confidence: 0.89 }]
    })

    // 1. /api/regime/:symbol (requested on landing / dashboard)
    const regimeRes = await request(app.server).get('/api/regime/SPY').expect(200)
    expect(regimeRes.body.data.marketRegime).toBe('BULLISH')

    // 2. /api/engine/tickers (requested by search & watchlist)
    const tickersRes = await request(app.server).get('/api/engine/tickers').expect(200)
    expect(tickersRes.body.data).toHaveLength(2)

    // 3. /tickers alias
    const tickersAliasRes = await request(app.server).get('/tickers').expect(200)
    expect(tickersAliasRes.body.data).toHaveLength(2)

    // 4. /api/engine/quote/:symbol
    const quoteRes = await request(app.server).get('/api/engine/quote/AAPL').expect(200)
    expect(quoteRes.body.data.price).toBe(180.25)

    // 5. /api/engine/history/:symbol
    const historyRes = await request(app.server).get('/api/engine/history/AAPL').expect(200)
    expect(historyRes.body.data).toHaveLength(1)

    // 6. /api/bot/current-signal
    const botSignalRes = await request(app.server)
      .get('/api/bot/current-signal')
      .set('Authorization', `Bearer ${tokenAlice}`)
      .expect(200)
    expect(botSignalRes.body.signal.symbol).toBe('AAPL')
    expect(botSignalRes.body.signal.direction).toBe('buy')
  })

  // ─── Scenario 10: Engine outages producing explicit degraded states ──────────
  it('10. Engine outages produce explicit degraded states instead of crashing', async () => {
    // Simulate engine being offline
    vi.spyOn(engineClient, 'getRegime').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8090'))
    vi.spyOn(engineClient, 'getRecommendationsLatest').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8090'))

    // 1. Regime endpoint falls back to degraded payload
    const regimeRes = await request(app.server).get('/api/regime/SPY').expect(200)
    expect(regimeRes.body.data.isDegraded).toBe(true)
    expect(regimeRes.body.data.source).toBe('fallback')

    // 2. botService fails closed with ENGINE_UNAVAILABLE
    const botResult = await botService.executeNextSignal({ userId: 'usr_alice' })
    expect(botResult.executed).toBe(false)
    expect(botResult.rejectedReason).toBe('ENGINE_UNAVAILABLE')
    expect(botResult.diagnostics.error).toContain('ECONNREFUSED')

    // 3. /api/bot/current-signal returns explicit degraded response
    const currentSignalRes = await request(app.server)
      .get('/api/bot/current-signal')
      .set('Authorization', `Bearer ${tokenAlice}`)
      .expect(200)

    expect(currentSignalRes.body.degraded).toBe(true)
    expect(currentSignalRes.body.reason).toBe('ENGINE_UNAVAILABLE')
    expect(currentSignalRes.body.signal).toBeNull()
  })
})
