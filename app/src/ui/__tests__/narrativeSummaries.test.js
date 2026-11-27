import { describe, expect, it } from 'vitest'
import {
  buildBotsNarrativeSummary,
  buildFlagshipNarrativeSummary,
  buildLeaderboardNarrativeSummary,
  buildPerformanceIntelNarrative,
  buildPortfolioIntelNarrative,
  buildPortfolioNarrativeSummary,
  buildSinceLastCheckedBriefing,
  buildStocksNarrativeSummary
} from '../narrativeSummaries'

describe('deterministic narrative summaries (zero LLM calls)', () => {
  it('summarizes portfolio performance and attention state without inventing $0 for disconnected accounts', () => {
    expect(buildPortfolioNarrativeSummary({ valuation: { source: 'none', equity: null } })).toBeNull()

    const allCash = buildPortfolioNarrativeSummary({
      valuation: { source: 'simulated_paper', simulated: true, equity: 10000, cash: 10000, fillCount: 0, positions: [] },
      bots: [],
      actionableProposalsCount: 0
    })
    expect(allCash).toContain('$10,000.00 in uninvested cash')
    expect(allCash).toContain('Nothing needs urgent action')

    const activeWithProposal = buildPortfolioNarrativeSummary({
      valuation: {
        source: 'simulated_paper',
        simulated: true,
        startingCash: 10000,
        equity: 10250,
        cash: 8500,
        totalPnl: 250,
        totalPnlPct: 2.5,
        fillCount: 2,
        positions: [{ symbol: 'NVDA' }]
      },
      bots: [{ id: 'b1', running: true, status: 'running' }],
      actionableProposalsCount: 1
    })
    expect(activeWithProposal).toContain('up +$250.00 (+2.50%)')
    expect(activeWithProposal).toContain('1 simulated trade proposal needs your review')
  })

  it('summarizes Stocks, Strategies leaderboard, My Bots, and Flagship AI deterministically', () => {
    const stocksText = buildStocksNarrativeSummary({
      eligibleCompaniesCount: 42,
      sectorsCount: 10,
      benchmark: { return20dPct: 2.4, regime: 'constructive' },
      sectors: [{ sector: 'Healthcare', breadthPct: 87.5, leaderSymbol: 'LLY' }],
      discoveries: [{ symbol: 'LLY', themeLabel: 'Volume Accumulation' }]
    })
    expect(stocksText).toContain('Healthcare leads with 87.5% positive 20-day breadth (led by LLY)')
    expect(stocksText).toContain('Top-ranked candidate is LLY')

    const boardText = buildLeaderboardNarrativeSummary({
      summary: { totalStrategies: 3, pendingOrForwardOnlyCount: 1 },
      entries: [
        { rank: 1, name: 'Momentum Buy', categoryLabel: 'Rule-Based', returnPct: 16.0, maxDrawdownPct: 8.0, horizon: 'Historical 5Y' }
      ]
    })
    expect(boardText).toContain('Momentum Buy (Rule-Based) leads on risk-adjusted return at +16.00%')
    expect(boardText).toContain('1 forward paper strategy is still building sample size')

    expect(
      buildBotsNarrativeSummary([
        { id: 'b1', running: true, status: 'running' },
        { id: 'b2', running: false, status: 'paused' }
      ])
    ).toContain('2 configured bots (1 running, 1 paused)')

    expect(
      buildFlagshipNarrativeSummary({
        status: 'enabled',
        capitalAllocated: 10000,
        performance: { totalPnl: 120 },
        positions: [{ symbol: 'NVDA' }],
        research: [{ asOfSession: '2026-11-25' }]
      })
    ).toContain('+$120.00 total P&L across 1 open position')

    expect(
      buildPortfolioIntelNarrative({
        status: 'ready',
        summary: { grossExposurePct: 14.2, investedValue: 1440, openPositionsCount: 1, availableCash: 8680 },
        allocationProposals: []
      })
    ).toContain('no rebalance adjustments are needed right now')

    expect(
      buildPerformanceIntelNarrative({
        status: 'ready',
        comparison: { modelCostUsd: 0.0825, aiNetReturnPct: 3.44, excessVsSpyPctPoints: 2.24, excessVsDeterministicPctPoints: 1.34 }
      })
    ).toContain('ahead of SPY buy-and-hold')

    expect(
      buildSinceLastCheckedBriefing(
        { source: 'simulated_paper', equity: 10060, fillCount: 1 },
        { equity: 10000, fillCount: 0 }
      )
    ).toBe('Portfolio value moved +$60.00 since your last visit with 1 new simulated fill recorded.')
  })
})
