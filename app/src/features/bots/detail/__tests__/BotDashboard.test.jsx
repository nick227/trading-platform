import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { get, post, put, del } from '../../../../api/client'
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
  get.mockImplementation(async (path, params = {}) => {
    if (path === '/bots/bot_1') { if (bot instanceof Error) throw bot; return bot }
    if (path === '/bots/bot_1/events') {
      if (events instanceof Error) throw events
      // The page fetches routine skips and everything else separately.
      if (params.type === 'execution_skipped') return events.filter((e) => e.type === 'execution_skipped')
      if (params.exclude === 'execution_skipped') return events.filter((e) => e.type !== 'execution_skipped')
      return events
    }
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

const rows = async () => within(await screen.findByTestId('timeline')).getAllByRole('listitem').filter((li) => li.parentElement.dataset.testid === 'timeline')
const titleOf = (li) => li.querySelector('.tl-feed-title').textContent.replace(/\s+/g, ' ').trim()
const status = () => screen.getByTestId('bot-status')
const button = (name) => screen.queryByRole('button', { name })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Statuses', () => {
  it('Running: Pause, Edit (in the builder) and Stop are available', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Golden Cross' })).toBeInTheDocument()
    expect(status()).toHaveTextContent('Running')
    expect(button('Pause')).toBeInTheDocument()
    expect(button('Stop')).toBeInTheDocument()
    // Editing happens in one place: the Algorithm Builder.
    expect(screen.getByRole('link', { name: 'Edit bot' })).toHaveAttribute('href', '/bots/bot_1/edit')
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/bots/bot_1/edit')
    expect(screen.queryByRole('button', { name: 'Name & capital' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit rules' })).not.toBeInTheDocument()
    expect(screen.getByText('SPY, QQQ · Rule-based · $1,000 capital')).toBeInTheDocument()
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

describe('What has happened (capital and performance)', () => {
  const perf = { realizedPnl: 120, unrealizedPnl: -20, fees: 1.5, asOf: '2026-11-20T16:00:00Z' }

  it('before any trade: states the limits, never invents usage or P/L', async () => {
    mockApi()
    renderPage()
    expect(await screen.findByTestId('performance-unavailable')).toHaveTextContent('No trades yet. It may spend up to $1,000.00, at most $250.00 per order.')
    expect(screen.getByTestId('capital-allocation')).toHaveTextContent('$1,000.00')
    expect(screen.queryByTestId('performance')).not.toBeInTheDocument()
    expect(screen.queryByTestId('capital-in-use')).not.toBeInTheDocument()
    expect(screen.getByText('Up to $250 per order')).toBeInTheDocument()
  })

  it('shows backend-supplied P/L with its realized part', async () => {
    mockApi({ bot: { ...baseBot, performance: perf, capitalInUse: 640 } })
    renderPage()
    const box = await screen.findByTestId('performance')
    expect(box).toHaveTextContent('P&L+$100.00+$120.00 realized')
    expect(screen.getByTestId('capital-in-use')).toHaveTextContent('$640.00of $1,000.00')
  })

  it('with realized-only P/L (unrealized unknown), never shows a total', async () => {
    mockApi({ bot: { ...baseBot, performance: { realizedPnl: -12.5, unrealizedPnl: null, totalPnl: -12.5, fees: 0, asOf: '2026-11-20T16:00:00Z' }, capitalInUse: null } })
    renderPage()
    const box = await screen.findByTestId('performance')
    expect(box).toHaveTextContent('P&L—Waiting for a price')
    expect(box).not.toHaveTextContent('−$12.50')
    expect(screen.getByTestId('capital-in-use')).toHaveTextContent('—')
  })

  it('counts fills and costs from real executions only', async () => {
    mockApi({
      bot: { ...baseBot, performance: perf },
      executions: [
        { id: 'x1', ticker: 'SPY', direction: 'buy', quantity: 2, filledQuantity: 2, status: 'filled', filledPrice: 500, fees: 0.25, commission: 0.75, createdAt: '2026-11-20T14:00:00Z', filledAt: '2026-11-20T14:00:02Z' },
        { id: 'x2', ticker: 'QQQ', direction: 'buy', quantity: 1, status: 'failed', cancelReason: 'insufficient buying power', fees: 0, commission: 0, createdAt: '2026-11-20T15:00:00Z' },
      ],
    })
    renderPage()
    expect(await screen.findByTestId('fill-summary')).toHaveTextContent('1 fill$1.00 in fees')
  })

  it('lists open orders with a working Cancel', async () => {
    mockApi({ executions: [{ id: 'x9', ticker: 'SPY', direction: 'buy', quantity: 3, status: 'queued', createdAt: '2026-11-20T15:00:00Z' }] })
    post.mockResolvedValue({ id: 'x9', status: 'cancelled', cancelOutcome: 'cancelled' })
    renderPage()
    const pending = await screen.findByTestId('pending-orders')
    expect(pending).toHaveTextContent('Buy 3 SPY')
    fireEvent.click(within(pending).getByRole('button', { name: 'Cancel order' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/executions/x9/cancel', {}))
    expect(await screen.findByText('Order cancelled.')).toBeInTheDocument()
  })

  it('explains when an order can no longer be cancelled', async () => {
    mockApi({ executions: [{ id: 'x9', ticker: 'SPY', direction: 'buy', quantity: 3, status: 'submitted', createdAt: '2026-11-20T15:00:00Z' }] })
    post.mockRejectedValue(apiError(409, 'NOT_CANCELLABLE'))
    renderPage()
    fireEvent.click(within(await screen.findByTestId('pending-orders')).getByRole('button', { name: 'Cancel order' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too late to cancel')
  })
})

describe('Activity timeline', () => {
  it('empty: says so, with a hint that depends on status', async () => {
    mockApi({ bot: { ...baseBot, enabled: false } })
    renderPage()
    expect(await screen.findByTestId('activity-empty')).toHaveTextContent('Resume the bot to start it.')
  })

  it('shows each trade as one row with its decision trail; blocks and waits stay visible', async () => {
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
    const items = await rows()
    expect(items.map(titleOf)).toEqual(['Bought 2 SPY', 'Blocked by a limit · QQQ'])
    expect(items[0]).toHaveTextContent('at $501.25')
    // One disclosure per trade row; the full trail is inside it.
    expect(items[0]).not.toHaveTextContent('Buy order placed')
    fireEvent.click(within(items[0]).getByRole('button', { name: /Details/ }))
    expect(items[0]).toHaveTextContent('Buy order placed — 2 shares of SPY.')
    expect(items[1]).toHaveTextContent('Today’s loss limit was reached')
    expect(items[1].dataset.kind).toBe('risk')
    // The routine skip isn't dropped: it's counted and one click away.
    expect(screen.getByTestId('routine-summary')).toHaveTextContent('1 routine check without a trade (order too small)')
  })

  it('shows persisted pause/resume/stop lifecycle events', async () => {
    mockApi({
      events: [
        ev('l3', 'bot_resumed', '2026-11-20T15:10:00Z', { enabled: true, userId: 'u' }, 'Bot resumed'),
        ev('l2', 'bot_paused', '2026-11-20T15:05:00Z', { enabled: false, userId: 'u' }, 'Bot paused'),
        ev('l1', 'execution_skipped', '2026-11-20T15:00:00Z', { ticker: 'SPY', reason: 'market_closed' }, 'Rule blocked'),
      ],
    })
    renderPage()
    const items = await rows()
    expect(items.map(titleOf)).toEqual(['Resumed', 'Paused'])
    expect(items[0].dataset.kind).toBe('control')
    expect(status()).toHaveTextContent('Running')
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
    expect(await screen.findByTestId('routine-summary')).toHaveTextContent('3 routine checks without a trade')
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }))
    const items = await rows()
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('×3')
  })

  it('keeps an error’s raw detail behind an expandable Details control', async () => {
    mockApi({ events: [ev('e1', 'execution_failed', '2026-11-20T15:00:00Z', { ticker: 'SPY' }, 'Failed to create execution: deadlock')] })
    renderPage()
    const [item] = await rows()
    const toggle = within(item).getByRole('button', { name: 'Details' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(item).not.toHaveTextContent('deadlock')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(item).toHaveTextContent('Failed to create execution: deadlock')
  })

  it('shows orders and says so when the decision log is unavailable', async () => {
    mockApi({
      events: apiError(500),
      executions: [{ id: 'x1', ticker: 'SPY', direction: 'sell', quantity: 1, status: 'queued', createdAt: '2026-11-20T15:00:00Z' }],
    })
    renderPage()
    expect(await screen.findByTestId('events-unavailable')).toBeInTheDocument()
    expect((await rows()).map(titleOf)).toEqual(['Sell order placed · SPY'])
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




})

describe('Progressive disclosure', () => {
  it('loads rules only when technical details are opened', async () => {
    mockApi({ rules: [{ id: 'r1', name: 'Market hours', type: 'market_hours', enabled: true }] })
    renderPage()
    const toggle = await screen.findByRole('button', { name: 'Technical details' })
    expect(get.mock.calls.some(([p]) => p === '/bots/bot_1/rules')).toBe(false)
    fireEvent.click(toggle)
    expect(await screen.findByTestId('rules-list')).toHaveTextContent('Market hours')
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
    expect(items.filter((i) => i.title.startsWith('Buy order placed'))).toHaveLength(1)
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
