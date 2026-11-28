import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { del, get, getPage, post, put } from '../../../api/client'
import HomeDashboard from '../HomeDashboard'
import PortfolioPage from '../PortfolioPage'
import { normalizeBot, normalizeValuation, toNumberOrNull } from '../homeApi'

// Global setup stubs react-router-dom without Link/MemoryRouter; use the real module.
vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

const authState = { user: { fullName: 'Ada Lovelace' }, brokerStatus: { connected: true, paper: true } }
vi.mock('../../../app/AuthProvider', () => ({ useAuth: () => authState }))

const bots = [
  {
    id: 'bot_1', name: 'Momentum AAPL', enabled: true, botType: 'rule_based',
    strategy: null, config: { tickers: ['AAPL'], quantity: 5, allocatedAmount: 2500 },
  },
  {
    id: 'bot_2', name: 'Mean Reversion', enabled: false, botType: 'strategy_based',
    strategy: { name: 'Mean reversion' }, config: { tickers: ['MSFT', 'NVDA'] },
  },
]

const valuation = {
  source: 'simulator', simulated: true, session: '2026-11-19', startingCash: 100000,
  cash: 98253.95, marketValue: 1712.8, equity: 99966.75, totalPnl: -33.25, totalPnlPct: -0.03,
  realizedPnl: 0, unrealizedPnl: -33.25, fillCount: 1, valuationComplete: true, unpricedSymbols: [],
  pricesAsOf: '2026-11-20',
  positions: [{
    symbol: 'AAPL', quantity: 5, avgPrice: 349.21, costBasis: 1746.05, price: 342.56, priceSession: '2026-11-20',
    marketValue: 1712.8, unrealizedPnl: -33.25, unrealizedPct: -1.9, weight: 1.71, bots: [{ botId: 'bot_1', quantity: 5 }],
  }],
}
const history = { source: 'simulator', startingCash: 100000, points: [{ date: '2026-11-19', value: 100000, cash: 98253.95, fills: 1 }, { date: '2026-11-20', value: 99966.75, cash: 98253.95, fills: 0 }] }

function apiError(status, code) {
  const e = new Error(`HTTP ${status}: x`)
  e.status = status
  e.code = code
  return e
}

function mockApi({ value = valuation, botList = bots, executions = {}, events = {}, eventsBroken = false, transactions = [] } = {}) {
  get.mockImplementation(async (path, params) => {
    if (path === '/account/valuation') {
      if (value instanceof Error) throw value
      return value
    }
    if (path === '/account/value-history') return history
    if (path === '/bots') {
      if (botList instanceof Error) throw botList
      return botList
    }
    if (path === '/executions') return executions[params.botId] ?? []
    const m = path.match(/^\/bots\/([^/]+)\/events$/)
    if (m) {
      if (eventsBroken) throw apiError(500, null)
      const rows = events[m[1]] ?? []
      return params.type === 'execution_skipped' ? rows.filter((e) => e.type === 'execution_skipped') : rows.filter((e) => e.type !== 'execution_skipped')
    }
    throw new Error(`unexpected GET ${path}`)
  })
  getPage.mockResolvedValue({ data: transactions, pagination: { hasMore: false, nextCursor: null } })
}

const renderHome = (path = '/') => render(<MemoryRouter initialEntries={[path]}><HomeDashboard /></MemoryRouter>)
const renderPortfolio = () => render(<MemoryRouter initialEntries={['/portfolio']}><PortfolioPage /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  authState.user = { fullName: 'Ada Lovelace' }
  authState.brokerStatus = { connected: true, paper: true }
})

describe('HomeDashboard', () => {
  it('prioritizes account totals and an investments table without bot setup', async () => {
    mockApi()
    renderPortfolio()
    expect(await screen.findByTestId('balance-equity')).toHaveTextContent('$99,966.75')
    expect(screen.getByTestId('portfolio-total-pnl')).toHaveTextContent('−$33.25 (−0.03%)')
    expect(screen.getByText('Available cash').nextSibling).toHaveTextContent('$98,253.95')
    expect(screen.getByText('Invested').nextSibling).toHaveTextContent('$1,712.80')
    expect(screen.getByTestId('as-of')).toHaveTextContent('Valued at Nov 20 closing prices')
    expect(screen.getByTestId('holdings-table')).toHaveTextContent('AAPL')
    expect(screen.queryByRole('link',{name:/Create bot|Build a bot/})).not.toBeInTheDocument()
    expect(screen.queryByText('Personal AI Trader')).not.toBeInTheDocument()
    expect(get).not.toHaveBeenCalledWith('/account/value-history', expect.anything())
    expect(get).not.toHaveBeenCalledWith('/executions', expect.anything())
  })

  it('summarizes enabled and paused bots and updates after a pause', async () => {
    mockApi({ botList: [{ ...bots[0], rules: [{ type: 'price_threshold', config: { price: 350 } }] }, bots[1]] })
    put.mockResolvedValue({})
    renderHome()
    const status = await screen.findByTestId('workshop-status')
    expect(status).toHaveTextContent('1 running')
    expect(status).toHaveTextContent('1 paused')
    expect(status).toHaveTextContent('No recorded activity yet')
    fireEvent.click(screen.getByRole('button', { name: 'Pause Momentum AAPL' }))
    await waitFor(() => expect(status).toHaveTextContent('0 running'))
    expect(status).toHaveTextContent('2 paused')
    expect(screen.getByText('Price Scout')).toBeInTheDocument()
  })

  it('expands individual investments only when requested', async () => {
    mockApi()
    renderPortfolio()
    const row = await screen.findByTestId('holding-row')
    expect(row).toHaveTextContent('AAPL')
    expect(row).toHaveTextContent('−$33.25')
    expect(screen.queryByTestId('holding-detail-AAPL')).not.toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button',{name:/AAPL/}))
    const detail = await screen.findByTestId('holding-detail-AAPL')
    expect(within(detail).getByRole('link', { name: 'Build a bot for AAPL' })).toHaveAttribute('href', '/bots/new?ticker=AAPL')
    expect(within(detail).getByRole('button', { name: 'Pause Momentum AAPL' })).toBeInTheDocument()
  })

  it('sorts multiple investments by value and reverses order on a second click', async () => {
    mockApi({value: {...valuation, positions: [
      valuation.positions[0],
      {...valuation.positions[0], symbol:'MSFT', marketValue:4000, unrealizedPnl:42, unrealizedPct:1.1, bots:[]},
      {...valuation.positions[0], symbol:'NVDA', marketValue:null, unrealizedPnl:null, unrealizedPct:null, bots:[]},
    ]}})
    renderPortfolio()
    const rows = await screen.findAllByTestId('holding-row')
    expect(rows.map(r=>within(r).getByRole('button').textContent)).toEqual(['MSFT▾','AAPL▾','NVDA▾'])
    const valueHead = screen.getByRole('columnheader', {name:/Value/})
    expect(valueHead).toHaveAttribute('aria-sort','descending')
    fireEvent.click(within(valueHead).getByRole('button',{name:'Sort by Value'}))
    expect(valueHead).toHaveAttribute('aria-sort','ascending')
    expect(screen.getAllByTestId('holding-row').map(r=>within(r).getByRole('button').textContent))
      .toEqual(['AAPL▾','MSFT▾','NVDA▾'])
    fireEvent.click(screen.getByRole('button',{name:'Sort by Investment'}))
    expect(screen.getAllByTestId('holding-row').map(r=>within(r).getByRole('button').textContent))
      .toEqual(['NVDA▾','MSFT▾','AAPL▾'])
    fireEvent.click(screen.getByRole('button',{name:'Sort by Investment'}))
    expect(screen.getAllByTestId('holding-row').map(r=>within(r).getByRole('button').textContent))
      .toEqual(['AAPL▾','MSFT▾','NVDA▾'])
  })

  it('shows a calm investment empty state with no bot catalog', async () => {
    mockApi({value:{...valuation, equity:100000, cash:100000, marketValue:0, positions:[], fillCount:0, totalPnl:0}})
    renderPortfolio()
    expect(await screen.findByTestId('balance-equity')).toHaveTextContent('$100,000.00')
    expect(screen.getByTestId('holdings-table')).toHaveTextContent('No investments yet')
    expect(screen.queryByRole('link',{name:/Create a bot|Build a bot/})).not.toBeInTheDocument()
    expect(screen.queryByTestId('portfolio-total-pnl')).not.toBeInTheDocument()
  })

  it('shows bots with status, capital and exactly one control each', async () => {
    mockApi()
    renderHome()
    const [running, paused] = await screen.findAllByTestId('bot-card')
    expect(within(running).getByTestId('bot-status')).toHaveTextContent('Running')
    expect(within(running).getByText('$2,500 capital')).toBeInTheDocument()
    expect(within(running).getByText('P&L unavailable')).toBeInTheDocument()
    expect(within(running).queryByText('Scheduled Trader')).not.toBeInTheDocument()
    expect(within(running).getByRole('link', { name: /Momentum AAPL/ })).toHaveAttribute('href', '/bots/bot_1')
    expect(within(running).getAllByRole('button').map((b) => b.textContent)).toEqual(['Pause'])
    expect(within(paused).getByTestId('bot-status')).toHaveTextContent('Paused')
    expect(within(paused).getByText('Capital not set')).toBeInTheDocument()
    expect(within(paused).getAllByRole('button').map((b) => b.textContent)).toEqual(['Resume'])
  })

  it('shows total P/L only when the backend knows it, never a stand-in zero', async () => {
    mockApi({ botList: [{ ...bots[0], performance: { realizedPnl: 40, unrealizedPnl: -15.5 } }, { ...bots[1], performance: { realizedPnl: 7, unrealizedPnl: null, totalPnl: 7 } }] })
    renderHome()
    const [withPnl, realizedOnly] = await screen.findAllByTestId('bot-card')
    expect(within(withPnl).getByTestId('bot-pnl')).toHaveTextContent('+$24.50')
    expect(within(realizedOnly).queryByTestId('bot-pnl')).not.toBeInTheDocument()
    expect(realizedOnly).toHaveTextContent('P&L pending prices')
  })

  it('shows the latest meaningful activity per bot, past routine checks', async () => {
    mockApi({
      events: {
        bot_1: [
          { id: 'ev2', type: 'execution_skipped', detail: 'x', metadata: { ticker: 'AAPL', reason: 'cooldown_active' }, createdAt: '2026-11-20T16:00:00Z' },
          { id: 'ev1', type: 'bot_resumed', detail: 'x', metadata: {}, createdAt: '2026-11-20T15:00:00Z' },
        ],
      },
    })
    renderHome()
    const [first, second] = await screen.findAllByTestId('bot-card')
    expect(within(first).getByTestId('bot-last-activity')).toHaveTextContent('Resumed')
    expect(within(second).getByTestId('bot-last-activity')).toHaveTextContent('No activity yet')
  })

  it('marks a running bot whose latest activity is an error', async () => {
    mockApi({ events: { bot_1: [{ id: 'ev1', type: 'strategy_error', detail: 'boom', metadata: { ticker: 'AAPL' }, createdAt: '2026-11-20T15:00:00Z' }] } })
    renderHome()
    const [first] = await screen.findAllByTestId('bot-card')
    expect(within(first).getByTestId('bot-status')).toHaveTextContent('Error')
    expect(within(first).getByRole('button', { name: 'Pause Momentum AAPL' })).toBeInTheDocument()
  })

  it('does not load research dashboards', async () => {
    mockApi()
    renderHome()
    await screen.findByRole('link', { name: 'View portfolio' })
    const calledPaths = get.mock.calls.map(([p]) => p)
    expect(calledPaths.some((p) => /rank|recommend|signal|predict/.test(p))).toBe(false)
    // The general research dashboard isn't linked while it's being rebuilt.
    expect(document.querySelector('a[href="/research"]')).toBeNull()
  })

  it('shows unavailable values (not $0) and a connect prompt when no account is connected', async () => {
    authState.brokerStatus = { connected: false }
    mockApi({ value: { ...valuation, source: 'none', simulated: false, cash: null, equity: null, totalPnl: null, positions: [] } })
    renderPortfolio()
    expect(await screen.findByTestId('balance-equity')).toHaveTextContent('—')
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect a paper account' })).toHaveAttribute('href', '/profile')
  })

  it('pauses a running bot via PUT /bots/:id', async () => {
    mockApi()
    put.mockResolvedValue({ id: 'bot_1', enabled: false })
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Pause Momentum AAPL' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/bots/bot_1', { enabled: false }))
    expect(await screen.findByRole('button', { name: 'Resume Momentum AAPL' })).toBeInTheDocument()
    expect(within(screen.getAllByTestId('bot-card')[0]).getByTestId('bot-status')).toHaveTextContent('Paused')
  })

  it('pauses every running bot with Pause all', async () => {
    mockApi({ botList: [bots[0], { ...bots[1], enabled: true }] })
    put.mockResolvedValue({})
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Pause all' }))
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(put).toHaveBeenCalledWith('/bots/bot_1', { enabled: false })
    expect(put).toHaveBeenCalledWith('/bots/bot_2', { enabled: false })
    expect(await screen.findByRole('button', { name: 'Resume Momentum AAPL' })).toBeInTheDocument()
  })

  it('explains a blocked resume instead of flipping state', async () => {
    mockApi()
    put.mockRejectedValue(apiError(403, 'BROKER_NOT_CONFIGURED'))
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume Mean Reversion' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('connect a paper trading account')
    expect(screen.getByRole('button', { name: 'Resume Mean Reversion' })).toBeInTheDocument()
  })

  it('shows a useful empty state when the user has no bots', async () => {
    mockApi({ botList: [], value: { ...valuation, cash: 100000, equity: 100000, totalPnl: 0, positions: [], fillCount: 0 } })
    renderHome()
    expect(await screen.findByText('You don’t have any bots yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Build a bot' })).toHaveAttribute('href', '/bots')
    expect(screen.getByRole('link', { name: 'View portfolio' })).toHaveAttribute('href', '/portfolio')
    // Sections with nothing to show stay out of the way.
    expect(screen.queryByRole('heading', { name: /Holdings/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Recent activity' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Transactions' })).not.toBeInTheDocument()
  })

  it('lists activity newest first across bots, from orders when the event log is down', async () => {
    mockApi({
      eventsBroken: true,
      executions: {
        bot_1: [{ id: 'e1', botId: 'bot_1', ticker: 'AAPL', direction: 'buy', quantity: 5, filledQuantity: 5, status: 'filled', filledPrice: 190.1, createdAt: '2026-11-19T15:00:00Z', filledAt: '2026-11-19T15:00:05Z' }],
        bot_2: [{ id: 'e2', botId: 'bot_2', ticker: 'MSFT', direction: 'sell', quantity: 2, status: 'queued', filledPrice: null, createdAt: '2026-11-20T14:00:00Z' }],
      },
    })
    renderHome()
    const rows = within(await screen.findByTestId('activity-list')).getAllByRole('listitem').filter((li) => li.parentElement.dataset.testid === 'activity-list')
    // One row per trade: the AAPL order and its fill are a single row with a decision trail.
    expect(rows.map((r) => r.querySelector('.tl-feed-title').textContent.replace(/\s+/g, ' '))).toEqual([
      'Mean ReversionSell order placed · MSFT',
      'Momentum AAPLBought 5 AAPL',
    ])
    expect(within(rows[1]).getByRole('button', { name: /Details/ })).toHaveTextContent('Details2 steps')
  })

  it('folds routine checks into one line and reveals their reasons on request', async () => {
    const skip = (id, at) => ({ id, type: 'execution_skipped', detail: 'x', metadata: { ticker: 'AAPL', reason: 'cooldown_active' }, createdAt: at })
    mockApi({ events: { bot_1: [skip('s1', '2026-11-20T16:00:00Z'), skip('s2', '2026-11-20T15:00:00Z'), skip('s3', '2026-11-20T14:00:00Z')] } })
    renderHome()
    const summary = await screen.findByTestId('routine-summary')
    expect(summary).toHaveTextContent('No orders or decisions yet. 3 routine checks without a trade (cooldown)')
    fireEvent.click(within(summary).getByRole('button', { name: 'Show them' }))
    expect(screen.getByTestId('activity-list')).toHaveTextContent('The bot traded AAPL recently and is waiting before trading it again.')
    expect(screen.getByTestId('activity-list')).toHaveTextContent('×3')
  })

  it('features the latest meaningful event; the stream stays chronological and heartbeats fold away', async () => {
    const done = (id, at) => ({ id, type: 'execution_skipped', detail: 'x', metadata: { ticker: 'SPY', reason: 'acted_this_session' }, createdAt: at })
    const paused = { id: 'p1', type: 'bot_paused', detail: 'x', metadata: {}, createdAt: '2026-11-23T21:30:00Z' }
    mockApi({
      executions: { bot_1: [{ id: 'e1', botId: 'bot_1', ticker: 'SPY', direction: 'buy', quantity: 3, filledQuantity: 3, status: 'filled', filledPrice: 600, createdAt: '2026-11-23T22:08:00Z', filledAt: '2026-11-23T22:08:05Z' }] },
      events: { bot_1: [done('d3', '2026-11-24T01:08:00Z'), done('d2', '2026-11-24T00:08:00Z'), done('d1', '2026-11-23T23:08:00Z')], bot_2: [paused] },
    })
    renderHome()
    const rows = within(await screen.findByTestId('activity-list')).getAllByRole('listitem').filter((li) => li.parentElement.dataset.testid === 'activity-list')
    const titles = rows.map((r) => r.querySelector('.tl-feed-title').textContent.replace(/\s+/g, ' '))
    expect(titles).toEqual(['Momentum AAPLBought 3 SPY', 'Mean ReversionPaused']) // newest first
    expect(screen.getByTestId('routine-summary')).toHaveTextContent('3 routine checks without a trade (done for today)')
    expect(screen.getByTestId('latest-event')).toHaveTextContent('Latest: Momentum AAPL — Bought 3 SPY')
  })

  it('states the daily-close paper-trading model up front', async () => {
    authState.brokerStatus = { connected: true, paper: true, simulated: true, mode: 'paper_daily', tradableSymbols: ['SPY', 'AAPL'] }
    mockApi()
    renderHome()
    expect(await screen.findByTestId('trading-model')).toHaveTextContent('Paper trading on daily closes. Bots check once per trading day after the market closes and fill at that close — 2 symbols (SPY, AAPL). Not intraday, not real money.')
  })

  it('keeps the page usable when one source fails', async () => {
    mockApi({ value: new Error('HTTP 502') })
    renderHome()
    expect(await screen.findByText('Portfolio value unavailable.')).toBeInTheDocument()
    expect(screen.getAllByTestId('bot-card')).toHaveLength(2)
    expect(screen.getAllByTestId('bot-card')).toHaveLength(2)
  })
})

describe('emergency stop on Home', () => {
  it('turns on with explicit consequences and a reason, then shows a banner that can clear it', async () => {
    mockApi()
    let active = false
    const base = get.getMockImplementation()
    get.mockImplementation(async (path, params) => (path === '/risk/kill-switch' ? { active, ...(active ? { activatedAt: '2026-11-22T06:00:00Z', reason: 'Checking a bot' } : {}) } : base(path, params)))
    post.mockImplementation(async (path, body) => { if (path === '/risk/kill-switch') { active = true; return { active: true, botsPaused: 1 } } throw new Error(path) })
    del.mockImplementation(async (path) => { if (path === '/risk/kill-switch') { active = false; return { active: false } } throw new Error(path) })
    renderHome()
    fireEvent.click(await screen.findByRole('button', { name: 'Emergency stop' }))
    const dialog = screen.getByRole('dialog', { name: 'Stop everything?' })
    expect(dialog).toHaveTextContent('Cancellation is requested for every open order.')
    expect(dialog).toHaveTextContent('New orders are refused until you clear the stop.')
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Checking a bot' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop everything' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/risk/kill-switch', { reason: 'Checking a bot' }))
    expect(await screen.findByTestId('emergency-banner')).toHaveTextContent('Emergency stop is on')
    fireEvent.click(screen.getByRole('button', { name: 'Clear stop' }))
    await waitFor(() => expect(screen.queryByTestId('emergency-banner')).not.toBeInTheDocument())
    expect(del).toHaveBeenCalledWith('/risk/kill-switch')
  })
})

describe('homeApi normalization', () => {
  it('preserves null instead of coercing to zero', () => {
    expect(toNumberOrNull(null)).toBeNull()
    expect(toNumberOrNull('')).toBeNull()
    expect(toNumberOrNull('abc')).toBeNull()
    expect(toNumberOrNull(0)).toBe(0)
    const v = normalizeValuation({ equity: null, cash: undefined, positions: [{ symbol: 'X', price: null, marketValue: null }] })
    expect(v.equity).toBeNull()
    expect(v.cash).toBeNull()
    expect(v.positions[0].price).toBeNull()
    expect(normalizeBot({ id: 'b', enabled: false, config: null }).allocation).toBeNull()
    expect(normalizeBot({ id: 'b', enabled: false, config: null }).performance).toBeNull()
  })
})
