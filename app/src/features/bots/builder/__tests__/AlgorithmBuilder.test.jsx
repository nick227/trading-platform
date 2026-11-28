import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useParams, useLocation } from 'react-router-dom'
import { get, post, put } from '../../../../api/client'
import AlgorithmBuilder from '../AlgorithmBuilder'

vi.mock('../../../../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

const SIM = { connected: true, paper: true, simulated: true, mode: 'historical_replay', session: '2026-11-19' }
const authState = { brokerStatus: SIM }
vi.mock('../../../../app/AuthProvider', () => ({ useAuth: () => authState }))

const catalogTemplates = {
  ruleBased: [
    {
      id: 'tmpl_golden_cross',
      name: 'Golden Cross Hunter',
      botType: 'rule_based',
      description: 'Buys when the 50-day average crosses above the 200-day average.',
      config: { direction: 'buy', quantity: 10, tickers: ['SPY', 'QQQ', 'IWM'], allocatedAmount: 5000, maxOrderNotional: 1000 },
      rules: [
        { id: 'r1', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } },
        { id: 'r2', type: 'cooldown', config: { windowMs: 86400000 } },
        { id: 'r3', type: 'trend_filter', config: { symbol: 'SPY' } },
      ],
    },
    {
      id: 'tmpl_price',
      name: 'Price Threshold Buy',
      botType: 'rule_based',
      description: 'Buys when price rises above target.',
      config: { direction: 'buy', tickers: ['AAPL'], allocatedAmount: 3000, maxOrderNotional: 500 },
      rules: [
        { id: 'r_pt', type: 'price_threshold', config: { operator: 'above', price: 200 } },
      ],
    },
    {
      id: 'tmpl_alpha_research',
      name: 'Alpha Research Follower',
      botType: 'rule_based',
      description: 'Follows Alpha Engine signals.',
      config: {
        signalSource: 'alpha_research',
        direction: 'buy',
        tickers: ['SPY'],
        allocatedAmount: 5000,
        maxOrderNotional: 1000,
        research: { minConfidence: 0.6, maxPredictionAgeHours: 96, maxEntryDriftPct: 5, requireEdgeOverBaseline: true, tenantId: 'default' },
      },
      rules: [{ id: 'r_mkt', type: 'market_hours', config: {} }],
    },
  ],
  strategyBased: [],
}

function mockApi({
  catalog = catalogTemplates,
  account = { buying_power: 10000, cash: 10000 },
  portfolio = { id: 'pf_1' },
  bot = null,
  rules = [],
} = {}) {
  get.mockImplementation(async (path) => {
    if (path === '/bots/catalog') return catalog
    if (path === '/account') return account
    if (path === '/portfolios/default') return portfolio
    if (path.startsWith('/bots/') && path.endsWith('/rules')) return rules
    if (path.startsWith('/bots/')) {
      if (bot instanceof Error) throw bot
      if (bot) return bot
      throw { status: 404, message: 'Bot not found' }
    }
    throw new Error(`Unexpected GET ${path}`)
  })
}

function DestinationPage({ label }) {
  const { botId } = useParams()
  const location = useLocation()
  return (
    <div data-testid={`${label}-page`}>
      {label} {botId || ''} {location.state?.created ? 'created' : ''} {location.state?.updated ? 'updated' : ''}
    </div>
  )
}

function renderBuilder(entry = '/bots/new') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/bots/new" element={<AlgorithmBuilder />} />
        <Route path="/bots/:botId/edit" element={<AlgorithmBuilder />} />
        <Route path="/bots/:botId" element={<DestinationPage label="bot-detail" />} />
        <Route path="/bots" element={<DestinationPage label="bots-list" />} />
      </Routes>
    </MemoryRouter>
  )
}

function editField(label) {
  const field = screen.getByLabelText(label)
  const step = field.closest('[data-testid^="section-"]')
  const toggle = step?.querySelector('button[aria-expanded]')
  if (toggle?.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
  expect(field).toBeVisible()
  return field
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.brokerStatus = SIM
})

describe('Add Bot — simple strategy and stock configuration', () => {
  it('shows strategy, target stock, investment allocation, and real threshold without repeated text', async () => {
    mockApi()
    renderBuilder('/bots/new?template=tmpl_price')
    expect(await screen.findByRole('heading', { name: 'Add Bot' })).toBeInTheDocument()
    expect(screen.getByLabelText('Target stock')).toHaveValue('AAPL')
    expect(screen.getByLabelText('Trigger price ($)')).toHaveValue('200')
    expect(screen.getByLabelText('Amount to allocate ($)')).toHaveValue('3000')
    expect(screen.queryByLabelText('Bot name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Stock symbols')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review' })).not.toBeInTheDocument()
    expect(screen.queryByText(/These are the strategy’s current trigger values/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Increasing your allocation does not increase/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Other conditions and protections/)).not.toBeInTheDocument()
  })

  it('allows selecting a target stock from the account supported list and persists it', async () => {
    authState.brokerStatus = { ...SIM, tradableSymbols: ['SPY', 'MSFT', 'AAPL'] }
    mockApi()
    post.mockResolvedValue({ id: 'bot_new123' })
    renderBuilder('/bots/new?template=tmpl_price')
    const stock = await screen.findByLabelText('Target stock')
    expect(stock.tagName).toBe('SELECT')
    expect(stock).toHaveValue('AAPL')
    fireEvent.change(stock, { target: { value: 'MSFT' } })
    fireEvent.change(screen.getByLabelText('Trigger price ($)'), { target: { value: '215' } })
    fireEvent.change(screen.getByLabelText('Amount to allocate ($)'), { target: { value: '4000' } })
    fireEvent.click(screen.getByTestId('submit-builder-btn'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/bots/configuration', expect.objectContaining({
      name: 'Price Threshold Buy · MSFT',
      templateId: 'tmpl_price', portfolioId: 'pf_1', enabled: true,
      config: expect.objectContaining({
        tickers: ['MSFT'], allocatedAmount: 4000, maxOrderNotional: 500,
      }),
      rules: expect.arrayContaining([expect.objectContaining({
        type: 'price_threshold', config: { operator: 'above', price: 215 },
      })]),
    })))
    expect(await screen.findByTestId('bot-detail-page')).toHaveTextContent('bot_new123 created')
  })

  it('allows entering a custom stock when no supported account list is supplied', async () => {
    mockApi()
    post.mockResolvedValue({ id: 'bot_custom' })
    renderBuilder('/bots/new?template=tmpl_price')
    const stock = await screen.findByLabelText('Target stock')
    expect(stock.tagName).toBe('INPUT')
    fireEvent.change(stock, { target: { value: 'nvda' } })
    expect(stock).toHaveValue('NVDA')
    fireEvent.click(screen.getByTestId('submit-builder-btn'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/bots/configuration', expect.objectContaining({
      name: 'Price Threshold Buy · NVDA',
      config: expect.objectContaining({ tickers: ['NVDA'] }),
    })))
  })

  it('respects a valid stock deep link, but never selects a stock outside an advertised universe', async () => {
    authState.brokerStatus = { ...SIM, tradableSymbols: ['AAPL', 'MSFT'] }
    mockApi()
    const { unmount } = renderBuilder('/bots/new?template=tmpl_price&ticker=MSFT')
    expect(await screen.findByLabelText('Target stock')).toHaveValue('MSFT')
    unmount()
    renderBuilder('/bots/new?template=tmpl_price&ticker=ZZZZ')
    expect(await screen.findByLabelText('Target stock')).toHaveValue('AAPL')
  })

  it('resets the target to the selected strategy default when changing strategies', async () => {
    authState.brokerStatus = { ...SIM, tradableSymbols: ['SPY', 'AAPL', 'MSFT'] }
    mockApi()
    renderBuilder('/bots/new?template=tmpl_golden_cross')
    expect(await screen.findByLabelText('Target stock')).toHaveValue('SPY')
    fireEvent.change(screen.getByTestId('template-select'), { target: { value: 'tmpl_price' } })
    expect(screen.getByLabelText('Target stock')).toHaveValue('AAPL')
    expect(screen.getByLabelText('Trigger price ($)')).toHaveValue('200')
  })

  it('keeps visible validation for stock, capital and trigger thresholds', async () => {
    mockApi()
    renderBuilder('/bots/new?template=tmpl_price')
    const stock = await screen.findByLabelText('Target stock')
    fireEvent.change(stock, { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Trigger price ($)'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Amount to allocate ($)'), { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('submit-builder-btn'))
    expect(screen.getByText('Add at least one symbol.')).toBeInTheDocument()
    expect(screen.getByText('Enter the price that should trigger an order.')).toBeInTheDocument()
    expect(screen.getByText('Amount must be greater than $0.')).toBeInTheDocument()
    expect(stock).toHaveFocus()
    expect(post).not.toHaveBeenCalled()
  })

  it('retains actual research thresholds and independent evidence gate', async () => {
    mockApi()
    post.mockResolvedValue({ id: 'bot_research' })
    renderBuilder('/bots/new?template=tmpl_alpha_research')
    expect(await screen.findByLabelText('Minimum research score (0–100)')).toHaveValue('60')
    expect(screen.getByLabelText('Maximum research age (hours)')).toHaveValue('96')
    expect(screen.getByLabelText('Maximum price drift (%)')).toHaveValue('5')
    expect(screen.getByTestId('strategy-conditions')).toHaveTextContent('Only research that beat its baseline out of sample')
    fireEvent.change(screen.getByLabelText('Minimum research score (0–100)'), { target: { value: '150' } })
    fireEvent.click(screen.getByTestId('submit-builder-btn'))
    expect(screen.getByText('Use a score from 0 to 100.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Minimum research score (0–100)'), { target: { value: '45' } })
    fireEvent.click(screen.getByTestId('submit-builder-btn'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/bots/configuration', expect.objectContaining({
      config: expect.objectContaining({ research: expect.objectContaining({
        minConfidence: 0.45, requireEdgeOverBaseline: true,
      }) }),
    })))
  })

  it('shows prefilled strategy-specific conditions and updates them on every strategy change', async () => {
    mockApi()
    renderBuilder('/bots/new?template=tmpl_price')
    expect(await screen.findByTestId('strategy-behavior')).toHaveTextContent('Buys AAPL when the price rises above $200')
    expect(screen.getByLabelText('Trigger price ($)')).toHaveValue('200')
    fireEvent.change(screen.getByTestId('template-select'), { target: { value: 'tmpl_golden_cross' } })
    expect(screen.getByTestId('strategy-action')).toHaveTextContent('SPY trend is confirmed up')
    expect(screen.getByTestId('strategy-conditions')).toHaveTextContent('Regular market hours only')
    expect(screen.getByTestId('strategy-conditions')).toHaveTextContent('At most one trade per symbol per day')
    expect(screen.queryByText("Uses the template's preset trading conditions.")).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Trigger price ($)')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('template-select'), { target: { value: 'tmpl_alpha_research' } })
    expect(screen.getByTestId('strategy-action')).toHaveTextContent('Alpha Engine')
    expect(screen.getByLabelText('Minimum research score (0–100)')).toHaveValue('60')
    expect(screen.getByTestId('strategy-conditions')).toHaveTextContent('score ≥ 60')
    expect(screen.getByTestId('strategy-conditions')).toHaveTextContent('Only research that beat its baseline out of sample')
  })

  it('restores valid template defaults if users clear a populated setting and leave the field', async () => {
    mockApi()
    renderBuilder('/bots/new?template=tmpl_price')
    const trigger = await screen.findByLabelText('Trigger price ($)')
    fireEvent.change(trigger, { target: { value: '' } })
    fireEvent.blur(trigger)
    expect(trigger).toHaveValue('200')
    const capital = screen.getByLabelText('Amount to allocate ($)')
    fireEvent.change(capital, { target: { value: '' } })
    fireEvent.blur(capital)
    expect(capital).toHaveValue('3000')
    const ticker = screen.getByLabelText('Target stock')
    fireEvent.change(ticker, { target: { value: '' } })
    fireEvent.blur(ticker)
    expect(ticker).toHaveValue('AAPL')
  })

  it('explains allocated budget rather than an unexplained investment limit', async () => {
    mockApi()
    renderBuilder('/bots/new?template=tmpl_price')
    await screen.findByTestId('strategy-behavior')
    expect(screen.getByText(/Your budget for this bot/)).toBeInTheDocument()
    expect(screen.getByText(/Maximum for one trade: \$500/)).toBeInTheDocument()
  })

  it('retains account safety restrictions and paper-order confirmation', async () => {
    authState.brokerStatus = { connected: true, paper: true, simulated: false }
    mockApi()
    renderBuilder('/bots/new?template=tmpl_golden_cross')
    await screen.findByRole('heading', { name: 'Add Bot' })
    expect(screen.getByTestId('submit-builder-btn')).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand this bot will place orders automatically/ }))
    expect(screen.getByTestId('submit-builder-btn')).toBeEnabled()
  })

  it('blocks live account activation', async () => {
    authState.brokerStatus = { connected: true, paper: false, simulated: false }
    mockApi()
    renderBuilder('/bots/new?template=tmpl_price')
    expect(await screen.findByRole('heading', { name: 'Add Bot' })).toBeInTheDocument()
    expect(screen.getByText(/Real-money bot activation is not enabled yet/)).toBeInTheDocument()
    expect(screen.getByTestId('submit-builder-btn')).toBeDisabled()
  })

  it('shows backend validation errors without bypassing the API', async () => {
    mockApi()
    const error = new Error('HTTP 400')
    error.code = 'INVALID_CONFIG'
    error.details = { code: 'INVALID_CONFIG', field: 'allocatedAmount', message: 'Capital exceeds available funds.' }
    post.mockRejectedValue(error)
    renderBuilder('/bots/new?template=tmpl_price')
    await screen.findByRole('heading', { name: 'Add Bot' })
    fireEvent.click(screen.getByTestId('submit-builder-btn'))
    expect(await screen.findByTestId('submit-error')).toHaveTextContent('Capital exceeds available funds.')
    expect(screen.getAllByText('Capital exceeds available funds.')).toHaveLength(2)
  })
})

describe('Algorithm Builder — Editing Journey (/bots/:id/edit)', () => {
  const existingBot = {
    id: 'bot_live1',
    name: 'Momentum Scalper',
    enabled: true,
    deletedAt: null,
    direction: 'buy',
    updatedAt: '2026-11-22T23:30:00.000Z',
    allocation: 6000,
    maxPerOrder: 1200,
    tickers: ['NVDA', 'AMD'],
    config: {
      allocatedAmount: 6000,
      maxOrderNotional: 1200,
      tickers: ['NVDA', 'AMD'],
      direction: 'buy',
    },
    rules: [
      { id: 'r_pt', type: 'price_threshold', config: { operator: 'above', price: 140 } },
      { id: 'r_cd', type: 'cooldown', config: { windowMs: 14400000 } }, // 4 hours
      { id: 'r_pl', type: 'position_limit', config: { maxShares: 200 } },
      { id: 'r_dl', type: 'daily_loss', config: { maxLoss: 400 } },
      { id: 'r_tw', type: 'time_window', config: { start: '10:00', end: '15:30' } },
    ],
  }

  it('loads existing bot settings, sends expectedUpdatedAt, and saves updates atomically', async () => {
    mockApi({ bot: existingBot, rules: existingBot.rules })
    put.mockResolvedValue({ id: 'bot_live1', updatedAt: '2026-11-22T23:35:00.000Z' })

    renderBuilder('/bots/bot_live1/edit')

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Momentum Scalper' })).toBeInTheDocument()
    expect(screen.getByLabelText('Bot name')).toHaveValue('Momentum Scalper')
    expect(screen.getByLabelText('Symbols')).toHaveValue('NVDA, AMD')
    expect(screen.getByLabelText('Capital allocated')).toHaveValue('6000')
    expect(screen.getByLabelText('Max spend per order')).toHaveValue('1200')
    expect(screen.getByLabelText('Trigger price')).toHaveValue('140')

    expect(screen.getByText('Saved configuration')).toBeInTheDocument()

    // Modify capital, order limit, and trigger price
    fireEvent.change(editField('Capital allocated'), { target: { value: '8000' } })
    fireEvent.change(editField('Max spend per order'), { target: { value: '1500' } })
    fireEvent.change(editField('Trigger price'), { target: { value: '145' } })

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()
    const saveBtn = screen.getByTestId('submit-builder-btn')
    expect(saveBtn).toHaveTextContent('Save changes')
    fireEvent.click(saveBtn)

    await waitFor(() => expect(put).toHaveBeenCalled())

    // Check PUT /bots/bot_live1/configuration with expectedUpdatedAt and patch
    expect(put).toHaveBeenCalledWith('/bots/bot_live1/configuration', expect.objectContaining({
      expectedUpdatedAt: '2026-11-22T23:30:00.000Z',
      name: 'Momentum Scalper',
      config: expect.objectContaining({
        allocatedAmount: 8000,
        maxOrderNotional: 1500,
      }),
      rules: expect.arrayContaining([
        expect.objectContaining({
          id: 'r_pt',
          type: 'price_threshold',
          config: { operator: 'above', price: 145 },
        }),
      ]),
    }))

    // Navigation to bot detail with updated status
    expect(await screen.findByTestId('bot-detail-page')).toHaveTextContent('bot-detail bot_live1 updated')
  })

  it('handles 409 STALE_BOT without discarding draft, offering reload action and no blind overwrite', async () => {
    mockApi({ bot: existingBot, rules: existingBot.rules })
    const staleError = new Error('HTTP 409')
    staleError.code = 'STALE_BOT'
    staleError.details = { code: 'STALE_BOT', message: 'This bot changed since it was loaded.', updatedAt: '2026-11-22T23:45:00.000Z' }
    put.mockRejectedValueOnce(staleError)

    renderBuilder('/bots/bot_live1/edit')
    await screen.findByLabelText('Bot name')

    fireEvent.change(editField('Capital allocated'), { target: { value: '9000' } })
    fireEvent.click(screen.getByTestId('submit-builder-btn'))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    // Verify expectedUpdatedAt was sent (no blind submission)
    expect(put.mock.calls[0][1].expectedUpdatedAt).toBe('2026-11-22T23:30:00.000Z')

    // Stale notice appears
    const staleNotice = await screen.findByTestId('stale-bot-notice')
    expect(staleNotice).toBeInTheDocument()
    expect(staleNotice).toHaveTextContent(/changed since you opened it/)

    // User draft is NOT discarded: value 9000 remains in the input
    expect(screen.getByLabelText('Capital allocated')).toHaveValue('9000')

    // Blind overwrite button is REMOVED (Correction 2)
    expect(screen.queryByTestId('overwrite-btn')).not.toBeInTheDocument()

    // Reload action is available
    const reloadBtn = screen.getByTestId('reload-btn')
    expect(reloadBtn).toBeInTheDocument()

    // Another window changed the per-order limit (a field this user didn't touch)
    const freshBot = {
      ...existingBot,
      updatedAt: '2026-11-22T23:45:00.000Z',
      maxPerOrder: 1800,
      config: { ...existingBot.config, maxOrderNotional: 1800 },
    }
    mockApi({ bot: freshBot, rules: existingBot.rules })

    fireEvent.click(reloadBtn)

    // Rebased: the other window's change is shown, the user's edit is kept, warning cleared
    await waitFor(() => {
      expect(screen.queryByTestId('stale-bot-notice')).not.toBeInTheDocument()
    })
    await waitFor(() => expect(screen.getByLabelText('Max spend per order')).toHaveValue('1800'))
    expect(screen.getByLabelText('Capital allocated')).toHaveValue('9000')

    // Saving again sends only the user's edit, guarded by the new version
    put.mockResolvedValueOnce({ ...freshBot, updatedAt: '2026-11-22T23:50:00.000Z' })
    fireEvent.click(screen.getByTestId('submit-builder-btn'))
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(put.mock.calls[1][1].expectedUpdatedAt).toBe('2026-11-22T23:45:00.000Z')
    expect(put.mock.calls[1][1].config).toEqual({ allocatedAmount: 9000 })
  })

  it('clicking Cancel navigates back to bot detail without saving', async () => {
    mockApi({ bot: existingBot, rules: existingBot.rules })
    renderBuilder('/bots/bot_live1/edit')

    await screen.findByRole('heading', { level: 1, name: 'Edit Momentum Scalper' })
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }))

    expect(await screen.findByTestId('bot-detail-page')).toHaveTextContent('bot-detail bot_live1')
    expect(put).not.toHaveBeenCalled()
  })

  it('stopped bot cannot be edited', async () => {
    mockApi({ bot: { ...existingBot, deletedAt: '2026-11-20T00:00:00Z' } })
    renderBuilder('/bots/bot_live1/edit')

    expect(await screen.findByText(/stopped and cannot be edited/)).toBeInTheDocument()
    expect(screen.queryByTestId('submit-builder-btn')).not.toBeInTheDocument()
  })
})
