import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { get, put, del } from '../../../../api/client'
import BotDashboard from '../BotDashboard'
import {
  buildTimeline,
  deriveStatus,
  eventToItem,
  groupRepeats,
  normalizeExecution,
  normalizePerformance,
} from '../../../../api/services/botDashboardService'

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

function apiError(status, code = null) {
  const e = new Error(`HTTP ${status}: x`)
  e.status = status
  e.code = code
  return e
}

const baseBot = {
  id: 'bot_1',
  name: 'Golden Cross',
  enabled: true,
  deletedAt: null,
  botType: 'rule_based',
  templateId: 'tmpl_golden_cross',
  config: { tickers: ['SPY', 'QQQ'], direction: 'buy', capitalMode: 'allocated', allocatedAmount: 1000, maxOrderNotional: 250 },
  createdAt: '2026-11-18T12:00:00Z',
}

const ev = (id, type, at, metadata = {}, detail = '') => ({ id, type, createdAt: at, metadata, detail })

function mockApi({
  bot = baseBot,
  events = [],
  executions = [],
  account = { buying_power: 5000 },
  rules = [],
} = {}) {
  get.mockImplementation(async (path) => {
    if (path === '/bots/bot_1') { if (bot instanceof Error) throw bot; return bot }
    if (path === '/bots/bot_1/events') { if (events instanceof Error) throw events; return events }
    if (path === '/executions') { if (executions instanceof Error) throw executions; return executions }
    if (path === '/account') { if (account instanceof Error) throw account; return account }
    if (path === '/bots/bot_1/rules') { if (rules instanceof Error) throw rules; return rules }
    throw new Error(`unexpected GET ${path}`)
  })
}

function renderPage(state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/bots/bot_1', state }]}>
      <Routes>
        <Route path="/bots/:botId" element={<BotDashboard />} />
      </Routes>
    </MemoryRouter>
  )
}

const status = () => screen.getByTestId('bot-status')
const button = (name) => screen.queryByRole('button', { name })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Statuses', () => {
  it('Running: Pause, Edit and Stop are available', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Golden Cross' })).toBeInTheDocument()
    expect(status()).toHaveTextContent('Running')
    expect(button('Pause')).toBeInTheDocument()
    expect(button('Edit')).toBeInTheDocument()
    expect(button('Stop')).toBeInTheDocument()
    expect(screen.getByText(/Paper trading · SPY, QQQ · Buys only/)).toBeInTheDocument()
  })

  it('Paused: offers Resume', async () => {
    mockApi({ bot: { ...baseBot, enabled: false } })
    renderPage()
    await screen.findByTestId('bot-status')
    expect(status()).toHaveTextContent('Paused')
    expect(button('Resume')).toBeInTheDocument()
    expect(button('Pause')).not.toBeInTheDocument()
  })

  it('Stopped: no controls, explains, links to create a new bot', async () => {
    mockApi({ bot: { ...baseBot, enabled: false, deletedAt: '2026-11-19T00:00:00Z' } })
    renderPage()
    await screen.findByTestId('bot-status')
    expect(status()).toHaveTextContent('Stopped')
    for (const name of ['Pause', 'Resume', 'Edit', 'Stop']) expect(button(name)).not.toBeInTheDocument()
    expect(screen.getByText(/stopped and won’t place new orders/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create a new bot' })).toHaveAttribute('href', '/bots/new')
  })

  it('Error: running bot whose newest activity is an error shows the reason and keeps Pause', async () => {
    mockApi({
      events: [
        ev('e2', 'strategy_error', '2026-11-20T15:00:00Z', { ticker: 'SPY' }, 'Rule-based strategy failed: Unknown rule-based template'),
        ev('e1', 'signal_hold', '2026-11-20T14:00:00Z', { ticker: 'SPY' }),
      ],
    })
    renderPage()
    await screen.findByTestId('bot-status')
    expect(status()).toHaveTextContent('Error')
    expect(screen.getByTestId('error-banner')).toHaveTextContent('Strategy error')
    expect(button('Pause')).toBeInTheDocument()
  })

  it('an older error does not mark the bot as Error', async () => {
    mockApi({
      events: [
        ev('e2', 'signal_hold', '2026-11-20T15:00:00Z', { ticker: 'SPY' }),
        ev('e1', 'strategy_error', '2026-11-20T14:00:00Z', { ticker: 'SPY' }),
      ],
    })
    renderPage()
    await screen.findByTestId('bot-status')
    expect(status()).toHaveTextContent('Running')
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument()
  })
})

describe('Loading and failures', () => {
  it('shows not found for a 404', async () => {
    mockApi({ bot: apiError(404, 'NOT_FOUND') })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Bot not found' })).toBeInTheDocument()
    expect(button('Retry')).not.toBeInTheDocument()
  })

  it('offers retry when the bot fails to load', async () => {
    mockApi({ bot: apiError(500) })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Bot unavailable' })).toBeInTheDocument()
    mockApi()
    fireEvent.click(button('Retry'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Golden Cross' })).toBeInTheDocument()
  })

  it('shows the created confirmation after the wizard', async () => {
    mockApi()
    renderPage({ created: true })
    expect(await screen.findByText(/Your bot was created/)).toBeInTheDocument()
  })
})

describe('Capital and performance', () => {
  it('shows capital facts and never invents usage', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByTestId('capital-allocation')).toHaveTextContent('$1,000.00')
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    expect(screen.getByTestId('capital-in-use')).toHaveTextContent('Not available yet')
    expect(screen.getByText('$5,000.00')).toBeInTheDocument()
  })

  it('says performance is unavailable when the backend supplies none', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByTestId('performance-unavailable')).toHaveTextContent('isn’t available yet')
    expect(screen.queryByTestId('performance')).not.toBeInTheDocument()
    expect(screen.getByTestId('fill-summary')).toHaveTextContent('0 filled orders')
  })

  it('shows backend-supplied P/L', async () => {
    mockApi({ bot: { ...baseBot, performance: { realizedPnl: 120, unrealizedPnl: -20, fees: 1.5, asOf: '2026-11-20T16:00:00Z' } } })
    renderPage()
    const perf = await screen.findByTestId('performance')
    expect(perf).toHaveTextContent('+$100.00')
    expect(perf).toHaveTextContent('+$120.00')
    expect(perf).toHaveTextContent('−$20.00')
    expect(perf).toHaveTextContent('$1.50')
  })

  it('counts fills and costs from real executions only', async () => {
    mockApi({
      executions: [
        { id: 'x1', ticker: 'SPY', direction: 'buy', quantity: 2, filledQuantity: 2, status: 'filled', filledPrice: 500, fees: 0.25, commission: 0.75, createdAt: '2026-11-20T14:00:00Z', filledAt: '2026-11-20T14:00:02Z' },
        { id: 'x2', ticker: 'QQQ', direction: 'buy', quantity: 1, status: 'failed', cancelReason: 'insufficient buying power', fees: 0, commission: 0, createdAt: '2026-11-20T15:00:00Z' },
      ],
    })
    renderPage()
    expect(await screen.findByTestId('fill-summary')).toHaveTextContent('1 filled order · $1.00 in fees and commissions')
  })
})

describe('Activity timeline', () => {
  it('empty: says so, with a hint that depends on status', async () => {
    mockApi({ bot: { ...baseBot, enabled: false } })
    renderPage()
    expect(await screen.findByTestId('activity-empty')).toHaveTextContent('Resume the bot to start it.')
  })

  it('merges decisions and orders chronologically with plain explanations', async () => {
    mockApi({
      events: [
        ev('e3', 'execution_created', '2026-11-20T15:00:00Z', { ticker: 'SPY', executionId: 'x1', quantity: 2, direction: 'buy', confidence: 0.8, signal: 'buy' }),
        ev('e2', 'execution_skipped', '2026-11-20T14:30:00Z', { ticker: 'QQQ', reason: 'daily_loss_limit_reached' }),
        ev('e1', 'execution_skipped', '2026-11-20T14:00:00Z', { ticker: 'QQQ', reason: 'invalid_quantity' }),
      ],
      executions: [
        { id: 'x1', ticker: 'SPY', direction: 'buy', quantity: 2, filledQuantity: 2, status: 'filled', filledPrice: 501.25, fees: 0, commission: 0, createdAt: '2026-11-20T15:00:00Z', filledAt: '2026-11-20T15:00:03Z' },
      ],
    })
    renderPage()
    const items = within(await screen.findByTestId('timeline')).getAllByRole('listitem')
    expect(items.map((li) => li.querySelector('.timeline-title').textContent)).toEqual([
      'Bought 2 SPY',
      'Paper buy order placedSPY',
      'Blocked by a limitQQQ',
      'Skipped — order too smallQQQ',
    ])
    expect(items[0]).toHaveTextContent('at $501.25')
    expect(items[2]).toHaveTextContent('Today’s loss limit was reached')
    expect(items[3]).toHaveTextContent('too small to buy a single share')
    expect(items[2].className).toContain('timeline-item--risk')
  })

  it('collapses repeated routine checks', async () => {
    mockApi({
      events: [
        ev('a', 'signal_hold', '2026-11-20T15:02:00Z', { ticker: 'SPY' }),
        ev('b', 'signal_hold', '2026-11-20T15:01:00Z', { ticker: 'SPY' }),
        ev('c', 'signal_hold', '2026-11-20T15:00:00Z', { ticker: 'SPY' }),
      ],
    })
    renderPage()
    const items = within(await screen.findByTestId('timeline')).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Repeated 3 times')
  })

  it('keeps diagnostics behind an expandable Details control', async () => {
    mockApi({ events: [ev('e1', 'execution_failed', '2026-11-20T15:00:00Z', { ticker: 'SPY' }, 'Failed to create execution: deadlock')] })
    renderPage()
    const item = within(await screen.findByTestId('timeline')).getByRole('listitem')
    const details = item.querySelector('details')
    expect(details).not.toHaveAttribute('open')
    expect(within(details).getByText('Details')).toBeInTheDocument()
    expect(details).toHaveTextContent('Failed to create execution: deadlock')
  })

  it('shows orders and says so when the decision log is unavailable', async () => {
    mockApi({
      events: apiError(500),
      executions: [{ id: 'x1', ticker: 'SPY', direction: 'sell', quantity: 1, status: 'queued', createdAt: '2026-11-20T15:00:00Z' }],
    })
    renderPage()
    expect(await screen.findByTestId('events-unavailable')).toBeInTheDocument()
    expect(within(screen.getByTestId('timeline')).getByText('Paper sell order placed')).toBeInTheDocument()
  })

  it('says activity is unavailable (not empty) when both sources fail, with retry', async () => {
    mockApi({ events: apiError(500), executions: apiError(500) })
    renderPage()
    expect(await screen.findByTestId('activity-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('activity-empty')).not.toBeInTheDocument()
    mockApi()
    fireEvent.click(within(screen.getByTestId('activity-unavailable')).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('activity-empty')).toBeInTheDocument()
  })
})

describe('Controls', () => {
  it('Pause updates status after the server confirms', async () => {
    mockApi()
    put.mockResolvedValue({})
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/bots/bot_1', { enabled: false }))
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(status()).toHaveTextContent('Paused')
    expect(screen.getByText(/won’t place new orders until you resume/)).toBeInTheDocument()
  })

  it('failed Pause leaves the bot running and explains', async () => {
    mockApi()
    put.mockRejectedValue(apiError(500))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t pause this bot. Nothing changed')
    expect(status()).toHaveTextContent('Running')
  })

  it('Resume blocked without a paper account explains why', async () => {
    mockApi({ bot: { ...baseBot, enabled: false } })
    put.mockRejectedValue(apiError(403, 'BROKER_NOT_CONFIGURED'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('connect a paper trading account')
    expect(status()).toHaveTextContent('Paused')
  })

  it('Resume blocked for a live account says live trading is disabled', async () => {
    mockApi({ bot: { ...baseBot, enabled: false } })
    put.mockRejectedValue(apiError(403, 'LIVE_TRADING_DISABLED'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('live trading is disabled')
  })

  it('Stop asks for confirmation; Keep bot does nothing', async () => {
    mockApi()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    const dialog = screen.getByRole('dialog', { name: 'Stop Golden Cross?' })
    expect(dialog).toHaveTextContent('doesn’t cancel orders already sent')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep bot' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(del).not.toHaveBeenCalled()
  })

  it('Stop confirmed: DELETE, then Stopped with controls removed', async () => {
    mockApi()
    del.mockResolvedValue(null)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop bot' }))
    await waitFor(() => expect(del).toHaveBeenCalledWith('/bots/bot_1'))
    expect(await screen.findByText('Stopped. The bot won’t place new orders.')).toBeInTheDocument()
    expect(status()).toHaveTextContent('Stopped')
    expect(button('Pause')).not.toBeInTheDocument()
  })

  it('failed Stop keeps the sheet open with an error and the bot running', async () => {
    mockApi()
    del.mockRejectedValue(apiError(500))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop bot' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Couldn’t stop this bot')
    expect(status()).toHaveTextContent('Running')
  })

  it('Escape closes a sheet', async () => {
    mockApi()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Edit validates, saves name and limits, and updates the page', async () => {
    mockApi()
    put.mockResolvedValue({})
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit bot' })
    expect(within(dialog).getByLabelText('Simulated capital ($)')).toHaveValue('1000')
    fireEvent.change(within(dialog).getByLabelText('Max per buy order ($)'), { target: { value: '5000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('more than the simulated capital')
    expect(put).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText('Max per buy order ($)'), { target: { value: '300' } })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Cross v2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/bots/bot_1', {
      name: 'Cross v2',
      config: { ...baseBot.config, capitalMode: 'allocated', allocatedAmount: 1000, riskOnExposure: 1, maxOrderNotional: 300 },
    }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Cross v2' })).toBeInTheDocument()
    expect(screen.getByText('$300.00')).toBeInTheDocument()
  })

  it('failed Edit keeps the sheet open and changes nothing', async () => {
    mockApi()
    put.mockRejectedValue(apiError(500))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Nope' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Couldn’t save changes')
    expect(screen.getByRole('heading', { level: 1, name: 'Golden Cross' })).toBeInTheDocument()
  })
})

describe('Progressive disclosure', () => {
  it('loads rules only when technical details are opened', async () => {
    mockApi({ rules: [{ id: 'r1', name: 'Market hours', type: 'market_hours', enabled: true }] })
    renderPage()
    const details = (await screen.findByText('Strategy and technical details')).closest('details')
    expect(get.mock.calls.some(([p]) => p === '/bots/bot_1/rules')).toBe(false)
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(await within(details).findByTestId('rules-list')).toHaveTextContent('Market hours')
  })
})

describe('Adapter', () => {
  it('derives status', () => {
    expect(deriveStatus({ stopped: true, enabled: true })).toBe('stopped')
    expect(deriveStatus({ stopped: false, enabled: false }, [{ category: 'error' }])).toBe('paused')
    expect(deriveStatus({ stopped: false, enabled: true }, [{ category: 'error' }])).toBe('error')
    expect(deriveStatus({ stopped: false, enabled: true }, [])).toBe('running')
  })

  it('never surfaces the engine’s heuristic confidence (contract v2)', () => {
    const item = eventToItem(ev('e', 'execution_created', 'x', { ticker: 'SPY', direction: 'buy', confidence: 0.8 }))
    expect(item.diagnostics).not.toHaveProperty('confidence')
    expect(JSON.stringify(item)).not.toMatch(/0\.8|80%/)
  })

  it('keeps unknown event types instead of dropping them', () => {
    const item = eventToItem({ id: 'z', type: 'something_new', detail: 'hello', createdAt: 'x', metadata: {} })
    expect(item.category).toBe('other')
    expect(item.title).toBe('something new')
    expect(item.explanation).toBe('hello')
  })

  it('does not duplicate an order that has both an event and an execution', () => {
    const items = buildTimeline(
      [ev('e', 'execution_created', '2026-11-20T15:00:00Z', { executionId: 'x', ticker: 'SPY', side: 'buy' })],
      [normalizeExecution({ id: 'x', ticker: 'SPY', direction: 'buy', status: 'queued', createdAt: '2026-11-20T15:00:00Z' })]
    )
    expect(items.filter((i) => i.title.startsWith('Paper buy order placed'))).toHaveLength(1)
  })

  it('does not group different symbols', () => {
    const out = groupRepeats([
      { category: 'evaluation', title: 'Checked — no trade', symbol: 'SPY', at: '3' },
      { category: 'evaluation', title: 'Checked — no trade', symbol: 'QQQ', at: '2' },
    ])
    expect(out).toHaveLength(2)
  })

  it('treats empty performance objects as unavailable', () => {
    expect(normalizePerformance({})).toBeNull()
    expect(normalizePerformance(null)).toBeNull()
    expect(normalizePerformance({ realizedPnl: 0 })).toMatchObject({ realized: 0, total: null })
  })
})
