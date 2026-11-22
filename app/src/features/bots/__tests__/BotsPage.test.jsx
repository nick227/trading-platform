import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { get } from '../../../api/client'
import BotsPage from '../BotsPage'

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

const catalog = {
  ruleBased: [
    { id: 'tmpl_dca', name: 'DCA Accumulator', botType: 'rule_based', config: { direction: 'buy', tickers: ['SPY'], allocatedAmount: 5000 }, rules: [{ type: 'cooldown', config: { windowMs: 86_400_000 } }] },
    { id: 'tmpl_research', name: 'Alpha Research Follower', botType: 'rule_based', config: { signalSource: 'alpha_research', tickers: ['SPY'] }, rules: [] },
  ],
  strategyBased: [],
}
const platform = [
  { id: 'tmpl_dca', results: { bots: 1, runningBots: 1, users: 1, fills: 2, closedTrades: 0, wins: 0, winRate: null, realizedPnl: 0, unrealizedPnl: -52.12, totalPnl: -52.12, capitalInUse: 1431.74, symbols: ['SPY'], firstSession: '2026-11-19', lastSession: '2026-11-19', fillSource: 'simulator', pricesAsOf: '2026-11-20' }, research: null },
  {
    id: 'tmpl_research',
    results: { bots: 0, runningBots: 0, users: 0, fills: 0, closedTrades: 0, wins: 0, winRate: null, realizedPnl: null, unrealizedPnl: null, totalPnl: null, symbols: [] },
    research: { model: 'trend_momentum_v1', horizon: '5d', observedAt: '2026-11-19T00:00:00Z', mode: 'historical_replay', edgeOverBaseline: false, genuineOutOfSample: false, verified: true, holdout: { hitRate: 0.487, baselineRate: 0.503, samples: 1260, start: '2026-05-15', end: '2026-11-12' } },
  },
]

function mockApi({ bots = [], platformRows = platform } = {}) {
  get.mockImplementation(async (path, params = {}) => {
    if (path === '/bots/catalog') return catalog
    if (path === '/strategies/platform') { if (platformRows instanceof Error) throw platformRows; return platformRows }
    if (path === '/bots') return bots
    if (path === '/executions') return []
    if (/^\/bots\/[^/]+\/events$/.test(path)) return params.type ? [] : []
    throw new Error(`unexpected GET ${path}`)
  })
}

const renderPage = (path = '/bots') => render(<MemoryRouter initialEntries={[path]}><BotsPage /></MemoryRouter>)

beforeEach(() => vi.clearAllMocks())

describe('BotsPage', () => {
  it('lists starting points in plain language, never presenting a small sample as performance', async () => {
    mockApi()
    renderPage()
    const [dca, research] = await screen.findAllByTestId('featured-bot')
    expect(dca).toHaveTextContent('Buys a stock you choose on a fixed schedule — once every day, whatever the price.')
    // 2 fills on one day: "too early to judge", and no headline P&L.
    expect(dca).toHaveTextContent('Too early to judge2 fills on Nov 19')
    expect(dca.querySelector('.tl-featured-row').textContent).not.toMatch(/\$52/)
    // No fills → says so, never "$0.00" or "0%".
    expect(research).toHaveTextContent('Not tried yet')
    expect(research.textContent).not.toMatch(/\$0\.00|0%/)
    expect(research).toHaveTextContent('Latest research: no proven edge')
  })

  it('expands a starting point: its conditions, a sample-size caveat, and one way to use it', async () => {
    mockApi()
    renderPage()
    const [dca] = await screen.findAllByTestId('featured-bot')
    fireEvent.click(within(dca).getByRole('button', { name: /DCA Accumulator/ }))
    expect(within(dca).getByText('At most one trade per symbol per day')).toBeInTheDocument()
    expect(within(dca).getByTestId('featured-results')).toHaveTextContent('Too early to judge. 2 simulated fills from 1 bot on Nov 19, 0 closed trades (−$52.12 at the Nov 20 close). Results are shown once there are 5 closed trades across 5 sessions.')
    expect(within(dca).getByRole('link', { name: 'Start from this' })).toHaveAttribute('href', '/bots/new?template=tmpl_dca')
  })

  it('opens a featured bot from a deep link and shows its research as historical replay', async () => {
    mockApi()
    renderPage('/bots?featured=tmpl_research')
    const research = await screen.findByTestId('featured-research')
    expect(research).toHaveTextContent('Holdout hit rate 48.7% vs 50.3% always-up baseline (−1.6 pts)')
    expect(research).toHaveTextContent('No proven edge')
    expect(research).toHaveTextContent('Historical replay research, separate from the results above.')
    expect(research).toHaveTextContent('Research is an input you can test, not a recommendation.')
  })

  it('has exactly one Create action, and hides My bots and Activity for a new account', async () => {
    mockApi()
    renderPage()
    await screen.findAllByTestId('featured-bot')
    expect(screen.getAllByRole('link', { name: 'Create bot' })).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: /My bots/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Activity' })).not.toBeInTheDocument()
  })

  it('shows my bots with the same row and Pause/Resume as Home, linking to the shared bot record', async () => {
    mockApi({ bots: [{ id: 'bot_1', name: 'SPY Accumulator', enabled: true, templateId: 'tmpl_dca', rules: [{ type: 'cooldown', config: { windowMs: 86_400_000 } }], config: { direction: 'buy', tickers: ['SPY'], allocatedAmount: 5000 }, performance: { realizedPnl: 0, unrealizedPnl: -52.12, totalPnl: -52.12 } }] })
    renderPage()
    const row = await screen.findByTestId('bot-card')
    expect(row).toHaveTextContent('Buys SPY on a fixed schedule')
    expect(row).toHaveTextContent('−$52.12')
    expect(within(row).getByRole('link', { name: /SPY Accumulator/ })).toHaveAttribute('href', '/bots/bot_1')
    // Same row and control as Home.
    expect(within(row).getByRole('button', { name: 'Pause SPY Accumulator' })).toBeInTheDocument()
  })

  it('still lists featured bots when results fail to load', async () => {
    mockApi({ platformRows: new Error('HTTP 500') })
    renderPage()
    expect(await screen.findAllByTestId('featured-bot')).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent('Site-wide results couldn’t be loaded.')
  })
})
