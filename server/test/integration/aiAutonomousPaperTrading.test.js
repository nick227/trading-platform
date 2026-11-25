import 'dotenv/config'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import prisma from '../../src/loaders/prisma.js'
import { engineClient } from '../../src/clients/engine.js'
import {
  getOrCreateCanonicalAiBot,
  executeAiStrategyCycle,
  processPendingAiExecutions,
  computeAiBotForwardEquity,
  getAiDecisionsHistory
} from '../../src/services/ai/aiBotService.js'
import { registerCustomProvider } from '../../src/services/ai/providers/providerRegistry.js'
import { BaseLLMProvider } from '../../src/services/ai/providers/baseProvider.js'
import { runAiStrategyDailyJob } from '../../src/jobs/aiStrategyDailyJob.js'
import { generateStrategyEvidence, listPublicStrategies } from '../../src/services/strategyEvidenceService.js'

/**
 * Deterministic test provider modeling disciplined autonomous AI decisions:
 * - On 2026-10-07 (strong tech momentum): identifies NVDA breakout, recommends BUY 15% with take-profit +6% / stop-loss -4%.
 * - On 2026-10-14 (momentum breakdown / protective stop): recommends SELL held NVDA to cut loss.
 * - On other symbols or neutral markets: issues disciplined HOLD.
 */
class ScenarioLlmProvider extends BaseLLMProvider {
  constructor() {
    super('scenario_llm')
    this.callCount = 0
  }

  async completeStructured({ systemPrompt, userPrompt, temperature = 0.2 }) {
    this.callCount++
    // Simulate real asynchronous network / inference latency
    await new Promise(r => setTimeout(r, 60))

    // Determine session from userPrompt
    const isOct7 = userPrompt.includes('2026-10-07') || userPrompt.includes('2026-10-09')
    const isOct14 = userPrompt.includes('2026-10-14')

    if (isOct7) {
      return {
        model: 'scenario-llm-v1',
        provider: 'scenario_llm',
        usage: { prompt_tokens: 1500, completion_tokens: 300, total_tokens: 1800 },
        structured: {
          marketSummary: 'Bullish tech momentum regime. QQQ and large-cap semiconductors exhibiting strong multi-week relative strength above moving averages.',
          symbolEvaluations: [
            {
              symbol: 'NVDA',
              action: 'BUY',
              confidence: 0.82,
              targetAllocationPct: 15,
              entryType: 'next_close',
              exitRule: { takeProfitPct: 6, stopLossPct: 4 },
              thesis: 'NVDA is up 6.29% over 20 days and 3.98% over 5 days, maintaining leadership in AI infrastructure.',
              evidence: ['5-day return +3.98%', '20-day return +6.29%', 'Strong tech sector breadth']
            },
            {
              symbol: 'SPY',
              action: 'HOLD',
              confidence: 0.65,
              targetAllocationPct: 0,
              entryType: 'next_close',
              exitRule: { takeProfitPct: 6, stopLossPct: 4 },
              thesis: 'Broad market is constructive but tech offers superior risk-adjusted momentum.',
              evidence: ['5-day return +1.91%']
            },
            {
              symbol: 'QQQ', action: 'HOLD', confidence: 0.70, targetAllocationPct: 0, entryType: 'next_close',
              exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Bullish but allocating directly to leading single stock.', evidence: ['5d +2.43%']
            },
            { symbol: 'AAPL', action: 'HOLD', confidence: 0.60, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Moderate momentum.', evidence: [] },
            { symbol: 'MSFT', action: 'HOLD', confidence: 0.65, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Holding for confirmation.', evidence: [] },
            { symbol: 'AMZN', action: 'HOLD', confidence: 0.62, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Moderate volume.', evidence: [] },
            { symbol: 'GOOGL', action: 'HOLD', confidence: 0.60, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Underperforming peers.', evidence: [] },
            { symbol: 'JPM', action: 'HOLD', confidence: 0.60, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Financials lagging.', evidence: [] },
            { symbol: 'XOM', action: 'HOLD', confidence: 0.60, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Energy consolidates.', evidence: [] },
            { symbol: 'META', action: 'HOLD', confidence: 0.65, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Strong 20d return but awaiting fresh entry.', evidence: [] }
          ],
          selectedDecisions: [
            {
              symbol: 'NVDA',
              action: 'BUY',
              confidence: 0.82,
              targetAllocationPct: 0.15,
              entryType: 'next_close',
              exitRule: { takeProfitPct: 6, stopLossPct: 4 },
              thesis: 'NVDA is up 6.29% over 20 days and 3.98% over 5 days, maintaining leadership in AI infrastructure.',
              evidence: ['5-day return +3.98%', '20-day return +6.29%', 'Strong tech sector breadth']
            }
          ]
        }
      }
    }

    if (isOct14) {
      return {
        model: 'scenario-llm-v1',
        provider: 'scenario_llm',
        usage: { prompt_tokens: 1500, completion_tokens: 300, total_tokens: 1800 },
        structured: {
          marketSummary: 'Momentum breakdown observed. Risk mitigation requires cutting underperforming positions.',
          symbolEvaluations: [
            {
              symbol: 'NVDA',
              action: 'SELL',
              confidence: 0.85,
              targetAllocationPct: 0,
              entryType: 'next_close',
              exitRule: { takeProfitPct: 6, stopLossPct: 4 },
              thesis: 'NVDA broke below support and hit stop-loss risk threshold. Liquidating to preserve capital.',
              evidence: ['Hit protective stop loss threshold', 'Short-term trend reversal']
            },
            { symbol: 'SPY', action: 'HOLD', confidence: 0.65, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Cautious stance.', evidence: [] },
            { symbol: 'QQQ', action: 'HOLD', confidence: 0.65, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Tech selling pressure.', evidence: [] },
            { symbol: 'AAPL', action: 'HOLD', confidence: 0.60, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Neutral.', evidence: [] },
            { symbol: 'MSFT', action: 'HOLD', confidence: 0.60, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Neutral.', evidence: [] },
            { symbol: 'AMZN', action: 'HOLD', confidence: 0.60, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Neutral.', evidence: [] },
            { symbol: 'GOOGL', action: 'HOLD', confidence: 0.60, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Neutral.', evidence: [] },
            { symbol: 'JPM', action: 'HOLD', confidence: 0.60, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Neutral.', evidence: [] },
            { symbol: 'XOM', action: 'HOLD', confidence: 0.60, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Neutral.', evidence: [] },
            { symbol: 'META', action: 'HOLD', confidence: 0.60, targetAllocationPct: 0, entryType: 'next_close', exitRule: { takeProfitPct: 6, stopLossPct: 4 }, thesis: 'Neutral.', evidence: [] }
          ],
          selectedDecisions: [
            {
              symbol: 'NVDA',
              action: 'SELL',
              confidence: 0.85,
              targetAllocationPct: 0,
              entryType: 'next_close',
              exitRule: { takeProfitPct: 6, stopLossPct: 4 },
              thesis: 'NVDA broke below support and hit stop-loss risk threshold. Liquidating to preserve capital.',
              evidence: ['Hit protective stop loss threshold', 'Short-term trend reversal']
            }
          ]
        }
      }
    }

    // Default neutral HOLD on all symbols
    return {
      model: 'scenario-llm-v1',
      provider: 'scenario_llm',
      usage: { prompt_tokens: 1500, completion_tokens: 300, total_tokens: 1800 },
      structured: {
        marketSummary: 'Market consolidating in neutral range.',
        symbolEvaluations: [
          'SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'JPM', 'XOM', 'META'
        ].map(s => ({
          symbol: s,
          action: 'HOLD',
          confidence: 0.65,
          targetAllocationPct: 0,
          entryType: 'next_close',
          exitRule: { takeProfitPct: 6, stopLossPct: 4 },
          thesis: `${s} remains in consolidation.`,
          evidence: []
        }))
      }
    }
  }
}

describe.sequential('Autonomous AI Paper Trading & Accounting Lifecycle', () => {
  let canonicalBot
  let testProviderInstance
  const TEST_PROVIDER = 'test_scenario_provider'

  beforeEach(async () => {
    testProviderInstance = new ScenarioLlmProvider()
    registerCustomProvider(TEST_PROVIDER, testProviderInstance)
    const res = await getOrCreateCanonicalAiBot({ prismaClient: prisma })
    canonicalBot = res.bot

    // Clean up test executions and events
    await prisma.executionAudit.deleteMany()
    await prisma.execution.deleteMany()
    await prisma.botEvent.deleteMany()
    await prisma.strategyEvidence.deleteMany({ where: { templateId: 'tmpl_ai_catalyst_momentum' } })
  })

  afterEach(async () => {
    await prisma.executionAudit.deleteMany()
    await prisma.execution.deleteMany()
    await prisma.botEvent.deleteMany()
    await prisma.strategyEvidence.deleteMany({ where: { templateId: 'tmpl_ai_catalyst_momentum' } })
  })

  it('validates AI-generated BUY and subsequent SELL through paper engine with FIFO accounting', { timeout: 60_000 }, async () => {
    // -------------------------------------------------------------------------
    // Phase 1: Research Cycle on 2026-10-07 -> Generates BUY for NVDA
    // -------------------------------------------------------------------------
    const cycle1 = await executeAiStrategyCycle({
      botId: canonicalBot.id,
      session: '2026-10-07',
      providerName: TEST_PROVIDER,
      prismaClient: prisma,
      engine: engineClient
    })

    expect(cycle1.ok).toBe(true)
    expect(cycle1.asOfSession).toBe('2026-10-07')
    expect(cycle1.actionableCount).toBe(1)
    expect(cycle1.createdExecutions.length).toBe(1)

    const buyOrder = cycle1.createdExecutions[0]
    expect(buyOrder.symbol).toBe('NVDA')
    expect(buyOrder.direction).toBe('buy')
    expect(buyOrder.targetSession).toBe('2026-10-08') // Look-ahead protected: next session
    expect(buyOrder.quantity).toBeGreaterThan(0)

    // Verify 3 distinct timestamps are recorded in the audit event
    const events1 = await getAiDecisionsHistory(canonicalBot.id)
    const cycleEvent1 = events1.find(e => e.metadata?.asOfSession === '2026-10-07')
    expect(cycleEvent1).toBeDefined()
    expect(cycleEvent1.metadata.asOfSession).toBe('2026-10-07')
    expect(cycleEvent1.metadata.decisionTimestamp).toBeDefined()
    expect(cycleEvent1.metadata.intendedExecutionSession).toBe('2026-10-08')

    // -------------------------------------------------------------------------
    // Phase 2: Session 2026-10-08 completes -> Paper Engine fills BUY order
    // -------------------------------------------------------------------------
    const fill1 = await processPendingAiExecutions(canonicalBot.id, {
      currentSession: '2026-10-08',
      prismaClient: prisma,
      engine: engineClient
    })

    expect(fill1.filledExecutions.length).toBe(1)
    const filledBuy = fill1.filledExecutions[0]
    expect(filledBuy.ticker).toBe('NVDA')
    expect(filledBuy.direction).toBe('buy')
    expect(filledBuy.session).toBe('2026-10-08')
    expect(filledBuy.fillPrice).toBeCloseTo(230.48, 1) // actual 2026-10-08 close
    expect(filledBuy.brokerOrderId).toMatch(/^sim(replay|daily)_/)

    // Verify position is now open (using includeReplay: true for historical replay tests)
    const midEquity = await computeAiBotForwardEquity(canonicalBot.id, {
      asOfSession: '2026-10-08',
      includeReplay: true,
      prismaClient: prisma,
      engine: engineClient
    })
    expect(midEquity.trades).toBe(1)
    expect(midEquity.cash).toBeLessThan(10_000)

    // Verify chronological integrity: forward performance strictly excludes historical replay trades
    const forwardExclusion = await computeAiBotForwardEquity(canonicalBot.id, {
      asOfSession: '2026-10-08',
      includeReplay: false,
      prismaClient: prisma,
      engine: engineClient
    })
    expect(forwardExclusion.trades).toBe(0)
    expect(forwardExclusion.status).toBe('awaiting_sessions')

    // -------------------------------------------------------------------------
    // Phase 3: Research Cycle on 2026-10-14 -> Generates SELL for held NVDA
    // -------------------------------------------------------------------------
    const cycle2 = await executeAiStrategyCycle({
      botId: canonicalBot.id,
      session: '2026-10-14',
      providerName: TEST_PROVIDER,
      prismaClient: prisma,
      engine: engineClient
    })

    expect(cycle2.ok).toBe(true)
    expect(cycle2.asOfSession).toBe('2026-10-14')
    expect(cycle2.actionableCount).toBe(1)
    expect(cycle2.createdExecutions.length).toBe(1)

    const sellOrder = cycle2.createdExecutions[0]
    expect(sellOrder.symbol).toBe('NVDA')
    expect(sellOrder.direction).toBe('sell')
    expect(sellOrder.quantity).toBe(buyOrder.quantity)
    expect(sellOrder.targetSession).toBe('2026-10-15')

    // -------------------------------------------------------------------------
    // Phase 4: Session 2026-10-15 completes -> Paper Engine fills SELL & calculates PnL
    // -------------------------------------------------------------------------
    const fill2 = await processPendingAiExecutions(canonicalBot.id, {
      currentSession: '2026-10-15',
      prismaClient: prisma,
      engine: engineClient
    })

    expect(fill2.filledExecutions.length).toBe(1)
    const filledSell = fill2.filledExecutions[0]
    expect(filledSell.ticker).toBe('NVDA')
    expect(filledSell.direction).toBe('sell')
    expect(filledSell.session).toBe('2026-10-15')
    expect(filledSell.fillPrice).toBeCloseTo(217.23, 1) // actual 2026-10-15 close
    expect(filledSell.brokerOrderId).toMatch(/^sim(replay|daily)_/)
    expect(filledSell.pnl).not.toBe(0) // Realized FIFO loss recorded cleanly

    // -------------------------------------------------------------------------
    // Phase 5: Replay Portfolio Accounting & Verification
    // -------------------------------------------------------------------------
    const finalEquity = await computeAiBotForwardEquity(canonicalBot.id, {
      asOfSession: '2026-10-15',
      includeReplay: true,
      prismaClient: prisma,
      engine: engineClient
    })

    expect(finalEquity.status).toBe('ok')
    expect(finalEquity.trades).toBe(2)
    expect(finalEquity.closedTradesCount).toBe(1)
    expect(finalEquity.realizedPnl).toBeLessThan(0) // Sold at $217.23 vs buy at $230.48
    expect(finalEquity.curve.length).toBeGreaterThanOrEqual(5)
    expect(finalEquity.buyAndHold.curve.length).toBeGreaterThanOrEqual(5)
  })

  it('enforces recurring autonomous scheduler idempotency and processes pending fills on repeated runs', { timeout: 60_000 }, async () => {
    // 1st run of the daily job on session 2026-11-20
    const job1 = await runAiStrategyDailyJob({
      templateId: 'tmpl_ai_catalyst_momentum',
      session: '2026-11-20',
      providerName: TEST_PROVIDER,
      syncEvidence: false,
      prismaClient: prisma,
      engine: engineClient
    })

    expect(job1.ok).toBe(true)
    expect(job1.researchSkipped).toBe(false)

    // 2nd run on the same session: research cycle is idempotently skipped, but job completes ok
    const job2 = await runAiStrategyDailyJob({
      templateId: 'tmpl_ai_catalyst_momentum',
      session: '2026-11-20',
      providerName: TEST_PROVIDER,
      syncEvidence: false,
      prismaClient: prisma,
      engine: engineClient
    })

    expect(job2.ok).toBe(true)
    expect(job2.researchSkipped).toBe(true)
    expect(job2.skipReason).toBe('already_executed_for_session')
  }, 30_000)

  it('attaches canonical bot to dedicated platform user and portfolio, never arbitrary users', async () => {
    // Create an arbitrary third-party user first
    await prisma.user.create({
      data: {
        id: 'usr_arbitrary_customer',
        email: 'arbitrary@customer.com',
        fullName: 'Arbitrary Customer',
        passwordHash: '$arbitrary_hash$'
      }
    })

    const { bot, user, portfolio } = await getOrCreateCanonicalAiBot({ prismaClient: prisma })
    expect(user.id).toBe('usr_platform_canonical')
    expect(portfolio.id).toBe('port_platform_canonical')
    expect(bot.userId).toBe('usr_platform_canonical')
    expect(bot.portfolioId).toBe('port_platform_canonical')

    // Clean up arbitrary user
    await prisma.user.delete({ where: { id: 'usr_arbitrary_customer' } })
  })

  it('skips cycle and reports reason when fresh market data is unavailable', async () => {
    const mockEngineEmpty = {
      getDailyBars: async () => ({ bars: [] })
    }

    const job = await runAiStrategyDailyJob({
      templateId: 'tmpl_ai_catalyst_momentum',
      session: null, // forces dynamic discovery
      prismaClient: prisma,
      engine: mockEngineEmpty
    })

    expect(job.ok).toBe(true)
    expect(job.skipped).toBe(true)
    expect(job.reason).toBe('fresh_market_data_unavailable')
  })

  it('processes pending eligible fills even when research cycle has already completed', { timeout: 60_000 }, async () => {
    // 1. Manually queue an order targeting session 2026-11-20
    const testExecId = `exec_pending_test_${Date.now()}`
    await prisma.execution.create({
      data: {
        id: testExecId,
        userId: canonicalBot.userId,
        portfolioId: canonicalBot.portfolioId,
        botId: canonicalBot.id,
        ticker: 'SPY',
        direction: 'buy',
        quantity: 5,
        price: 580,
        origin: 'bot',
        sourceType: 'AI_REPLAY',
        status: 'queued',
        simSession: '2026-11-20',
        clientOrderId: `co_test_${Date.now()}`,
        commission: 0,
        fees: 0,
        pnl: 0
      }
    })

    // 2. Run daily job for 2026-11-20. Even if research was previously recorded, pending fill executes!
    const job = await runAiStrategyDailyJob({
      templateId: 'tmpl_ai_catalyst_momentum',
      session: '2026-11-20',
      providerName: TEST_PROVIDER,
      syncEvidence: false,
      prismaClient: prisma,
      engine: engineClient
    })

    expect(job.ok).toBe(true)
    expect(job.fills.filledExecutions.some(f => f.id === testExecId)).toBe(true)

    const filledExec = await prisma.execution.findUnique({ where: { id: testExecId } })
    expect(filledExec.status).toBe('filled')
    expect(filledExec.filledPrice).toBeGreaterThan(0)
  })

  it('enforces request-level atomic claim mutex under concurrency and prevents duplicate orders', { timeout: 90_000 }, async () => {
    testProviderInstance.callCount = 0

    // Concurrently trigger two identical research requests
    const [c1, c2] = await Promise.all([
      executeAiStrategyCycle({
        botId: canonicalBot.id,
        session: '2026-10-09',
        providerName: TEST_PROVIDER,
        prismaClient: prisma,
        engine: engineClient
      }),
      executeAiStrategyCycle({
        botId: canonicalBot.id,
        session: '2026-10-09',
        providerName: TEST_PROVIDER,
        prismaClient: prisma,
        engine: engineClient
      })
    ])

    expect(c1.ok).toBe(true)
    expect(c2.ok).toBe(true)

    // Critical guarantee: Provider was called strictly ONCE under concurrent execution!
    expect(testProviderInstance.callCount).toBe(1)

    // Order-intent idempotency: Exactly one set of orders created across both concurrent requests
    const totalOrdersCreated = (c1.createdExecutions?.length || 0) + (c2.createdExecutions?.length || 0)
    expect(totalOrdersCreated).toBe(1)

    // One worker won the claim and executed; the other concurrent worker safely skipped with inProgress or cached
    const concurrentSkippedOrCached = [c1, c2].some(c => c.inProgress === true || c.cached === true)
    expect(concurrentSkippedOrCached).toBe(true)

    // Running a subsequent cycle after completion reuses cached response cleanly without calling model
    const c3 = await executeAiStrategyCycle({
      botId: canonicalBot.id,
      session: '2026-10-09',
      providerName: TEST_PROVIDER,
      prismaClient: prisma,
      engine: engineClient
    })

    expect(c3.ok).toBe(true)
    expect(c3.cached).toBe(true)
    expect(c3.avoidedCallsCount).toBe(1)
    expect(testProviderInstance.callCount).toBe(1) // Still strictly 1 model call!

    // Verify claim event exists and symbol evaluation events are strictly 10 (zero duplicate events on cached call)
    const claimEvents = await prisma.botEvent.findMany({
      where: { botId: canonicalBot.id, id: { startsWith: 'req_ai_' } }
    })
    expect(claimEvents.length).toBe(1)

    const evalEvents = await prisma.botEvent.findMany({
      where: { botId: canonicalBot.id, id: { startsWith: 'evt_ai_' } }
    })
    expect(evalEvents.length).toBe(10) // Strictly 1 evaluation event per symbol across repeated calls!
  })

  it('enforces atomic CAS recovery for abandoned claims under concurrency', { timeout: 90_000 }, async () => {
    testProviderInstance.callCount = 0

    // 1. Run cycle to establish request fingerprint
    const initialCycle = await executeAiStrategyCycle({
      botId: canonicalBot.id,
      session: '2026-10-09',
      providerName: TEST_PROVIDER,
      prismaClient: prisma,
      engine: engineClient
    })
    expect(initialCycle.ok).toBe(true)
    expect(testProviderInstance.callCount).toBe(1)

    const claimEvent = await prisma.botEvent.findFirst({
      where: { botId: canonicalBot.id, id: { startsWith: 'req_ai_' } }
    })
    expect(claimEvent).toBeDefined()

    // 2. Simulate worker crash: claim was abandoned in_progress 4 minutes ago with no evaluations
    const staleTime = new Date(Date.now() - 240_000).toISOString()
    await prisma.botEvent.update({
      where: { id: claimEvent.id },
      data: {
        detail: `AI Research Request Claim [2026-10-09]: in_progress (stale)`,
        metadata: {
          ...claimEvent.metadata,
          status: 'in_progress',
          symbolEvaluations: null, // Clear completed evaluations to simulate in-flight crash
          claimedAt: staleTime,
          recoveryAttempts: 0
        }
      }
    })

    testProviderInstance.callCount = 0

    // 3. Two workers simultaneously discover the abandoned claim and attempt recovery
    const [rec1, rec2] = await Promise.all([
      executeAiStrategyCycle({
        botId: canonicalBot.id,
        session: '2026-10-09',
        providerName: TEST_PROVIDER,
        prismaClient: prisma,
        engine: engineClient
      }),
      executeAiStrategyCycle({
        botId: canonicalBot.id,
        session: '2026-10-09',
        providerName: TEST_PROVIDER,
        prismaClient: prisma,
        engine: engineClient
      })
    ])

    expect(rec1.ok).toBe(true)
    expect(rec2.ok).toBe(true)

    // Critical guarantee: Exactly ONE worker won the recovery race and called OpenAI!
    expect(testProviderInstance.callCount).toBe(1)

    // The other worker safely lost the atomic CAS recovery race without calling provider
    const oneWon = [rec1, rec2].some(r => r.cached === false && r.reason === undefined)
    const oneLost = [rec1, rec2].some(r => r.reason === 'concurrent_recovery_lost' || r.inProgress === true || r.cached === true)
    expect(oneWon).toBe(true)
    expect(oneLost).toBe(true)
  })

  it('enforces protective exit chronology (queues for next session, fills at next session close) and prevents duplicate exits', { timeout: 60_000 }, async () => {
    // 1. Create a held open position for NVDA bought on 2026-10-08 at $230.48
    const testBuyId = `exec_held_nvda_${Date.now()}`
    const buyExec = await prisma.execution.create({
      data: {
        id: testBuyId,
        userId: canonicalBot.userId,
        portfolioId: canonicalBot.portfolioId,
        botId: canonicalBot.id,
        ticker: 'NVDA',
        direction: 'buy',
        quantity: 10,
        price: 230.48,
        filledPrice: 230.48,
        filledQuantity: 10,
        brokerOrderId: `simreplay_2026-10-08_${testBuyId}`,
        brokerStatus: 'filled',
        filledAt: new Date('2026-10-08T20:00:00Z'),
        origin: 'bot',
        sourceType: 'AI_REPLAY',
        status: 'filled',
        simSession: '2026-10-08',
        clientOrderId: `co_held_nvda_${Date.now()}`,
        commission: 0,
        fees: 0,
        pnl: 0
      }
    })

    await prisma.executionAudit.create({
      data: {
        id: `aud_buy_${Date.now()}`,
        executionId: buyExec.id,
        userId: canonicalBot.userId,
        workerId: 'test',
        eventType: 'execution_created',
        detail: 'Test buy entry',
        metadata: {
          exitRule: { takeProfitPct: 6, stopLossPct: 4 }
        }
      }
    })

    // 2. On session 2026-10-15 close, NVDA drops to $217.23 (-5.75% drop, <= -4% stop-loss)
    const resDay1 = await processPendingAiExecutions(canonicalBot.id, {
      currentSession: '2026-10-15',
      prismaClient: prisma,
      engine: engineClient
    })

    // Chronology check: signal evaluated from 2026-10-15 close queues order for NEXT session (2026-10-16)
    // It does NOT fill at 2026-10-15 close!
    expect(resDay1.exitExecutions).toBeDefined()
    expect(resDay1.exitExecutions.length).toBe(1)
    const queuedExit = resDay1.exitExecutions[0]
    expect(queuedExit.ticker).toBe('NVDA')
    expect(queuedExit.direction).toBe('sell')
    expect(queuedExit.exitType).toBe('stop_loss')
    expect(queuedExit.status).toBe('queued')
    expect(queuedExit.signalSession).toBe('2026-10-15')
    expect(queuedExit.targetSession).toBe('2026-10-16')
    expect(resDay1.filledExecutions.length).toBe(0) // No look-ahead fill!

    // Verify rule_triggered BotEvent was recorded
    const exitEvent = await prisma.botEvent.findFirst({
      where: { botId: canonicalBot.id, type: 'rule_triggered' }
    })
    expect(exitEvent).toBeDefined()
    expect(exitEvent.metadata.ticker).toBe('NVDA')
    expect(exitEvent.metadata.exitType).toBe('stop_loss')
    expect(exitEvent.metadata.targetSession).toBe('2026-10-16')

    // Duplicate exit prevention: re-running on 2026-10-15 does NOT create another exit order
    const resDay1Dup = await processPendingAiExecutions(canonicalBot.id, {
      currentSession: '2026-10-15',
      prismaClient: prisma,
      engine: engineClient
    })
    expect(resDay1Dup.exitExecutions.length).toBe(0)

    // 3. On next session (2026-10-16), pending queued exit fills at 2026-10-16 close
    const resDay2 = await processPendingAiExecutions(canonicalBot.id, {
      currentSession: '2026-10-16',
      prismaClient: prisma,
      engine: engineClient
    })

    expect(resDay2.filledExecutions.length).toBe(1)
    const filledExit = resDay2.filledExecutions[0]
    expect(filledExit.id).toBe(queuedExit.id)
    expect(filledExit.direction).toBe('sell')
    expect(filledExit.session).toBe('2026-10-16')
    expect(filledExit.fillPrice).toBeGreaterThan(0)
    expect(filledExit.pnl).not.toBe(0)
    expect(filledExit.brokerOrderId).toMatch(/^sim(replay|daily)_/)
  })

  it('rejects stale weekday market data and reports exact data gap (e.g. Tuesday rejecting Friday bar)', async () => {
    // Engine has latest bar from Friday 2026-11-20
    const mockEngineFriday = {
      getDailyBars: async () => ({
        bars: [
          ['2026-11-20', 585, 590, 584, 588, 25000000]
        ]
      })
    }

    // Wall-clock is Tuesday 2026-11-24 at 17:00 ET (22:00 UTC, post-close)
    // Tuesday is a normal exchange trading day, so expected completed session is 2026-11-24.
    const tuesdayPostClose = new Date('2026-11-24T22:00:00Z')

    const job = await runAiStrategyDailyJob({
      templateId: 'tmpl_ai_catalyst_momentum',
      session: null, // autonomous forward scheduling
      now: tuesdayPostClose,
      prismaClient: prisma,
      engine: mockEngineFriday
    })

    expect(job.ok).toBe(true)
    expect(job.skipped).toBe(true)
    expect(job.reason).toBe('stale_market_data')
    expect(job.latestBarDate).toBe('2026-11-20')
    expect(job.expectedSession).toBe('2026-11-24')
  })

  it('detects stale market data and skips research cycle in autonomous mode', async () => {
    const mockEngineStale = {
      getDailyBars: async () => ({
        bars: [
          ['2026-10-01', 570, 575, 568, 572, 1000000] // Stale bar from October 1
        ]
      })
    }

    const job = await runAiStrategyDailyJob({
      templateId: 'tmpl_ai_catalyst_momentum',
      session: null, // forces dynamic discovery
      now: new Date('2026-11-20T22:00:00Z'), // 5:00 PM ET on 2026-11-20 (post close, expected session is 2026-11-20)
      prismaClient: prisma,
      engine: mockEngineStale
    })

    expect(job.ok).toBe(true)
    expect(job.skipped).toBe(true)
    expect(job.reason).toBe('stale_market_data')
    expect(job.latestBarDate).toBe('2026-10-01')
    expect(job.expectedSession).toBe('2026-11-20')
  })
})
