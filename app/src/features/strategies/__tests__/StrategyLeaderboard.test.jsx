import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import StrategyLeaderboard from '../StrategyLeaderboard'
import { get } from '../../../api/client'

vi.mock('../../../api/client', () => ({ get: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

const sampleBoard = {
  track: 'overview',
  sortBy: 'risk_adjusted',
  category: 'all',
  tracks: [
    { id: 'overview', label: 'All horizons', description: 'Primary verified horizon per strategy.' },
    { id: 'forward', label: 'Forward paper', description: 'Strictly post-publication forward paper sessions.' }
  ],
  summary: { totalStrategies: 3, evaluatedCount: 2, pendingOrForwardOnlyCount: 1 },
  methodologyNote: 'Risk-adjusted score = Return % ÷ Max Drawdown %.',
  entries: [
    {
      id: 'rp:strat_1',
      rank: 1,
      name: 'Research Partner · Semiconductor Breakout (v2)',
      category: 'research_partner',
      categoryLabel: 'Research Partner',
      href: '/research-partners',
      horizon: 'Forward Paper (25d)',
      returnPct: 8.4,
      excessVsBenchmarkPct: 5.4,
      maxDrawdownPct: 2.0,
      riskAdjustedScore: 4.2,
      statusNote: 'Forward paper run since 2026-10-15.',
      sampleSize: { label: 'Developing sample', tradesCount: 4, sessionsCount: 25 }
    },
    {
      id: 'platform:tmpl_momentum_buy',
      rank: 2,
      name: 'Momentum Buy',
      category: 'rule_based',
      categoryLabel: 'Rule-Based',
      href: '/strategies/tmpl_momentum_buy',
      horizon: 'Historical 5Y',
      returnPct: 16.0,
      excessVsBenchmarkPct: 2.5,
      maxDrawdownPct: 8.0,
      riskAdjustedScore: 2.0,
      statusNote: 'Median across 10 standardized symbol tests.',
      sampleSize: { label: 'Substantive sample', tradesCount: 48, sessionsCount: 1260, symbolsTested: 10 }
    },
    {
      id: 'flagship:bot_platform_ai_stock_trader_v1',
      rank: null,
      name: 'Flagship AI Stock Trader v2',
      category: 'flagship_ai',
      categoryLabel: 'Flagship AI',
      href: '/ai-stock-trader',
      horizon: 'Forward Paper',
      returnPct: null,
      excessVsBenchmarkPct: null,
      maxDrawdownPct: null,
      riskAdjustedScore: null,
      statusNote: 'Initialized in paper mode; awaiting live scheduled forward fills.',
      sampleSize: { label: 'Awaiting trades', tradesCount: 0, sessionsCount: 0 }
    }
  ]
}

describe('StrategyLeaderboard UI', () => {
  it('renders ranked rule-based, Research Partner, and Flagship AI rows and switches tracks', async () => {
    get.mockResolvedValue(sampleBoard)
    render(<StrategyLeaderboard />)

    expect(await screen.findByTestId('cross-strategy-leaderboard')).toBeInTheDocument()
    expect(screen.getByTestId('leaderboard-evaluated-count')).toHaveTextContent('2 ranked · 3 total')
    expect(screen.getByTestId('leaderboard-row-rp:strat_1')).toHaveTextContent('#1')
    expect(screen.getByTestId('leaderboard-row-rp:strat_1')).toHaveTextContent('4.20x')
    expect(screen.getByTestId('leaderboard-row-platform:tmpl_momentum_buy')).toHaveTextContent('#2')
    expect(screen.getByTestId('leaderboard-row-flagship:bot_platform_ai_stock_trader_v1')).toHaveTextContent('Awaiting trades')

    // Switch to Forward Paper track
    fireEvent.click(screen.getByTestId('leaderboard-track-forward'))
    expect(get).toHaveBeenLastCalledWith('/public/strategies/leaderboard?track=forward&category=all&sortBy=risk_adjusted')
  })
})
