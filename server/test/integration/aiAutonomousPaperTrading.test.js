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
  }

  async completeStructured({ systemPrompt, userPrompt, temperature = 0.2 }) {
    // Determine session from userPrompt
    const isOct7 = userPrompt.includes('2026-10-07')
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

describe('Autonomous AI Paper Trading & Accounting Lifecycle', () => {
  let canonicalBot
  const TEST_PROVIDER = 'test_scenario_provider'

  beforeEach(async () => {
    registerCustomProvider(TEST_PROVIDER, new ScenarioLlmProvider())
    const res = await getOrCreateCanonicalAiBot({ prismaClient: prisma })
    canonicalBot = res.bot

    // Clean up test executions and events for this bot
    await prisma.executionAudit.deleteMany({
      where: { execution: { botId: canonicalBot.id } }
    })
    await prisma.execution.deleteMany({ where: { botId: canonicalBot.id } })
    await prisma.botEvent.deleteMany({ where: { botId: canonicalBot.id } })
    await prisma.strategyEvidence.deleteMany({ where: { templateId: 'tmpl_ai_catalyst_momentum' } })
  })

  afterEach(async () => {
    await prisma.executionAudit.deleteMany({
      where: { execution: { botId: canonicalBot.id } }
    })
    await prisma.execution.deleteMany({ where: { botId: canonicalBot.id } })
    await prisma.botEvent.deleteMany({ where: { botId: canonicalBot.id } })
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

    // Verify position is now open
    const midEquity = await computeAiBotForwardEquity(canonicalBot.id, {
      asOfSession: '2026-10-08',
      prismaClient: prisma,
      engine: engineClient
    })
    expect(midEquity.trades).toBe(1)
    expect(midEquity.cash).toBeLessThan(10_000)

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
    expect(filledSell.pnl).not.toBe(0) // Realized FIFO loss recorded cleanly

    // -------------------------------------------------------------------------
    // Phase 5: Forward Portfolio Accounting & Public Strategy Evidence Record
    // -------------------------------------------------------------------------
    const finalEquity = await computeAiBotForwardEquity(canonicalBot.id, {
      asOfSession: '2026-10-15',
      prismaClient: prisma,
      engine: engineClient
    })

    expect(finalEquity.status).toBe('ok')
    expect(finalEquity.trades).toBe(2)
    expect(finalEquity.closedTradesCount).toBe(1)
    expect(finalEquity.realizedPnl).toBeLessThan(0) // Sold at $217.23 vs buy at $230.48
    expect(finalEquity.curve.length).toBeGreaterThanOrEqual(5)
    expect(finalEquity.buyAndHold.curve.length).toBeGreaterThanOrEqual(5)

    // Sync strategy evidence and confirm the Forward window is populated
    await generateStrategyEvidence({ prismaClient: prisma, engine: engineClient })
    const strats = await listPublicStrategies({ prismaClient: prisma })
    const aiStrat = strats.find(s => s.templateId === 'tmpl_ai_catalyst_momentum')

    expect(aiStrat).toBeDefined()
    // The forward window is populated with verified paper trading
    expect(aiStrat.windows.forward).toBeDefined()
    expect(aiStrat.windows.forward.status).toBe('ok')
    expect(aiStrat.windows.forward.symbolsTested).toBe(10)
    expect(aiStrat.windows.forward.trades).toBe(20)
  })

  it('enforces recurring autonomous scheduler idempotency', { timeout: 60_000 }, async () => {
    // 1st run of the daily job on session 2026-11-20
    const job1 = await runAiStrategyDailyJob({
      templateId: 'tmpl_ai_catalyst_momentum',
      session: '2026-11-20',
      providerName: TEST_PROVIDER,
      prismaClient: prisma,
      engine: engineClient
    })

    expect(job1.ok).toBe(true)
    expect(job1.skipped).toBeUndefined()

    // 2nd run on the same session should be idempotently skipped
    const job2 = await runAiStrategyDailyJob({
      templateId: 'tmpl_ai_catalyst_momentum',
      session: '2026-11-20',
      providerName: TEST_PROVIDER,
      prismaClient: prisma,
      engine: engineClient
    })

    expect(job2.ok).toBe(true)
    expect(job2.skipped).toBe(true)
    expect(job2.reason).toBe('already_executed_for_session')
  }, 30_000)
})
