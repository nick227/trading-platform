import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useParams, useLocation } from 'react-router-dom'
import { get, post, put } from '../../../../api/client'
import NewBotWizard from '../NewBotWizard'
import {
  parseSymbols,
  validateAllocation,
  validateControls,
  defaultCapital,
  normalizeTemplate,
  createAndStartBot,
} from '../newBotApi'

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

const SIM = { connected: true, paper: true, simulated: true, mode: 'historical_replay', session: '2026-11-19' }
const authState = { brokerStatus: SIM }
vi.mock('../../../../app/AuthProvider', () => ({ useAuth: () => authState }))

const templates = {
  ruleBased: [
    {
      id: 'tmpl_golden_cross', name: 'Golden Cross Hunter', botType: 'rule_based',
      description: 'Buys when the 50-day average crosses above the 200-day average.',
      config: { direction: 'buy', quantity: 10, tickers: ['SPY', 'QQQ', 'IWM'] },
      rules: [{ type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } }, { type: 'cooldown', config: { windowMs: 86400000 } }],
    },
    {
      id: 'tmpl_momentum_buy', name: 'Momentum Buy', botType: 'rule_based',
      description: 'Buys on upward momentum.',
      config: { direction: 'buy', quantity: 1, tickers: [] },
      rules: [],
    },
  ],
  strategyBased: [
    { id: 'tmpl_strategy_signal', name: 'Strategy Signal', botType: 'strategy_based', description: 'Follows a strategy.', config: { direction: 'buy', tickers: [] }, rules: [] },
  ],
}

function apiError(status, code) {
  const e = new Error(`HTTP ${status}: x`)
  e.status = status
  e.code = code
  return e
}

function mockGets({ catalog = templates, account = { buying_power: 5000, cash: 5000 }, portfolio = { id: 'pf_1' } } = {}) {
  get.mockImplementation(async (path) => {
    if (path === '/bots/catalog') { if (catalog instanceof Error) throw catalog; return catalog }
    if (path === '/account') { if (account instanceof Error) throw account; return account }
    if (path === '/portfolios/default') { if (portfolio instanceof Error) throw portfolio; return portfolio }
    throw new Error(`unexpected GET ${path}`)
  })
}

function BotPage() {
  const { botId } = useParams()
  const location = useLocation()
  return <div data-testid="bot-page">bot {botId} {location.state?.created ? 'created' : ''}</div>
}

function renderWizard(entry = '/bots/new') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/bots/new" element={<NewBotWizard />} />
        <Route path="/bots/:botId" element={<BotPage />} />
        <Route path="/bots" element={<div>bots list</div>} />
      </Routes>
    </MemoryRouter>
  )
}

const continueBtn = () => screen.getByRole('button', { name: 'Continue' })
const startBtn = () => screen.getByRole('button', { name: 'Start bot' })
const heading = () => screen.getByRole('heading', { level: 1 })

const priced = {
  id: 'tmpl_price', name: 'Momentum Buy', botType: 'rule_based', description: '',
  config: { direction: 'buy', tickers: ['SPY'], allocatedAmount: 5000, maxOrderNotional: 1000 },
  rules: [
    { name: 'Market Hours', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } },
    { name: 'Price Above Threshold', type: 'price_threshold', config: { operator: 'above', direction: 'above', price: 0 } },
    { name: 'Cooldown', type: 'cooldown', config: { windowMs: 3_600_000 } },
  ],
}
const research = {
  id: 'tmpl_alpha_research', name: 'Alpha Research Follower', botType: 'rule_based', description: '',
  config: { signalSource: 'alpha_research', tickers: ['SPY'], allocatedAmount: 5000, maxOrderNotional: 1000, research: { minConfidence: 0.6, maxPredictionAgeHours: 96, maxEntryDriftPct: 5, tenantId: 'default' } },
  rules: [{ name: 'Market Hours', type: 'market_hours', config: {} }],
}

async function toSetup(id = 'tmpl_golden_cross') {
  fireEvent.click(await screen.findByTestId(`template-${id}`))
  fireEvent.click(continueBtn())
  expect(heading()).toHaveTextContent('Symbols & capital')
}
async function toRules(id) {
  await toSetup(id)
  fireEvent.click(continueBtn())
  expect(heading()).toHaveTextContent('Rules & start')
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.brokerStatus = SIM
})

describe('Step 1 — choose a starting point', () => {
  it('describes each starting point in plain language, without performance figures', async () => {
    mockGets()
    renderWizard()
    expect(await screen.findByText('Golden Cross Hunter')).toBeInTheDocument()
    expect(heading()).toHaveTextContent('Choose a starting point')
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()
    expect(screen.getByTestId('template-tmpl_golden_cross')).toHaveTextContent('Buys a stock you choose')
    expect(document.body.textContent).not.toMatch(/win rate|return|%/i)
  })

  it('requires a selection, and strategy-based templates can’t be chosen', async () => {
    mockGets()
    renderWizard()
    await screen.findByText('Golden Cross Hunter')
    expect(continueBtn()).toBeDisabled()
    expect(screen.getByTestId('template-tmpl_strategy_signal')).toBeDisabled()
    fireEvent.click(screen.getByTestId('template-tmpl_golden_cross'))
    expect(continueBtn()).toBeEnabled()
  })

  it('starts at Symbols & capital when a starting point is preselected (from Bots)', async () => {
    mockGets()
    renderWizard('/bots/new?template=tmpl_golden_cross')
    expect(await screen.findByRole('heading', { level: 1, name: 'Symbols & capital' })).toBeInTheDocument()
    expect(screen.getByText('Golden Cross Hunter')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(heading()).toHaveTextContent('Choose a starting point')
  })

  it('can’t skip ahead through the URL', async () => {
    mockGets()
    renderWizard('/bots/new?step=rules')
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose a starting point' })).toBeInTheDocument()
  })

  it('offers a retry when the catalog fails', async () => {
    mockGets({ catalog: apiError(500) })
    renderWizard()
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t load')
  })
})

describe('Step 2 — symbols & capital', () => {
  it('prefills symbols, capital, per-order limit and a distinguishing name', async () => {
    mockGets()
    renderWizard()
    await toSetup()
    expect(screen.getByLabelText('Symbols')).toHaveValue('SPY, QQQ, IWM')
    expect(screen.getByLabelText('Simulated capital for this bot')).toHaveValue('1000')
    expect(screen.getByLabelText('Bot name')).toHaveValue('Golden Cross Hunter · SPY')
    expect(screen.getByTestId('buying-power')).toHaveTextContent('Simulated cash available: $5,000.00')
  })

  it('keeps a symbol chosen before the bot (Build a bot for AAPL)', async () => {
    mockGets()
    renderWizard('/bots/new?ticker=AAPL')
    await toSetup()
    expect(screen.getByLabelText('Symbols')).toHaveValue('AAPL')
    expect(screen.getByLabelText('Bot name')).toHaveValue('Golden Cross Hunter · AAPL')
  })

  it('validates symbols, capital and the per-order limit before continuing', async () => {
    mockGets()
    renderWizard()
    await toSetup()
    fireEvent.change(screen.getByLabelText('Symbols'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Simulated capital for this bot'), { target: { value: '9000' } })
    fireEvent.click(continueBtn())
    expect(heading()).toHaveTextContent('Symbols & capital')
    expect(screen.getByText('Add at least one symbol for this bot to trade.')).toBeInTheDocument()
    expect(screen.getByText('That’s more than the cash available in your account.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Symbols'), { target: { value: 'aapl, msft' } })
    fireEvent.change(screen.getByLabelText('Simulated capital for this bot'), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText('Most it can spend on one order'), { target: { value: '900' } })
    fireEvent.click(continueBtn())
    expect(screen.getByText('Can’t be more than the bot’s simulated capital.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Most it can spend on one order'), { target: { value: '250' } })
    fireEvent.click(continueBtn())
    expect(heading()).toHaveTextContent('Rules & start')
    expect(screen.getByTestId('bot-preview')).toHaveTextContent('Buys AAPL, MSFT')
  })

  it('blocks an account with no cash', async () => {
    mockGets({ account: { buying_power: 0, cash: 0 } })
    renderWizard()
    await toSetup()
    expect(screen.getByRole('alert')).toHaveTextContent('no cash available')
    expect(continueBtn()).toBeDisabled()
  })
})

describe('Step 3 — rules & start', () => {
  it('requires a trigger price, then creates the bot paused with its rules and starts it (no checkbox in simulated mode)', async () => {
    mockGets({ catalog: { ruleBased: [priced], strategyBased: [] } })
    post.mockResolvedValue({ id: 'bot_7' })
    put.mockResolvedValue({})
    renderWizard()
    await toRules('tmpl_price')
    expect(screen.queryByRole('checkbox', { name: /I understand/ })).not.toBeInTheDocument()
    fireEvent.click(startBtn())
    expect(screen.getByText('Enter the price that should trigger an order.')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Trigger price'), { target: { value: '725' } })
    expect(screen.getByTestId('bot-preview')).toHaveTextContent('Buys SPY when the price rises above $725.')
    expect(screen.getByTestId('review-summary')).toHaveTextContent('Simulated money — fills replay the Nov 19 close; no broker orders.')
    fireEvent.click(startBtn())
    expect(await screen.findByTestId('bot-page')).toHaveTextContent('bot bot_7 created')
    const body = post.mock.calls[0][1]
    expect(post.mock.calls[0][0]).toBe('/bots/catalog/from-template')
    expect(body).toMatchObject({ templateId: 'tmpl_price', tickers: ['SPY'], allocatedAmount: 5000, maxOrderNotional: 1000, enabled: false })
    expect(body.rules).toEqual([
      { name: 'Price Above Threshold', type: 'price_threshold', config: { operator: 'above', direction: 'above', price: 725 } },
      { name: 'Market Hours', type: 'market_hours', config: { allowPremarket: false, allowAfterHours: false } },
      { name: 'Cooldown', type: 'cooldown', config: { windowMs: 3_600_000 } },
    ])
    expect(put).toHaveBeenCalledWith('/bots/bot_7', { enabled: true })
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0])
  })

  it('lets the user add and remove limits before starting', async () => {
    mockGets({ catalog: { ruleBased: [priced], strategyBased: [] } })
    post.mockResolvedValue({ id: 'bot_8' }); put.mockResolvedValue({})
    renderWizard()
    await toRules('tmpl_price')
    fireEvent.change(screen.getByLabelText('Trigger price'), { target: { value: '700' } })
    fireEvent.click(screen.getByLabelText('At most one trade per symbol every'))
    fireEvent.click(screen.getByLabelText('Stop for the day once the account has realized a loss of'))
    fireEvent.change(screen.getByLabelText('Daily loss limit in dollars'), { target: { value: '300' } })
    fireEvent.click(startBtn())
    await screen.findByTestId('bot-page')
    expect(post.mock.calls[0][1].rules.map((r) => r.type)).toEqual(['price_threshold', 'market_hours', 'daily_loss'])
  })

  it('research starting point: score (not a probability), age, drift and the edge requirement are editable', async () => {
    mockGets({ catalog: { ruleBased: [research], strategyBased: [] } })
    post.mockResolvedValue({ id: 'bot_9' }); put.mockResolvedValue({})
    renderWizard()
    await toRules('tmpl_alpha_research')
    expect(screen.getByLabelText('Minimum research score')).toHaveValue('60')
    expect(screen.getByText('(0–100; a score, not a probability)')).toBeInTheDocument()
    expect(screen.getByLabelText(/Only research whose holdout beat the always-up baseline/)).toBeChecked()
    fireEvent.change(screen.getByLabelText('Minimum research score'), { target: { value: '150' } })
    fireEvent.click(startBtn())
    expect(screen.getByText('Use a score from 0 to 100.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Minimum research score'), { target: { value: '45' } })
    fireEvent.click(screen.getByLabelText(/Only research whose holdout beat the always-up baseline/))
    fireEvent.click(startBtn())
    await screen.findByTestId('bot-page')
    expect(post.mock.calls[0][1].config.research).toEqual({ minConfidence: 0.45, maxPredictionAgeHours: 96, maxEntryDriftPct: 5, requireEdgeOverBaseline: false, tenantId: 'default' })
  })

  it('outside the simulator, asks for explicit confirmation before placing paper orders', async () => {
    authState.brokerStatus = { connected: true, paper: true }
    mockGets()
    renderWizard()
    await toRules()
    expect(startBtn()).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }))
    expect(startBtn()).toBeEnabled()
  })

  it('explains when the bot was created but couldn’t be started', async () => {
    mockGets()
    post.mockResolvedValue({ id: 'bot_5' })
    put.mockRejectedValue(apiError(500))
    renderWizard()
    await toRules()
    fireEvent.click(startBtn())
    expect(await screen.findByTestId('submit-error')).toHaveTextContent('so it’s paused')
    expect(screen.getByRole('link', { name: 'Open the bot' })).toHaveAttribute('href', '/bots/bot_5')
  })

  it('shows the server’s reason when it rejects the settings', async () => {
    mockGets()
    const e = apiError(400, 'INVALID_CONFIG'); e.serverMessage = 'Trigger price must be greater than 0.'
    post.mockRejectedValue(e)
    renderWizard()
    await toRules()
    fireEvent.click(startBtn())
    expect(await screen.findByTestId('submit-error')).toHaveTextContent('Trigger price must be greater than 0.')
  })
})

describe('Account restrictions', () => {
  it('without a paper account: explains, links to Account, and won’t start', async () => {
    authState.brokerStatus = { connected: false }
    mockGets()
    renderWizard()
    expect(await screen.findByTestId('mode-notice')).toHaveTextContent('Connect a paper trading account')
    expect(screen.getByRole('link', { name: 'Account settings' })).toHaveAttribute('href', '/profile')
    await toRules()
    expect(startBtn()).toBeDisabled()
  })
})

describe('newBotApi helpers', () => {
  it('parses symbols', () => {
    expect(parseSymbols('aapl, msft  aapl\nbrk.b')).toEqual(['AAPL', 'MSFT', 'BRK.B'])
    expect(parseSymbols('')).toEqual([])
  })

  it('validates allocation', () => {
    expect(validateAllocation({ capital: '100' }, { buyingPower: 50, templateTickers: ['SPY'] }).capital).toMatch(/cash available/)
    expect(validateAllocation({ capital: '100' }, { buyingPower: null, templateTickers: ['SPY'] })).toEqual({})
    expect(validateAllocation({ capital: 'abc' }, { buyingPower: null, templateTickers: ['SPY'] }).capital).toMatch(/valid/)
    expect(validateAllocation({ capital: '10', symbolsText: '$$$' }, { buyingPower: null, templateTickers: [] }).symbols).toMatch(/ticker symbols/)
  })

  it('validates controls', () => {
    expect(validateControls({ maxPerOrder: '50', name: 'x' }, { capital: 100 })).toEqual({})
    expect(validateControls({ maxPerOrder: '150', name: 'x' }, { capital: 100 }).maxPerOrder).toBeTruthy()
  })

  it('uses template capital defaults when present', () => {
    expect(defaultCapital({ config: { allocatedAmount: 10000 } }, 4000)).toBe(4000)
    expect(defaultCapital({ config: {} }, null)).toBe(1000)
  })

  it('marks only rule-based templates as available', () => {
    expect(normalizeTemplate({ id: 'a', botType: 'rule_based' }).available).toBe(true)
    expect(normalizeTemplate({ id: 'b', botType: 'strategy_based' }).available).toBe(false)
  })

  it('reports a missing bot id instead of claiming success', async () => {
    post.mockResolvedValue({})
    const r = await createAndStartBot({ template: { id: 't' }, portfolioId: 'p', name: 'n', tickers: ['SPY'], capital: 1, maxPerOrder: 1 })
    expect(r.ok).toBe(false)
    expect(put).not.toHaveBeenCalled()
  })
})

