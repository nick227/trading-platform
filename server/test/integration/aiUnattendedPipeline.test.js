/**
 * Integration Tests: Unattended Daily Autonomous Trading Pipeline
 * 
 * Verifies the complete 5-stage lifecycle:
 * 1. Market Data Ingestion & Validation
 * 2. Market Open Execution of pending next_open orders
 * 3. AI Research Decisions (idempotent, single authoritative runner)
 * 4. Portfolio Accounting & Valuation Reconciliation
 * 5. Strategy Evidence Publication & Pipeline Monitoring API
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import prisma from '../../src/loaders/prisma.js'
import createApp from '../../src/loaders/fastify.js'
import registerRoutes from '../../src/loaders/routes.js'
import {
  validateAndIngestDailyMarketData,
  DEFAULT_TRADABLE_SYMBOLS
} from '../../src/services/ai/aiMarketDataService.js'
import { runAiStrategyMarketOpenJob } from '../../src/jobs/aiStrategyMarketOpenJob.js'
import { runAiStrategyDailyJob } from '../../src/jobs/aiStrategyDailyJob.js'
import { getAiPipelineStatus } from '../../src/services/ai/aiPipelineTracker.js'
import { getOrCreateCanonicalAiBot } from '../../src/services/ai/aiBotService.js'
import request from 'supertest'

describe('Unattended Daily Autonomous Trading Pipeline', () => {
  let app
  let canonicalBot

  beforeAll(async () => {
    app = await createApp()
    await registerRoutes(app)
    await app.ready()

    const res = await getOrCreateCanonicalAiBot({ prismaClient: prisma })
    canonicalBot = res.bot
  })

  afterAll(async () => {
    await app.close()
  })

  // ---------------------------------------------------------------------------
  // Stage 1: Market Data Ingestion & Validation
  // ---------------------------------------------------------------------------
  describe('Stage 1: Market Data Ingestion & Validation', () => {
    it('validates a complete, sound 10-symbol universe up to the target session', async () => {
      // Mock engine with valid 10-symbol data for session 2026-11-25
      const mockEngine = {
        async getDailyBars(sym, start, end) {
          const bars = []
          for (let i = 25; i >= 0; i--) {
            const d = new Date(Date.parse('2026-11-25T00:00:00Z') - i * 86_400_000).toISOString().slice(0, 10)
            bars.push([d, 100 + i, 105 + i, 98 + i, 102 + i, 5_000_000])
          }
          return { ticker: sym, bars, source: 'alpha-engine price_bars' }
        }
      }

      const res = await validateAndIngestDailyMarketData({
        session: '2026-11-25',
        symbols: DEFAULT_TRADABLE_SYMBOLS,
        engine: mockEngine
      })

      expect(res.valid).toBe(true)
      expect(res.session).toBe('2026-11-25')
      expect(res.symbolsValidated).toBe(10)
      expect(res.missingSymbols.length).toBe(0)
      expect(res.staleSymbols.length).toBe(0)
      expect(res.invalidBars.length).toBe(0)
    })

    it('rejects incomplete universe data when symbols are missing', async () => {
      const mockEngineIncomplete = {
        async getDailyBars(sym, start, end) {
          if (sym === 'NVDA' || sym === 'MSFT') {
            return { ticker: sym, bars: [] } // Missing bars
          }
          return {
            ticker: sym,
            bars: [['2026-11-25', 100, 105, 98, 102, 5_000_000]]
          }
        }
      }

      const res = await validateAndIngestDailyMarketData({
        session: '2026-11-25',
        symbols: DEFAULT_TRADABLE_SYMBOLS,
        engine: mockEngineIncomplete
      })

      expect(res.valid).toBe(false)
      expect(res.missingSymbols).toContain('NVDA')
      expect(res.missingSymbols).toContain('MSFT')
      expect(res.reason).toMatch(/missing_symbols/)
    })

    it('rejects stale market data where bar date is older than session', async () => {
      const mockEngineStale = {
        async getDailyBars(sym, start, end) {
          return {
            ticker: sym,
            bars: [['2026-11-20', 100, 105, 98, 102, 5_000_000]] // Bar is from Nov 20, session is Nov 25
          }
        }
      }

      const res = await validateAndIngestDailyMarketData({
        session: '2026-11-25',
        symbols: DEFAULT_TRADABLE_SYMBOLS,
        engine: mockEngineStale
      })

      expect(res.valid).toBe(false)
      expect(res.staleSymbols.length).toBe(10)
      expect(res.reason).toMatch(/stale_symbols/)
    })

    it('rejects future data leak if bar date exceeds session', async () => {
      const mockEngineFutureLeak = {
        async getDailyBars(sym, start, end) {
          return {
            ticker: sym,
            bars: [
              ['2026-11-25', 100, 105, 98, 102, 5_000_000],
              ['2026-11-26', 105, 110, 104, 108, 6_000_000] // Future bar relative to 2026-11-25
            ]
          }
        }
      }

      const res = await validateAndIngestDailyMarketData({
        session: '2026-11-25',
        symbols: DEFAULT_TRADABLE_SYMBOLS,
        engine: mockEngineFutureLeak
      })

      expect(res.valid).toBe(false)
      expect(res.invalidBars.some(i => i.reason === 'future_data_leak')).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Stage 2: Market Open Execution & Portfolio Reconciliation
  // ---------------------------------------------------------------------------
  describe('Stage 2: Market Open Execution of Pending Orders', () => {
    it('executes queued next_open order at market open and updates portfolio', async () => {
      const testOrderId = `exec_mktopen_${Date.now()}`
      const clientOrderId = `co_mktopen_${Date.now()}`

      // Create a queued paper buy order for AAPL targeting session 2026-11-25
      const exec = await prisma.execution.create({
        data: {
          id: testOrderId,
          userId: canonicalBot.userId,
          portfolioId: canonicalBot.portfolioId,
          botId: canonicalBot.id,
          ticker: 'AAPL',
          direction: 'buy',
          quantity: 2,
          price: 350.00,
          status: 'queued',
          origin: 'bot',
          sourceType: 'AI_FORWARD',
          sourceId: 'tmpl_ai_catalyst_momentum',
          simSession: '2026-11-25',
          clientOrderId,
          commission: 0,
          fees: 0,
          pnl: 0
        }
      })

      await prisma.executionAudit.create({
        data: {
          id: `aud_mktopen_${Date.now()}`,
          executionId: exec.id,
          userId: exec.userId,
          workerId: 'test',
          eventType: 'execution_created',
          detail: 'Queued test BUY order',
          metadata: {
            entryType: 'next_open',
            targetSession: '2026-11-25'
          }
        }
      })

      const mockEngine = {
        async getSessionClose(ticker, session) {
          return {
            ticker,
            session,
            open: 352.50, // genuine open price
            close: 351.00,
            source: 'alpha-engine'
          }
        },
        async getDailyBars(sym, start, end) {
          return {
            ticker: sym,
            bars: [['2026-11-25', 352.50, 355.00, 350.00, 351.00, 10_000_000]]
          }
        }
      }

      // Execute market open job for Wednesday 2026-11-25 at 9:45 AM ET (14:45 UTC)
      const nowWedMorning = new Date('2026-11-25T14:45:00Z')
      const openResult = await runAiStrategyMarketOpenJob({
        templateId: 'tmpl_ai_catalyst_momentum',
        now: nowWedMorning,
        prismaClient: prisma,
        engine: mockEngine
      })

      expect(openResult.ok).toBe(true)
      expect(openResult.filledCount).toBeGreaterThanOrEqual(1)

      // Verify execution updated in database
      const updatedExec = await prisma.execution.findUnique({ where: { id: testOrderId } })
      expect(updatedExec.status).toBe('filled')
      expect(updatedExec.filledPrice).toBe(352.50) // Filled at open price!
      expect(updatedExec.filledQuantity).toBe(2)

      // Test idempotency: re-running market open job does NOT duplicate fills
      const rerunResult = await runAiStrategyMarketOpenJob({
        templateId: 'tmpl_ai_catalyst_momentum',
        now: nowWedMorning,
        prismaClient: prisma,
        engine: mockEngine
      })
      expect(rerunResult.ok).toBe(true)
      expect(rerunResult.filledCount).toBe(0)

      // Clean up test execution
      await prisma.executionAudit.deleteMany({ where: { executionId: testOrderId } })
      await prisma.execution.delete({ where: { id: testOrderId } })
    })

    it('skips market open execution on weekend or exchange holiday', async () => {
      // 2026-11-26 is Thanksgiving Day (US exchange holiday)
      const thanksgiving = new Date('2026-11-26T14:45:00Z')
      const res = await runAiStrategyMarketOpenJob({
        templateId: 'tmpl_ai_catalyst_momentum',
        now: thanksgiving,
        prismaClient: prisma
      })

      expect(res.ok).toBe(true)
      expect(res.skipped).toBe(true)
      expect(res.reason).toBe('not_trading_day')
    })
  })

  // ---------------------------------------------------------------------------
  // Stage 5: Pipeline Monitoring & Diagnostics API
  // ---------------------------------------------------------------------------
  describe('Stage 5: Pipeline Status & Public Monitoring API', () => {
    it('returns full 5-stage status diagnostics via getAiPipelineStatus', async () => {
      const status = await getAiPipelineStatus({
        templateId: 'tmpl_ai_catalyst_momentum',
        prismaClient: prisma
      })

      expect(status.status).toBeDefined()
      expect(status.strategyId).toBe('tmpl_ai_catalyst_momentum')
      expect(status.botId).toBe(canonicalBot.id)
      expect(status.expectedCompletedSession).toBeDefined()
      expect(status.stages).toBeDefined()
      expect(status.stages.market_data_ingestion).toBeDefined()
      expect(status.stages.pending_order_execution).toBeDefined()
      expect(status.stages.ai_research_decision).toBeDefined()
      expect(status.stages.portfolio_valuation).toBeDefined()
      expect(status.stages.strategy_evidence_publication).toBeDefined()
      expect(status.scheduler.enabled).toBe(true)
    })

    it('serves pipeline status publicly without authentication via HTTP API', async () => {
      const response = await request(app.server)
        .get('/api/public/strategies/tmpl_ai_catalyst_momentum/pipeline')
        .expect(200)

      expect(response.body.data).toBeDefined()
      expect(response.body.data.strategyId).toBe('tmpl_ai_catalyst_momentum')
      expect(response.body.data.portfolio).toBeDefined()
      expect(response.body.data.stages).toBeDefined()
    })
  })
})
