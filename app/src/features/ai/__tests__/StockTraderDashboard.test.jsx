import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import StockTraderDashboard from '../StockTraderDashboard'
import { get } from '../../../api/client'

vi.mock('../../../api/client', () => ({ get: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

describe('flagship public dashboard', () => {
  it('never creates pretend performance or recommendations for an uninitialized bot', async () => {
    get.mockResolvedValue({ status: 'not_initialized', simulated: true })
    render(<StockTraderDashboard />)
    expect(await screen.findByTestId('flagship-uninitialized')).toHaveTextContent('no verified paper-trading results')
    expect(screen.queryByTestId('flagship-performance')).not.toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/public/ai-stock-trader')
  })

  it('renders proposals separately from paper order facts', async () => {
    get.mockResolvedValue({
      status: 'paused', capitalAllocated: 10000, performance: null, positions: [], orders: [],
      research: [{
        id: 'research-1', asOfSession: '2026-11-25', createdAt: '2026-11-25T22:00:00Z',
        model: 'mock', marketSummary: 'No sufficient setup',
        investigation: { focus: 'Compare eligible opportunities', toolsUsed: ['get_stock_metrics'], toolCalls: 1, modelCalls: 2, priorResearchCycles: 1 },
        decisions: [{ symbol: 'AAPL', action: 'HOLD', confidence: 0.6, thesis: 'Wait', evidence: [], risks: [] }]
      }]
    })
    render(<StockTraderDashboard />)
    expect(await screen.findByText('No sufficient setup')).toBeInTheDocument()
    expect(screen.getByTestId('flagship-investigation')).toHaveTextContent('Compare eligible opportunities')
    expect(screen.getByTestId('flagship-investigation')).toHaveTextContent('get stock metrics')
    expect(screen.getByTestId('flagship-investigation')).toHaveTextContent('Model calls: 2')
    expect(screen.getByTestId('flagship-no-positions')).toBeInTheDocument()
    expect(screen.getByTestId('flagship-no-orders')).toBeInTheDocument()
    expect(screen.getByText(/not a calibrated probability/)).toBeInTheDocument()
  })

  it('presents an error instead of stale or invented data', async () => {
    get.mockRejectedValue(new Error('service unavailable'))
    render(<StockTraderDashboard />)
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable')
  })
})
