import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { get, post } from '../../../../api/client'
import BacktestPanel from '../BacktestPanel'

const preview = { config: { tickers: ['SPY'], direction: 'buy', allocatedAmount: 5000 }, rules: [{ type: 'price_threshold', config: { operator: 'above', price: 500 }, enabled: true }] }
const curve = Array.from({ length: 6 }, (_, i) => ({ date: `2026-11-1${i}`, pnl: i * 10, equity: 5000 + i * 10 }))
const done = {
  id: 'bt_1', status: 'succeeded', dataFingerprint: 'f'.repeat(64), configHash: 'c'.repeat(64),
  dataIssues: [{ ticker: 'NVDA', type: 'price_basis_adjusted', date: '2023-11-20', factor: 10 }],
  results: {
    range: { firstSession: '2025-11-24', lastSession: '2026-11-23', sessions: 252 }, executionModelLabel: 'Decides at each close; fills at the next session’s open',
    capital: 5000, riskPolicyVersion: 'normal-abc', assumptions: ['Hypothetical.'], skips: { price_above_threshold_not_met: 40 }, events: [],
    metrics: { pnl: 50, returnPct: 1, maxDrawdown: { amount: 20, pct: 0.4 }, trades: 3, closedTrades: 1, winRate: 1, timeInMarketPct: 60 },
    buyAndHold: { returnPct: 4.5, maxDrawdown: { amount: 300, pct: 6 } }, curve,
    trades: [{ session: '2026-11-10', ticker: 'SPY', side: 'buy', quantity: 1, price: 600, realizedPnl: null }],
  },
}

afterEach(() => vi.useRealTimers())

describe('BacktestPanel', () => {
  it('runs what is on screen, polls until done, and shows results against buy & hold', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    post.mockResolvedValue({ id: 'bt_1', status: 'queued' })
    get.mockResolvedValueOnce({ id: 'bt_1', status: 'running' }).mockResolvedValue(done)
    render(<BacktestPanel preview={preview} />)
    fireEvent.click(screen.getByRole('button', { name: '3Y' }))
    fireEvent.click(screen.getByRole('button', { name: 'Same close' }))
    fireEvent.click(screen.getByTestId('run-backtest'))
    expect(post).toHaveBeenCalledWith('/backtests', { config: preview.config, rules: preview.rules, range: '3Y', executionModel: 'same_close' })
    await vi.advanceTimersByTimeAsync(4000)
    await waitFor(() => expect(screen.getByTestId('backtest-results')).toBeInTheDocument())
    expect(screen.getByTestId('bt-return')).toHaveTextContent('+1.00%')
    expect(screen.getByTestId('bt-buyhold')).toHaveTextContent('+4.50%bot behind by 3.50 pts')
    expect(screen.getByTestId('bt-data-notes')).toHaveTextContent('NVDA: prices before Nov 20, 2023 were on a different share basis (×10)')
    expect(screen.getByText('Hypothetical')).toBeInTheDocument()
  })
  it('shows the server’s reason when a run can’t start, and blocks research bots up front', async () => {
    const err = new Error('HTTP 409'); err.serverMessage = 'You already have a backtest running.'
    post.mockRejectedValue(err)
    const { rerender } = render(<BacktestPanel preview={preview} />)
    fireEvent.click(screen.getByTestId('run-backtest'))
    expect(await screen.findByTestId('backtest-error')).toHaveTextContent('You already have a backtest running.')
    rerender(<BacktestPanel preview={preview} blockedReason="Research bots can’t be backtested yet." />)
    expect(screen.getByTestId('run-backtest')).toBeDisabled()
  })
})
