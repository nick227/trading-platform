import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { get, put } from '../../../api/client'
import HomeDashboard from '../HomeDashboard'
import { normalizeBot, normalizeAccount, toNumberOrNull } from '../homeApi'

// Global setup stubs react-router-dom without Link/MemoryRouter; use the real module.
vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

const authState = { user: { fullName: 'Ada Lovelace' }, brokerStatus: { connected: true, paper: true } }
vi.mock('../../../app/AuthProvider', () => ({ useAuth: () => authState }))

const bots = [
  {
    id: 'bot_1', name: 'Momentum AAPL', enabled: true, botType: 'rule_based',
    strategy: null, config: { tickers: ['AAPL'], quantity: 5, allocation: 2500 },
    _count: { executions: 3 },
  },
  {
    id: 'bot_2', name: 'Mean Reversion', enabled: false, botType: 'strategy_based',
    strategy: { name: 'Mean reversion' }, config: { tickers: ['MSFT', 'NVDA'] },
    _count: { executions: 0 },
  },
]

function mockApi({ account = { equity: 10250.5, cash: 4000 }, today = { pnl: 12.34, trades: 2 }, botList = bots, executions = {} } = {}) {
  get.mockImplementation(async (path, params) => {
    if (path === '/account') {
      if (account instanceof Error) throw account
      return account
    }
    if (path === '/performance/today') return today
    if (path === '/bots') {
      if (botList instanceof Error) throw botList
      return botList
    }
    if (path === '/executions') return executions[params.botId] ?? []
    throw new Error(`unexpected GET ${path}`)
  })
}

const renderHome = () => render(<MemoryRouter><HomeDashboard /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  authState.user = { fullName: 'Ada Lovelace' }
  authState.brokerStatus = { connected: true, paper: true }
})

describe('HomeDashboard', () => {
  it('shows balance, bots with status, and a single Add bot action', async () => {
    mockApi()
    renderHome()

    expect(await screen.findByTestId('balance-equity')).toHaveTextContent('$10,250.50')
    expect(screen.getByTestId('balance-today')).toHaveTextContent('+$12.34')
    expect(screen.getByText('Paper account balance')).toBeInTheDocument()
    expect(screen.getByText('Hi, Ada')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 bots running')).toBeInTheDocument()

    const cards = screen.getAllByTestId('bot-card')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('Running')).toBeInTheDocument()
    expect(within(cards[0]).getByText('$2,500.00')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Paused')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Not set')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Mean reversion')).toBeInTheDocument()

    const addBot = screen.getAllByRole('link', { name: 'Add bot' })
    expect(addBot).toHaveLength(1)
    expect(addBot[0]).toHaveAttribute('href', '/bots/new')
  })

  it('does not render research dashboards by default', async () => {
    mockApi()
    renderHome()
    await screen.findByTestId('balance-equity')

    for (const label of ['Ranked Opportunities', 'Top Movers', 'Market Context', 'Price-Capped Recommendations', 'Live Signals']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
    const calledPaths = get.mock.calls.map(([p]) => p)
    expect(calledPaths.some((p) => /rank|recommend|signal|engine|predict/.test(p))).toBe(false)
    expect(screen.getByRole('link', { name: 'Market research' })).toHaveAttribute('href', '/research')
  })

  it('shows unavailable values (not $0) and a connect prompt when no broker is connected', async () => {
    authState.brokerStatus = { connected: false }
    mockApi({ account: { equity: null, cash: null }, today: null })
    renderHome()

    expect(await screen.findByTestId('balance-equity')).toHaveTextContent('—')
    expect(screen.getByTestId('balance-today')).toHaveTextContent('—')
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect a paper account' })).toHaveAttribute('href', '/profile/broker')
  })

  it('pauses a running bot via PUT /bots/:id', async () => {
    mockApi()
    put.mockResolvedValue({ id: 'bot_1', enabled: false })
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: 'Pause Momentum AAPL' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/bots/bot_1', { enabled: false }))
    expect(await screen.findByRole('button', { name: 'Resume Momentum AAPL' })).toBeInTheDocument()
  })

  it('explains a blocked resume instead of flipping state', async () => {
    mockApi()
    put.mockRejectedValue(new Error('HTTP 403: Forbidden'))
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: 'Resume Mean Reversion' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('connect a paper trading account')
    expect(screen.getByRole('button', { name: 'Resume Mean Reversion' })).toBeInTheDocument()
  })

  it('shows an empty state with Add bot when the user has no bots', async () => {
    mockApi({ botList: [] })
    renderHome()

    expect(await screen.findByText('You don’t have any bots yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add bot' })).toBeInTheDocument()
    expect(screen.getByText(/No bot trades yet/)).toBeInTheDocument()
  })

  it('lists recent bot executions newest first, across bots', async () => {
    mockApi({
      executions: {
        bot_1: [{ id: 'e1', botId: 'bot_1', ticker: 'AAPL', direction: 'BUY', quantity: 5, status: 'filled', filledPrice: 190.1, createdAt: '2026-11-19T15:00:00Z', filledAt: '2026-11-19T15:00:05Z' }],
        bot_2: [{ id: 'e2', botId: 'bot_2', ticker: 'MSFT', direction: 'SELL', quantity: 2, status: 'queued', filledPrice: null, createdAt: '2026-11-20T14:00:00Z' }],
      },
    })
    renderHome()

    const rows = within(await screen.findByTestId('activity-list')).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Mean Reversion sell 2 MSFT')
    expect(rows[1]).toHaveTextContent('Momentum AAPL buy 5 AAPL @ $190.10')
    expect(get).toHaveBeenCalledWith('/executions', { botId: 'bot_1', limit: 5 })
  })

  it('keeps the page usable when one source fails', async () => {
    mockApi({ account: new Error('HTTP 502') })
    renderHome()

    expect(await screen.findByTestId('balance-equity')).toHaveTextContent('—')
    expect(screen.getAllByTestId('bot-card')).toHaveLength(2)
  })
})

describe('homeApi normalization', () => {
  it('preserves null instead of coercing to zero', () => {
    expect(toNumberOrNull(null)).toBeNull()
    expect(toNumberOrNull(undefined)).toBeNull()
    expect(toNumberOrNull('')).toBeNull()
    expect(toNumberOrNull('abc')).toBeNull()
    expect(toNumberOrNull(0)).toBe(0)
    expect(normalizeAccount({ equity: null, cash: undefined })).toEqual({ equity: null, cash: null })
    expect(normalizeBot({ id: 'b', enabled: false, config: null }).allocation).toBeNull()
  })
})
