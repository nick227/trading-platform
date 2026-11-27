import { describe, it, expect, vi } from 'vitest'
import {
  buildCrossStrategyLeaderboard,
  computeRiskAdjustedScore,
  classifySampleSize,
  rankLeaderboardEntries
} from '../../src/services/strategyLeaderboardService.js'

describe('Cross-Strategy Leaderboard Service', () => {
  it('computes risk-adjusted return-to-drawdown score with 0.5% floor and classifies sample tiers', () => {
    expect(computeRiskAdjustedScore(12.0, 4.0, 15)).toBe(3.0)
    expect(computeRiskAdjustedScore(5.0, 0.1, 4)).toBe(10.0) // 0.5% floor prevents division explosion
    expect(computeRiskAdjustedScore(8.0, 3.0, 0)).toBeNull() // 0 trades cannot have a risk-adjusted score

    expect(classifySampleSize({ sessionsCount: 80, tradesCount: 14 }).tier).toBe('substantive')
    expect(classifySampleSize({ sessionsCount: 22, tradesCount: 5 }).tier).toBe('developing')
    expect(classifySampleSize({ sessionsCount: 4, tradesCount: 1 }).tier).toBe('early')
    expect(classifySampleSize({ sessionsCount: 20, tradesCount: 0 }).tier).toBe('awaiting')
  })

  it('ranks evaluated rule-based, Research Partner forward, and Flagship AI strategies side-by-side while leaving pending strategies unranked', async () => {
    const publicStrategiesLoader = vi.fn(async () => [
      {
        templateId: 'tmpl_trend_follow',
        name: 'Trend Following',
        tags: ['trend'],
        version: { backtestable: true },
        windows: {
          '5Y': {
            status: 'ok',
            symbolsTested: 10,
            symbolsTraded: 8,
            medianReturnPct: 24.0,
            medianBuyAndHoldPct: 18.0,
            beatBuyAndHold: 7,
            medianDrawdownPct: 8.0,
            worstDrawdownPct: 12.5,
            trades: 42
          },
          forward: { status: 'awaiting_sessions', symbolsTested: 0 }
        }
      },
      {
        templateId: 'tmpl_idle_guard',
        name: 'Idle Guard',
        tags: ['guard'],
        version: { backtestable: true },
        windows: {
          '5Y': {
            status: 'ok',
            symbolsTested: 10,
            symbolsTraded: 0,
            medianReturnPct: 0,
            medianBuyAndHoldPct: 18.0,
            beatBuyAndHold: 0,
            medianDrawdownPct: 0,
            worstDrawdownPct: 0,
            trades: 0
          }
        }
      }
    ])

    const perfEvaluator = vi.fn(async () => ({
      status: 'ready',
      window: { firstSession: '2026-10-01', latestSession: '2026-11-25', activeSessionsCount: 38 },
      comparison: {
        allocatedCapital: 10000,
        aiGrossReturnPct: 9.2,
        aiNetReturnPct: 9.15,
        modelCostUsd: 0.05,
        spyReturnPct: 4.0,
        excessVsSpyPctPoints: 5.15
      },
      decisionQuality: {
        completedCyclesCount: 18,
        filledExecutionsCount: 6,
        winRatePct: 75.0
      }
    }))

    const fillLoader = vi.fn(async () => [
      { ticker: 'NVDA', direction: 'buy', filledQuantity: 10, filledPrice: 140, fees: 0 },
      { ticker: 'NVDA', direction: 'sell', filledQuantity: 10, filledPrice: 136, fees: 0 },
      { ticker: 'AAPL', direction: 'buy', filledQuantity: 12, filledPrice: 200, fees: 0 },
      { ticker: 'AAPL', direction: 'sell', filledQuantity: 12, filledPrice: 280, fees: 0 }
    ])

    const prismaClient = {
      researchPaperActivation: {
        findMany: vi.fn(async () => [
          {
            strategyId: 'rp_strat_1',
            version: 2,
            status: 'active',
            initialSession: '2026-10-15',
            lastSession: '2026-11-25',
            strategy: { name: 'Semiconductor Breakout' },
            state: {
              initialCapital: 10000,
              maxDrawdownPct: 2.0,
              equityCurve: Array.from({ length: 25 }, (_, i) => ({ session: `2026-11-${String(i + 1).padStart(2, '0')}`, equity: 10000 + i * 35 })),
              fills: [
                { id: 'f1', ticker: 'NVDA', direction: 'buy', filledQuantity: 10, filledPrice: 130, status: 'filled' },
                { id: 'f2', ticker: 'NVDA', direction: 'sell', filledQuantity: 10, filledPrice: 142, status: 'filled' },
                { id: 'f3', ticker: 'AAPL', direction: 'buy', filledQuantity: 8, filledPrice: 220, status: 'filled' }
              ]
            }
          }
        ])
      }
    }

    const engine = {
      getDailyBars: vi.fn(async () => ({
        bars: [
          ['2026-10-15', 500, 502, 499, 500, 1_000_000],
          ['2026-11-25', 514, 516, 512, 515, 1_000_000]
        ]
      }))
    }

    const board = await buildCrossStrategyLeaderboard({
      track: 'overview',
      sortBy: 'risk_adjusted',
      prismaClient,
      engine,
      publicStrategiesLoader,
      perfEvaluator,
      fillLoader
    })

    expect(board.summary.totalStrategies).toBe(4)
    expect(board.summary.evaluatedCount).toBe(3)
    expect(board.summary.pendingOrForwardOnlyCount).toBe(1)

    // Top 3 have ranks 1, 2, 3; untraded Idle Guard has rank: null at the bottom
    expect(board.entries.slice(0, 3).map(e => e.rank)).toEqual([1, 2, 3])
    expect(board.entries[3].id).toBe('platform:tmpl_idle_guard')
    expect(board.entries[3].rank).toBeNull()

    const rpRow = board.entries.find(e => e.id === 'rp:rp_strat_1')
    expect(rpRow.category).toBe('research_partner')
    expect(rpRow.returnPct).toBe(8.4)
    expect(rpRow.benchmarkReturnPct).toBe(3.0)
    expect(rpRow.excessVsBenchmarkPct).toBe(5.4)
    expect(rpRow.sampleSize.tier).toBe('developing')

    // On 5Y historical track, Flagship AI and Research Partner are marked Forward-Only (rank: null)
    const historicalBoard = await buildCrossStrategyLeaderboard({
      track: '5Y',
      prismaClient,
      engine,
      publicStrategiesLoader,
      perfEvaluator,
      fillLoader
    })
    const flagshipOn5Y = historicalBoard.entries.find(e => e.category === 'flagship_ai')
    expect(flagshipOn5Y.evaluationStatus).toBe('forward_only')
    expect(flagshipOn5Y.rank).toBeNull()
  })

  it('supports sorting by lowest drawdown and total return', () => {
    const rows = [
      { id: 'a', evaluationStatus: 'evaluated', returnPct: 18, maxDrawdownPct: 12, riskAdjustedScore: 1.5, sampleSize: { tradesCount: 10 } },
      { id: 'b', evaluationStatus: 'evaluated', returnPct: 10, maxDrawdownPct: 2.5, riskAdjustedScore: 4.0, sampleSize: { tradesCount: 8 } }
    ]
    expect(rankLeaderboardEntries(rows, 'risk_adjusted').map(r => r.id)).toEqual(['b', 'a'])
    expect(rankLeaderboardEntries(rows, 'total_return').map(r => r.id)).toEqual(['a', 'b'])
    expect(rankLeaderboardEntries(rows, 'lowest_drawdown').map(r => r.id)).toEqual(['b', 'a'])
  })
})
