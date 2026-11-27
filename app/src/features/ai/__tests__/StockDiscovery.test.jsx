import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import StockDiscoveryPanel from '../StockDiscoveryPanel'
import StockDiscoveryPage from '../StockDiscoveryPage'
import { get } from '../../../api/client'

vi.mock('../../../api/client', () => ({ get: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

const sampleDiscovery = {
  asOfSession: '2026-11-25',
  universeScanned: 135,
  eligibleCompaniesCount: 42,
  beyondWatchlistCount: 34,
  sectorsCount: 10,
  benchmark: { symbol: 'SPY', regime: 'constructive', return20dPct: 2.4 },
  sectors: [
    { sector: 'Healthcare', eligibleCount: 8, beyondWatchlistCount: 8, breadthPct: 87.5, avgScore: 18.4, leaderSymbol: 'LLY' },
    { sector: 'Technology', eligibleCount: 12, beyondWatchlistCount: 8, breadthPct: 75.0, avgScore: 15.2, leaderSymbol: 'NVDA' }
  ],
  themes: [
    { id: 'volume_breakout', label: 'Volume Accumulation' },
    { id: 'momentum_leader', label: 'Momentum Leader' }
  ],
  discoveries: [
    {
      symbol: 'LLY',
      name: 'Eli Lilly & Co.',
      sector: 'Healthcare',
      industry: 'Biopharmaceuticals',
      beyondWatchlist: true,
      theme: 'volume_breakout',
      themeLabel: 'Volume Accumulation',
      discoveryScore: 26.5,
      quantScore: 22.5,
      qualitativeBonus: 4.0,
      rs20dPct: 6.8,
      indicators: { price: 812.4, return5dPct: 4.1, return20dPct: 9.2, volumeRatio: 1.48 },
      whyItMatters: ['Surfaced autonomously outside the 10-stock default watchlist in Healthcare.'],
      risksToWatch: ['Monitor upcoming FDA and 8-K disclosures.'],
      evidenceCounts: { filings: 1, news: 1, total: 2 },
      qualitativeEvidence: [
        {
          id: 'sec_1',
          sourceId: 'filings',
          filingType: '8-K',
          publishedAt: '2026-11-23T21:00:00Z',
          summary: 'Manufacturing capacity expansion',
          url: 'https://www.sec.gov/Archives/edgar/data/59478/lly.htm'
        }
      ]
    },
    {
      symbol: 'NVDA',
      name: 'NVIDIA Corp.',
      sector: 'Technology',
      industry: 'Semiconductors',
      beyondWatchlist: false,
      theme: 'momentum_leader',
      themeLabel: 'Momentum Leader',
      discoveryScore: 21.0,
      quantScore: 21.0,
      qualitativeBonus: 0,
      rs20dPct: 4.2,
      indicators: { price: 144.0, return5dPct: 2.3, return20dPct: 6.6, volumeRatio: 1.1 },
      whyItMatters: ['Core liquid leader in Technology.'],
      risksToWatch: ['Watch customer capex cadence.'],
      evidenceCounts: { filings: 0, news: 0, total: 0 },
      qualitativeEvidence: []
    }
  ]
}

describe('Autonomous Stock Discovery UI', () => {
  it('renders cross-sector discoveries, filters beyond-watchlist candidates, and exposes SEC evidence', () => {
    render(<StockDiscoveryPanel discovery={sampleDiscovery} />)

    expect(screen.getByTestId('ai-stock-discovery')).toBeInTheDocument()
    expect(screen.getByTestId('discovery-card-LLY')).toHaveTextContent('Eli Lilly & Co.')
    expect(screen.getByTestId('discovery-card-LLY')).toHaveTextContent('New discovery')
    expect(screen.getByTestId('discovery-card-NVDA')).toBeInTheDocument()

    // Toggle "Beyond 10-stock watchlist only"
    fireEvent.click(screen.getByTestId('filter-beyond-watchlist'))
    expect(screen.getByTestId('discovery-card-LLY')).toBeInTheDocument()
    expect(screen.queryByTestId('discovery-card-NVDA')).not.toBeInTheDocument()

    // Context-preserving links across Stocks -> Strategies / My Bots / AI Research
    const actions = screen.getByTestId('discovery-actions-LLY')
    expect(actions.querySelector('a[href="/assets/LLY?from=stocks"]')).toBeTruthy()
    expect(actions.querySelector('a[href="/strategies?symbol=LLY"]')).toBeTruthy()
    expect(actions.querySelector('a[href="/bots/new?ticker=LLY"]')).toBeTruthy()
    expect(actions.querySelector('a[href="/research-partners?symbol=LLY"]')).toBeTruthy()
  })

  it('loads discovery explorer page from /public/ai-stock-trader/discovery', async () => {
    get.mockResolvedValue(sampleDiscovery)
    render(<StockDiscoveryPage />)

    expect(await screen.findByTestId('discovery-card-LLY')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/public/ai-stock-trader/discovery?limit=30')
  })
})
