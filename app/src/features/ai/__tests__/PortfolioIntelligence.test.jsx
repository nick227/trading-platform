import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PortfolioIntelligencePanel from '../PortfolioIntelligencePanel'

describe('PortfolioIntelligencePanel', () => {
  it('renders exposure summary, concentration alerts, holding thesis monitor, and risk-verified proposals', () => {
    const sample = {
      status: 'ready',
      asOfSession: '2026-11-25',
      marketRegime: { regime: 'constructive' },
      summary: {
        allocatedCapital: 10000,
        totalEquity: 10120,
        cash: 8680,
        availableCash: 8680,
        reservedBuyCash: 0,
        investedValue: 1440,
        cashWeightPct: 85.8,
        grossExposurePct: 14.2,
        openPositionsCount: 1,
        maxPositionPct: 20,
        maxOrderNotional: 2000
      },
      concentration: {
        hhi: 0.0202,
        diversificationStatus: 'balanced',
        sectorExposure: [{ sector: 'Technology', marketValue: 1440, weightPct: 14.2, symbols: ['NVDA'] }],
        alerts: [{ severity: 'low', code: 'high_cash_reserve', message: '85.8% of paper equity is idle in cash.' }]
      },
      holdings: [
        {
          symbol: 'NVDA',
          name: 'NVIDIA Corp.',
          sector: 'Technology',
          quantity: 10,
          averageCost: 140,
          currentPrice: 144,
          marketValue: 1440,
          weightPct: 14.2,
          unrealizedPnl: 40,
          returnPct: 2.86,
          entryThesis: 'Sustained AI compute backlog.',
          protectiveRules: { stopLossPct: 3.5, takeProfitPct: 7.5, stopPrice: 135.1, takeProfitPrice: 150.5 },
          thesisHealth: { status: 'strengthening', label: 'Thesis strengthening', reason: 'Up +2.86% above 20d/50d averages.' }
        }
      ],
      allocationProposals: [
        {
          type: 'DIVERSIFY_CASH',
          action: 'BUY',
          symbol: 'REGN',
          sector: 'Healthcare',
          quantity: 2,
          estimatedNotional: 1520,
          currentWeightPct: 0,
          targetWeightPct: 15.0,
          riskPolicyVerified: true,
          rationale: 'Deploys idle paper cash into underrepresented Healthcare leader.'
        }
      ]
    }

    render(<PortfolioIntelligencePanel intelligence={sample} />)
    expect(screen.getByTestId('portfolio-intelligence')).toBeInTheDocument()
    expect(screen.getByTestId('holding-intel-NVDA')).toHaveTextContent('Thesis strengthening')
    expect(screen.getByTestId('proposal-REGN')).toHaveTextContent('Deploys idle paper cash')
    expect(screen.getByTestId('portfolio-concentration-alerts')).toHaveTextContent('85.8% of paper equity is idle in cash')
  })
})
