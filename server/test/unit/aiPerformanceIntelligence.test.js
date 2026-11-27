import { describe, it, expect, vi } from 'vitest'
import {
  evaluateAiPerformanceIntelligence,
  synthesizeStrengthsAndWeaknesses
} from '../../src/services/ai/aiPerformanceIntelligenceService.js'

function makeChronologicalBars(endSession, { base = 100, step = 0.5 } = {}) {
  const dates = []
  let curr = new Date(endSession + 'T00:00:00Z')
  while (dates.length < 70) {
    const day = curr.getUTCDay()
    if (day !== 0 && day !== 6) dates.push(curr.toISOString().slice(0, 10))
    curr = new Date(curr.getTime() - 86_400_000)
  }
  dates.reverse()
  return dates.map((d, idx) => {
    const close = Number((base + idx * step).toFixed(2))
    const open = Number((close - 0.2).toFixed(2))
    return [d, open, Number((close + 1).toFixed(2)), Number((open - 0.8).toFixed(2)), close, 1_800_000]
  })
}

describe('AI Performance Intelligence Service', () => {
  it('returns awaiting_activity cleanly when no fills or research cycles exist', async () => {
    const mockPrisma = {
      bot: { findUnique: vi.fn(async () => ({ id: 'bot_1', userId: 'u_1', config: { allocatedAmount: 10000 } })) },
      botEvent: { findMany: vi.fn(async () => []) },
      aiUsageCall: { findMany: vi.fn(async () => []) },
      executionAudit: { findMany: vi.fn(async () => []) }
    }
    const mockEngine = {
      getDailyBars: vi.fn(async () => ({ bars: makeChronologicalBars('2026-11-25') }))
    }

    const res = await evaluateAiPerformanceIntelligence({
      botId: 'bot_1',
      prismaClient: mockPrisma,
      engine: mockEngine,
      fillLoader: async () => [],
      session: '2026-11-25'
    })

    expect(res.status).toBe('awaiting_activity')
    expect(res.comparison.aiNetReturnPct).toBeNull()
    expect(res.diagnostics.weaknesses[0]).toMatch(/No completed forward paper trades/)
  })

  it('attributes contributors, evaluates hypotheses & abstentions, compares benchmarks, and deducts LLM costs', async () => {
    const spyBars = makeChronologicalBars('2026-11-25', { base: 480, step: 0.2 })
    const nvdaBars = makeChronologicalBars('2026-11-25', { base: 110, step: 0.9 })
    const xomBars = makeChronologicalBars('2026-11-25', { base: 130, step: -0.4 })
    const firstDecisionDate = spyBars[55][0]

    const fills = [
      {
        id: 'fill_buy_nvda',
        ticker: 'NVDA',
        direction: 'buy',
        status: 'filled',
        filledQuantity: 12,
        filledPrice: 150,
        fees: 0,
        commission: 0,
        simSession: firstDecisionDate,
        filledAt: new Date(firstDecisionDate + 'T14:50:00Z')
      }
    ]

    const mockPrisma = {
      bot: {
        findUnique: vi.fn(async () => ({
          id: 'bot_platform_ai_stock_trader_v1',
          userId: 'usr_platform_canonical',
          config: { allocatedAmount: 10000, universe: { symbols: ['SPY', 'NVDA', 'XOM'] } }
        }))
      },
      botEvent: {
        findMany: vi.fn(async ({ where }) => {
          if (where.type === 'rule_triggered') {
            return [{ id: 'ev_tp_1', metadata: { exitType: 'take_profit' } }]
          }
          return [
            {
              id: 'req_stock_1',
              metadata: {
                status: 'completed',
                investigation: { toolTrace: [{ toolId: 'get_research_evidence' }] },
                decision: {
                  asOfSession: firstDecisionDate,
                  decisions: [
                    { symbol: 'NVDA', action: 'BUY', confidence: 0.88, thesis: 'Strong 10-Q backlog acceleration' },
                    { symbol: 'XOM', action: 'HOLD', confidence: 0.45, thesis: 'Refining margin headwinds; abstain' }
                  ]
                }
              }
            }
          ]
        })
      },
      aiUsageCall: {
        findMany: vi.fn(async () => [
          { id: 'c1', jobKey: 'research:plan', actualCents: 2, status: 'completed' },
          { id: 'c2', jobKey: 'research:decide', actualCents: 3, status: 'completed' },
          { id: 'c_smoke', jobKey: 'flagship_beta_provider_smoke:1', actualCents: 1, status: 'completed' }
        ])
      },
      executionAudit: {
        findMany: vi.fn(async () => [{
          executionId: 'fill_buy_nvda',
          eventType: 'execution_created',
          metadata: { thesis: 'Strong 10-Q backlog acceleration' }
        }])
      }
    }

    const mockEngine = {
      getDailyBars: vi.fn(async (sym) => {
        if (sym === 'SPY') return { bars: spyBars }
        if (sym === 'NVDA') return { bars: nvdaBars }
        if (sym === 'XOM') return { bars: xomBars }
        return { bars: [] }
      })
    }

    const res = await evaluateAiPerformanceIntelligence({
      prismaClient: mockPrisma,
      engine: mockEngine,
      fillLoader: async () => fills,
      session: '2026-11-25'
    })

    expect(res.status).toBe('ready')
    expect(res.comparison.modelCostUsd).toBe(0.05) // 2 + 3 cents = $0.05 (smoke call excluded)
    expect(res.comparison.totalPnl).toBeGreaterThan(0)
    expect(res.comparison.spyReturnPct).not.toBeNull()
    expect(res.decisionQuality.qualitativeBackedCyclesCount).toBe(1)
    expect(res.decisionQuality.thesisHitRatePct).toBe(100)
    expect(res.decisionQuality.selectivity.avoidedDrawdownCount).toBe(1) // XOM fell after HOLD
    expect(res.decisionQuality.protectiveExits.takeProfitCount).toBe(1)
    expect(res.attribution.topContributors[0].symbol).toBe('NVDA')
    expect(res.statisticalConfidence.meetsThreshold).toBe(false)
    expect(res.statisticalConfidence.note).toMatch(/Descriptive sample/)
  })

  it('synthesizes strengths and weaknesses honestly based on benchmark & selectivity metrics', () => {
    const diag = synthesizeStrengthsAndWeaknesses({
      hasActivity: true,
      netReturnPct: 4.8,
      spyReturnPct: 2.1,
      deterministicReturnPct: 3.0,
      winRatePct: 62.5,
      thesisHitRatePct: 66.7,
      avoidedDrawdownCount: 3,
      missedUpsideCount: 1,
      stopLossCount: 0,
      takeProfitCount: 2,
      modelCostUsd: 0.12,
      allocatedCapital: 10000,
      meetsStatisticalSample: false
    })

    expect(diag.strengths.some(s => s.includes('Outperformed passive SPY'))).toBe(true)
    expect(diag.strengths.some(s => s.includes('incremental return over the pure deterministic'))).toBe(true)
    expect(diag.weaknesses.some(w => w.includes('Sample size is below 60 sessions'))).toBe(true)
  })
})
