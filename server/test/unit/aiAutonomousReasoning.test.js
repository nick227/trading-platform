import { describe, it, expect, vi } from 'vitest'
import { validateStockTraderDecision, buildStockTraderPrompts } from '../../src/services/ai/strategies/stockTraderDecision.js'
import { runToolGuidedStockResearch } from '../../src/services/ai/stockTraderReasoningAgent.js'
import { VANILLA_AI_STOCK_TRADER_AGENT_DEFINITION } from '../../src/services/ai/botDefinitions.js'
import { createDefaultAiResearchTools } from '../../src/services/ai/researchToolGateway.js'
import { createDefaultStockTraderContextRegistry } from '../../src/services/ai/stockTraderContext.js'
import { loadAiDecisionMemory } from '../../src/services/ai/decisionMemory.js'

describe('MR 21 — Improved Autonomous Reasoning', () => {
  describe('Candidate Coverage & Explicit Abstention', () => {
    const makeSnapshot = (shortlist) => ({
      asOfSession: '2026-11-20',
      context: {
        market: {
          data: {
            shortlist: shortlist.map(s => ({ symbol: s, eligible: true, inUniverse: true }))
          }
        },
        portfolio: {
          data: {
            cash: 10000,
            totalEquity: 10000,
            positions: []
          }
        }
      }
    })

    it('allows model to evaluate a single candidate while omitted candidates cleanly default to HOLD abstention', () => {
      const snapshot = makeSnapshot(['AAPL', 'MSFT', 'NVDA', 'AMZN'])
      const modelOutput = {
        marketSummary: 'Market showing divergent momentum across mega-caps.',
        decisions: [
          {
            symbol: 'NVDA',
            action: 'BUY',
            confidence: 0.82,
            targetAllocationPct: 0.15,
            thesis: 'Strong datacenter compute revenue acceleration',
            evidence: ['Q3 revenue beat consensus', 'Cloud partnerships expanded'],
            risks: ['Semiconductor cyclicality'],
            exitRule: { takeProfitPct: 8.0, stopLossPct: 4.0 }
          }
        ]
      }

      const result = validateStockTraderDecision(modelOutput, snapshot)
      expect(result.decisions).toHaveLength(4)

      const nvda = result.decisions.find(d => d.symbol === 'NVDA')
      expect(nvda.action).toBe('BUY')
      expect(nvda.confidence).toBe(0.82)

      const aapl = result.decisions.find(d => d.symbol === 'AAPL')
      expect(aapl.action).toBe('HOLD')
      expect(aapl.confidence).toBe(0)
      expect(aapl.thesis).toContain('Abstained')

      expect(result.actionable).toHaveLength(1)
      expect(result.actionable[0].symbol).toBe('NVDA')
    })

    it('normalizes explicit ABSTAIN action to HOLD', () => {
      const snapshot = makeSnapshot(['AAPL'])
      const modelOutput = {
        marketSummary: 'Cautious stance.',
        decisions: [
          {
            symbol: 'AAPL',
            action: 'ABSTAIN',
            confidence: 0.4,
            thesis: 'Valuation is stretched relative to hardware growth rate',
            evidence: ['Smartphone upgrade cycle is muted'],
            risks: ['Services margin expansion']
          }
        ]
      }

      const result = validateStockTraderDecision(modelOutput, snapshot)
      expect(result.decisions).toHaveLength(1)
      expect(result.decisions[0].action).toBe('HOLD')
      expect(result.actionable).toHaveLength(0)
    })
  })

  describe('Bounded Multi-Turn Follow-Up Research', () => {
    it('executes follow-up inquiry when initial tool output raises new questions, bounded to maxModelCalls', async () => {
      const snapshot = {
        asOfSession: '2026-11-20',
        context: {
          market: {
            data: {
              shortlist: [
                { symbol: 'NVDA', eligible: true, inUniverse: true, indicators: { price: 140.00 } }
              ]
            }
          },
          portfolio: {
            data: {
              cash: 10000,
              totalEquity: 10000,
              positions: []
            }
          },
          objectives: { data: { objective: 'growth' } },
          risk: { data: { maxPositionPct: 0.2 } }
        },
        evidence: {
          records: [
            { sourceId: 'news', title: 'Earnings beat reported', content: 'Details here' }
          ]
        }
      }

      const calls = []
      const mockInvokeModel = vi.fn(async ({ phase, systemPrompt, userPrompt }) => {
        calls.push(phase)
        if (phase === 'plan') {
          return {
            structured: {
              focus: 'Initial lookup of metrics',
              requests: [{ toolId: 'get_stock_metrics', args: { symbol: 'NVDA' } }]
            }
          }
        }
        if (phase === 'follow_up_evaluation') {
          // Model sees metrics and decides to follow up on historical prices to verify trend
          return {
            structured: {
              action: 'follow_up',
              focus: 'Check 30-day price trend to verify momentum',
              requests: [{ toolId: 'get_historical_prices', args: { symbol: 'NVDA', lookbackDays: 30 } }]
            }
          }
        }
        if (phase === 'decision') {
          return {
            structured: {
              marketSummary: 'Comprehensive multi-turn analysis complete.',
              decisions: [
                {
                  symbol: 'NVDA',
                  action: 'BUY',
                  confidence: 0.88,
                  targetAllocationPct: 0.18,
                  thesis: 'Metrics and price history both confirm breakout',
                  evidence: ['Indicators valid', 'Price trend intact'],
                  risks: ['Market drawdown'],
                  exitRule: { takeProfitPct: 7.0, stopLossPct: 3.5 }
                }
              ]
            }
          }
        }
      })

      const fakeEngine = {
        getDailyBars: async (symbol, start, end) => ({
          bars: [
            ['2026-11-18', 135, 137, 134, 136, 100000],
            ['2026-11-19', 136, 139, 135, 138, 110000],
            ['2026-11-20', 138, 141, 137, 140, 120000]
          ]
        })
      }

      const followUpDefinition = {
        ...VANILLA_AI_STOCK_TRADER_AGENT_DEFINITION,
        maxModelCalls: 3
      }

      const researchResult = await runToolGuidedStockResearch({
        snapshot,
        definition: followUpDefinition,
        invokeModel: mockInvokeModel,
        engine: fakeEngine,
        toolRegistry: createDefaultAiResearchTools()
      })

      expect(calls).toEqual(['plan', 'follow_up_evaluation', 'decision'])
      expect(researchResult.investigation.providerCalls).toBe(3)
      expect(researchResult.investigation.followUpPlan).toBeTruthy()
      expect(researchResult.investigation.results).toHaveLength(2) // Initial + follow-up
      expect(researchResult.investigation.results[1].isFollowUp).toBe(true)
      expect(researchResult.response.structured.decisions[0].action).toBe('BUY')
    })

    it('completes in 2 calls when model decides initial evidence is sufficient', async () => {
      const snapshot = {
        asOfSession: '2026-11-20',
        context: {
          market: {
            data: {
              shortlist: [
                { symbol: 'AAPL', eligible: true, inUniverse: true, indicators: { price: 150.00 } }
              ]
            }
          },
          portfolio: {
            data: { cash: 10000, totalEquity: 10000, positions: [] }
          },
          objectives: { data: { objective: 'growth' } },
          risk: { data: { maxPositionPct: 0.2 } }
        }
      }

      const calls = []
      const mockInvokeModel = vi.fn(async ({ phase }) => {
        calls.push(phase)
        if (phase === 'plan') {
          return {
            structured: {
              focus: 'Check portfolio state',
              requests: [{ toolId: 'get_portfolio_state', args: {} }]
            }
          }
        }
        if (phase === 'follow_up_evaluation') {
          // Model is satisfied and provides decision directly in turn 2
          return {
            structured: {
              action: 'decision',
              marketSummary: 'Sufficient cash, holding current stance.',
              decisions: [
                {
                  symbol: 'AAPL',
                  action: 'HOLD',
                  confidence: 0.5,
                  thesis: 'No compelling catalyst to buy at current valuation',
                  evidence: ['Cash is fully deployed or adequate'],
                  risks: ['Opportunity cost']
                }
              ]
            }
          }
        }
      })

      const researchResult = await runToolGuidedStockResearch({
        snapshot,
        definition: { ...VANILLA_AI_STOCK_TRADER_AGENT_DEFINITION, maxModelCalls: 3 },
        invokeModel: mockInvokeModel,
        toolRegistry: createDefaultAiResearchTools()
      })

      expect(calls).toEqual(['plan', 'follow_up_evaluation'])
      expect(researchResult.investigation.providerCalls).toBe(2)
      expect(researchResult.response.structured.decisions[0].action).toBe('HOLD')
    })
  })

  describe('Decision Memory Thesis Alignment', () => {
    it('computes factual thesisAlignment without fabricating causal explanations', async () => {
      const mockPrisma = {
        botEvent: {
          findMany: vi.fn(async () => [
            {
              id: 'event_old_1',
              botId: 'bot_test',
              type: 'decision_made',
              metadata: {
                status: 'completed',
                decision: {
                  asOfSession: '2026-11-10',
                  marketSummary: 'Prior summary',
                  decisions: [
                    { symbol: 'AAPL', action: 'BUY', thesis: 'Expected breakout', evidence: ['Bullish setup'] },
                    { symbol: 'NVDA', action: 'SELL', thesis: 'Profit taking', evidence: ['Stretched mark'] }
                  ]
                }
              }
            }
          ])
        }
      }

      const fakeEngine = {
        getSessionClose: vi.fn(async (symbol, session) => {
          if (symbol === 'AAPL') {
            return { symbol, session, close: session === '2026-11-10' ? 100 : 110 } // +10% (favorable for BUY)
          }
          if (symbol === 'NVDA') {
            return { symbol, session, close: session === '2026-11-10' ? 200 : 180 } // -10% (favorable for SELL)
          }
        })
      }

      const memory = await loadAiDecisionMemory({
        bot: { id: 'bot_test' },
        asOfSession: '2026-11-20',
        prismaClient: mockPrisma,
        engine: fakeEngine
      })

      expect(memory.history).toHaveLength(1)
      const decisions = memory.history[0].decisions
      expect(decisions).toHaveLength(2)

      const aaplDecision = decisions.find(d => d.symbol === 'AAPL')
      expect(aaplDecision.observedPriceChangePct).toBe(10)
      expect(aaplDecision.thesisAlignment).toBe('favorable_price_movement')

      const nvdaDecision = decisions.find(d => d.symbol === 'NVDA')
      expect(nvdaDecision.observedPriceChangePct).toBe(-10)
      expect(nvdaDecision.thesisAlignment).toBe('favorable_price_movement')
    })
  })

  describe('Multi-Agent Research Mandate Support', () => {
    it('cleanly collects optional mandate context and renders it into agent prompts', async () => {
      const contextRegistry = createDefaultStockTraderContextRegistry()
      const snapshot = await contextRegistry.assemble({
        session: '2026-11-20',
        input: {
          screening: { asOfSession: '2026-11-20', shortlist: [{ symbol: 'NVDA' }] },
          portfolio: { asOfSession: '2026-11-20', cash: 10000, positions: [] },
          config: {
            strategyVersion: '2.0.0',
            objective: 'balanced_growth',
            execution: { maxPositionPct: 0.2 }
          },
          mandate: {
            id: 'mandate_ai_infra_v1',
            version: 1,
            objective: 'Identify AI datacenter winners with strong free cash flow.',
            hypotheses: [
              'Custom silicon demand accelerates faster than merchant silicon',
              'Power infrastructure limits short-term deployment'
            ],
            preferences: { maxValuationPe: 45 }
          }
        },
        modules: ['market', 'portfolio', 'objectives', 'risk', 'mandate']
      })

      expect(snapshot.context.mandate).toBeTruthy()
      expect(snapshot.context.mandate.data.objective).toContain('AI datacenter winners')
      expect(snapshot.context.mandate.data.hypotheses).toHaveLength(2)

      const prompts = buildStockTraderPrompts(snapshot, VANILLA_AI_STOCK_TRADER_AGENT_DEFINITION)
      expect(prompts.systemPrompt).toContain('User Research Mandate:')
      expect(prompts.systemPrompt).toContain('Identify AI datacenter winners')
      expect(prompts.systemPrompt).toContain('Custom silicon demand accelerates')
    })
  })
})
