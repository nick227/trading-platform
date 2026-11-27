import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PerformanceIntelligencePanel from '../PerformanceIntelligencePanel'

describe('PerformanceIntelligencePanel', () => {
  it('renders benchmark comparison, contributor attribution, hypothesis ledger, and statistical caveats', () => {
    const sample = {
      status: 'ready',
      window: { firstSession: '2026-11-10', latestSession: '2026-11-25', activeSessionsCount: 11 },
      comparison: {
        allocatedCapital: 10000,
        aiGrossReturnPct: 3.45,
        aiNetReturnPct: 3.44,
        totalPnl: 345,
        modelCostUsd: 0.0825,
        spyReturnPct: 1.2,
        deterministicScreenerReturnPct: 2.1,
        excessVsSpyPctPoints: 2.24,
        excessVsDeterministicPctPoints: 1.34
      },
      decisionQuality: {
        completedCyclesCount: 6,
        qualitativeBackedCyclesCount: 5,
        filledExecutionsCount: 4,
        closedTradesCount: 2,
        winRatePct: 100,
        thesisHitRatePct: 75.0,
        selectivity: { avoidedDrawdownCount: 3, missedUpsideCount: 1 },
        protectiveExits: { stopLossCount: 0, takeProfitCount: 2 }
      },
      attribution: {
        topContributors: [
          { symbol: 'NVDA', sector: 'Technology', totalPnl: 345, contributionPctPoints: 3.45, thesis: '10-Q compute backlog' }
        ],
        topDetractors: [],
        recentHypotheses: [
          { symbol: 'NVDA', action: 'BUY', asOfSession: '2026-11-12', confidence: 0.86, forwardMovePct: 8.2, outcome: 'held_up', thesis: '10-Q compute backlog' }
        ]
      },
      diagnostics: {
        strengths: ['Outperformed passive SPY benchmark by +2.24% net of model API expenses.'],
        weaknesses: ['Sample size is below 60 sessions / 10 closed trades.']
      },
      statisticalConfidence: {
        meetsThreshold: false,
        activeSessionsCount: 11,
        closedTradesCount: 2,
        note: 'Descriptive sample (11/60 sessions, 2/10 closed trades).'
      }
    }

    render(<PerformanceIntelligencePanel intelligence={sample} />)
    expect(screen.getByTestId('ai-performance-intelligence')).toBeInTheDocument()
    expect(screen.getByTestId('perf-benchmark-comparison')).toHaveTextContent('+3.44%')
    expect(screen.getByTestId('perf-benchmark-comparison')).toHaveTextContent('+2.24%')
    expect(screen.getByTestId('perf-position-attribution')).toHaveTextContent('NVDA')
    expect(screen.getByTestId('perf-statistical-note')).toHaveTextContent('Descriptive sample (11/60 sessions')
  })

  it('shows honest awaiting state when no forward trades have occurred yet', () => {
    render(
      <PerformanceIntelligencePanel
        intelligence={{
          status: 'awaiting_activity',
          diagnostics: { strengths: [], weaknesses: ['No completed forward paper trades have been recorded yet.'] },
          statisticalConfidence: { meetsThreshold: false, activeSessionsCount: 0, closedTradesCount: 0, note: 'Descriptive sample (0/60 sessions).' }
        }}
      />
    )
    expect(screen.getByTestId('perf-intel-awaiting')).toHaveTextContent('Awaiting multi-session forward activity')
  })
})
