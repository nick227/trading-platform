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
  it('lists featured bots in plain language with honest site-wide results', async () => {
    mockApi()
    renderPage()
    const [dca, research] = await screen.findAllByTestId('featured-bot')
    expect(dca).toHaveTextContent('Buys SPY (or stocks you pick) on a fixed schedule — once every day, whatever the price.')
    expect(dca).toHaveTextContent('−$52.12')
    expect(dca).toHaveTextContent('2 fills · 1 bot running')
    // No fills → says so, never "$0.00" or "0%".
    expect(research).toHaveTextContent('No fills yet')
    expect(research.textContent).not.toMatch(/\$0\.00|0%/)
    expect(research).toHaveTextContent('Latest research: no edge')
  })

  it('expands a featured bot: rules, results with sample size, research kept separate, one way to use it', async () => {
    mockApi()
    renderPage()
    const [dca] = await screen.findAllByTestId('featured-bot')
    fireEvent.click(within(dca).getByRole('button', { name: /DCA Accumulator/ }))
    expect(within(dca).getByText('At most one trade per symbol per day')).toBeInTheDocument()
    expect(within(dca).getByTestId('featured-results')).toHaveTextContent('Needs 5 closed trades (0 so far)')
    expect(dca).toHaveTextContent('Actual simulator fills')
    expect(within(dca).getByRole('link', { name: 'Use this bot' })).toHaveAttribute('href', '/bots/new?template=tmpl_dca')
  })

  it('opens a featured bot from a deep link and shows its research as historical replay', async () => {
    mockApi()
    renderPage('/bots?featured=tmpl_research')
    const research = await screen.findByTestId('featured-research')
    expect(research).toHaveTextContent('48.7%')
    expect(research).toHaveTextContent('50.3%')
    expect(research).toHaveTextContent('No proven edge')
    expect(research).toHaveTextContent('Historical replay research — separate from the bot results.')
  })

  it('has exactly one Create action and an empty My bots state that points to featured bots', async () => {
    mockApi()
    renderPage()
    await screen.findAllByTestId('featured-bot')
    expect(screen.getAllByRole('link', { name: 'Create bot' })).toHaveLength(1)
    expect(screen.getByText('You haven’t created a bot yet.')).toBeInTheDocument()
  })

  it('shows my bots with their behaviour and P/L, linking to the shared bot record', async () => {
    mockApi({ bots: [{ id: 'bot_1', name: 'SPY Accumulator', enabled: true, templateId: 'tmpl_dca', config: { direction: 'buy', tickers: ['SPY'], allocatedAmount: 5000 }, performance: { realizedPnl: 0, unrealizedPnl: -52.12, totalPnl: -52.12 } }] })
    renderPage()
    const row = await screen.findByTestId('my-bot')
    expect(row).toHaveTextContent('Buys SPY on a fixed schedule')
    expect(row).toHaveTextContent('From DCA Accumulator')
    expect(row).toHaveTextContent('−$52.12')
    expect(within(row).getByRole('link', { name: /SPY Accumulator/ })).toHaveAttribute('href', '/bots/bot_1')
  })

  it('still lists featured bots when results fail to load', async () => {
    mockApi({ platformRows: new Error('HTTP 500') })
    renderPage()
    expect(await screen.findAllByTestId('featured-bot')).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent('Site-wide results couldn’t be loaded.')
  })
})
