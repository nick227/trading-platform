import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TradeHistory from '../TradeHistory'
import * as clientModule from '../../../api/client'

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))
vi.mock('../../../api/client', () => ({
  getPage: vi.fn(),
}))

const mockExecutions = [
  {
    id: 'exe_1',
    ticker: 'AAPL',
    direction: 'buy',
    quantity: 10,
    price: 150.0,
    filledPrice: 150.25,
    filledQuantity: 10,
    status: 'filled',
    pnl: 0,
    createdAt: '2026-11-20T14:30:00Z',
    submittedAt: '2026-11-20T14:30:01Z',
    filledAt: '2026-11-20T14:30:05Z',
    botId: 'bot_alpha',
    bot: { id: 'bot_alpha', name: 'Alpha Trend Bot', templateId: 'momentum' },
  },
  {
    id: 'exe_2',
    ticker: 'TSLA',
    direction: 'sell',
    quantity: 5,
    price: 220.0,
    filledPrice: 225.0,
    filledQuantity: 5,
    status: 'filled',
    pnl: 25.0,
    createdAt: '2026-11-20T15:00:00Z',
    submittedAt: '2026-11-20T15:00:01Z',
    filledAt: '2026-11-20T15:00:04Z',
    botId: 'bot_beta',
    bot: { id: 'bot_beta', name: 'Mean Revert Bot', templateId: 'mean_reversion' },
  },
  {
    id: 'exe_3',
    ticker: 'NVDA',
    direction: 'buy',
    quantity: 2,
    price: 480.0,
    filledPrice: null,
    filledQuantity: 0,
    status: 'queued',
    pnl: 0,
    createdAt: '2026-11-20T15:30:00Z',
    submittedAt: null,
    filledAt: null,
    botId: null,
    bot: null,
  },
]

describe('TradeHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders executions with bot attribution, prices, and status', async () => {
    clientModule.getPage.mockResolvedValue({
      data: mockExecutions,
      pagination: { hasMore: false, nextCursor: null },
    })

    render(
      <MemoryRouter>
        <TradeHistory />
      </MemoryRouter>
    )

    expect(screen.getByText('Loading trade history…')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId('trade-history-table')).toBeInTheDocument()
    })

    // Check ticker symbols
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('TSLA')).toBeInTheDocument()
    expect(screen.getByText('NVDA')).toBeInTheDocument()

    // Check bot attribution
    expect(screen.getByText('Alpha Trend Bot')).toBeInTheDocument()
    expect(screen.getByText('Mean Revert Bot')).toBeInTheDocument()
    expect(screen.getByText('Manual Order')).toBeInTheDocument()

    // Check direction chips
    expect(screen.getAllByText('BUY').length).toBe(2)
    expect(screen.getByText('SELL')).toBeInTheDocument()

    // Check realized PnL
    expect(screen.getByText('+$25.00')).toBeInTheDocument()

    // Check status chips
    expect(screen.getAllByText('Filled').length).toBe(2)
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('filters executions by status tab', async () => {
    clientModule.getPage.mockResolvedValue({
      data: mockExecutions,
      pagination: { hasMore: false, nextCursor: null },
    })

    render(
      <MemoryRouter>
        <TradeHistory />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByTestId('trade-history-table')).toBeInTheDocument()
    })

    // Click Pending filter
    fireEvent.click(screen.getByRole('button', { name: 'Pending / Open' }))
    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.queryByText('AAPL')).not.toBeInTheDocument()

    // Click Filled filter
    fireEvent.click(screen.getByRole('button', { name: /Filled/ }))
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('TSLA')).toBeInTheDocument()
    expect(screen.queryByText('NVDA')).not.toBeInTheDocument()
  })
})
