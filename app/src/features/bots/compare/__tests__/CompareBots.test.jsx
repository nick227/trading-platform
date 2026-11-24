import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { post } from '../../../../api/client'
import { CompareTable } from '../CompareBots'
import { DuplicateButton } from '../../detail/BotDashboard'

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

const row = (id, name, ret, bt = null, extra = {}) => ({ id, name, enabled: true, symbols: ['SPY'], allocation: 5000, clonedFrom: null,
  paper: { returnPct: ret, totalPnl: ret === null ? null : ret * 50, winRate: null, closedTrades: 0, capitalInUse: 1000, maxDrawdown: null }, backtest: bt, ...extra })

describe('CompareTable', () => {
  it('sorts by paper return (best first) and shows backtests against buy & hold', () => {
    render(<MemoryRouter><CompareTable rows={[
      row('a', 'Alpha', 1.2), row('b', 'Beta', 3.4, { returnPct: 12.5, buyAndHoldReturnPct: 20, range: { start: '2021-11-23', end: '2026-11-23' } }),
      row('c', 'Copy of Beta', null, null, { clonedFrom: { botId: 'b', name: 'Beta' } }),
    ]} /></MemoryRouter>)
    const names = () => screen.getAllByTestId('compare-row').map((r) => within(r).getByRole('link').textContent)
    expect(names()).toEqual(['Beta', 'Alpha', 'Copy of Beta'])
    expect(screen.getAllByTestId('compare-row')[0]).toHaveTextContent('+12.50% vs +20.00%')
    expect(screen.getAllByTestId('compare-row')[2]).toHaveTextContent('copy of Beta')
    fireEvent.click(screen.getByRole('button', { name: /Return/ }))
    expect(names()).toEqual(['Alpha', 'Beta', 'Copy of Beta']) // ascending; unknown stays last
  })
  it('Duplicate creates a paused copy and opens it in the Workshop', async () => {
    post.mockResolvedValue({ id: 'bot_copy' })
    render(<MemoryRouter initialEntries={['/bots/bot_a']}><DuplicateButton botId="bot_a" /></MemoryRouter>)
    fireEvent.click(screen.getByTestId('duplicate-bot-btn'))
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/bots/bot_a/clone', {}))
  })
})
