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

const authState = { brokerStatus: { connected: true, paper: true } }
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
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back' }))
const heading = () => screen.getByRole('heading', { level: 1 })

async function chooseGoldenCross() {
  fireEvent.click(await screen.findByTestId('template-tmpl_golden_cross'))
  fireEvent.click(continueBtn())
  expect(heading()).toHaveTextContent('Simulated capital')
}

async function walkToReview() {
  await chooseGoldenCross()
  fireEvent.click(continueBtn())
  expect(heading()).toHaveTextContent('Controls')
  fireEvent.click(continueBtn())
  expect(heading()).toHaveTextContent('Review & start')
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.brokerStatus = { connected: true, paper: true }
})

describe('Step 1 — choose a bot', () => {
  it('lists templates factually, without performance figures', async () => {
    mockGets()
    renderWizard()
    expect(await screen.findByText('Golden Cross Hunter')).toBeInTheDocument()
    expect(heading()).toHaveTextContent('Choose a bot')
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    const card = screen.getByTestId('template-tmpl_golden_cross')
    expect(card).toHaveTextContent('Buy orders only')
    expect(card).toHaveTextContent('Trades SPY, QQQ, IWM')
    expect(screen.getByTestId('template-tmpl_momentum_buy')).toHaveTextContent('You choose the symbols')
    expect(document.body.textContent).not.toMatch(/win rate|return|%/i)
  })

  it('requires a selection before continuing', async () => {
    mockGets()
    renderWizard()
    await screen.findByText('Golden Cross Hunter')
    expect(continueBtn()).toBeDisabled()
    fireEvent.click(screen.getByTestId('template-tmpl_golden_cross'))
    expect(screen.getByTestId('template-tmpl_golden_cross')).toHaveAttribute('aria-checked', 'true')
    expect(continueBtn()).toBeEnabled()
  })

  it('shows strategy-based bots as unavailable and not selectable', async () => {
    mockGets()
    renderWizard()
    const card = await screen.findByTestId('template-tmpl_strategy_signal')
    expect(card).toBeDisabled()
    expect(card).toHaveTextContent('Not available yet')
    fireEvent.click(card)
    expect(continueBtn()).toBeDisabled()
  })

  it('handles a failed catalog request with a retry', async () => {
    mockGets({ catalog: new Error('HTTP 500') })
    renderWizard()
    expect(await screen.findByText(/couldn’t load the bot catalog/)).toBeInTheDocument()
    mockGets()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Golden Cross Hunter')).toBeInTheDocument()
  })

  it('handles an empty catalog', async () => {
    mockGets({ catalog: { ruleBased: [], strategyBased: [] } })
    renderWizard()
    expect(await screen.findByText('No bots are available right now.')).toBeInTheDocument()
  })

  it('preselects a template from ?template=', async () => {
    mockGets()
    renderWizard('/bots/new?template=tmpl_golden_cross')
    expect(await screen.findByTestId('template-tmpl_golden_cross')).toHaveAttribute('aria-checked', 'true')
  })

  it('does not let a deep link skip ahead of incomplete steps', async () => {
    mockGets()
    renderWizard('/bots/new?step=review')
    await screen.findByText('Golden Cross Hunter')
    expect(heading()).toHaveTextContent('Choose a bot')
  })
})

describe('Step 2 — simulated capital', () => {
  it('defaults to a transparent amount and shows paper buying power', async () => {
    mockGets()
    renderWizard()
    await chooseGoldenCross()
    expect(screen.getByLabelText('Simulated capital for this bot')).toHaveValue('1000')
    expect(screen.getByTestId('buying-power')).toHaveTextContent('$5,000.00')
    expect(screen.getByText(/isn’t set aside/)).toBeInTheDocument()
  })

  it('caps the default at available buying power', async () => {
    mockGets({ account: { buying_power: 300 } })
    renderWizard()
    await chooseGoldenCross()
    expect(screen.getByLabelText('Simulated capital for this bot')).toHaveValue('300')
  })

  it('rejects amounts above buying power or zero', async () => {
    mockGets()
    renderWizard()
    await chooseGoldenCross()
    const input = screen.getByLabelText('Simulated capital for this bot')
    fireEvent.change(input, { target: { value: '9000' } })
    fireEvent.click(continueBtn())
    expect(screen.getByRole('alert')).toHaveTextContent('more than your paper buying power')
    expect(heading()).toHaveTextContent('Simulated capital')
    fireEvent.change(input, { target: { value: '0' } })
    expect(screen.getByRole('alert')).toHaveTextContent('greater than $0')
  })

  it('requires symbols when the template has none', async () => {
    mockGets()
    renderWizard()
    fireEvent.click(await screen.findByTestId('template-tmpl_momentum_buy'))
    fireEvent.click(continueBtn())
    fireEvent.click(continueBtn())
    expect(screen.getByText('Add at least one symbol for this bot to trade.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Symbols to trade'), { target: { value: 'aapl, msft' } })
    fireEvent.click(continueBtn())
    expect(heading()).toHaveTextContent('Controls')
    expect(screen.getByText(/in AAPL, MSFT/)).toBeInTheDocument()
  })

  it('blocks an empty paper account', async () => {
    mockGets({ account: { buying_power: 0 } })
    renderWizard()
    await chooseGoldenCross()
    expect(screen.getByText(/no buying power/)).toBeInTheDocument()
    expect(continueBtn()).toBeDisabled()
  })

  it('shows buying power as unavailable when the account request fails', async () => {
    mockGets({ account: new Error('HTTP 502') })
    renderWizard()
    await chooseGoldenCross()
    expect(screen.getByTestId('buying-power')).toHaveTextContent('—')
    expect(screen.getByTestId('buying-power')).toHaveTextContent('unavailable')
  })
})

describe('Step 3 — controls', () => {
  it('defaults max per order to the capital and validates it', async () => {
    mockGets()
    renderWizard()
    await chooseGoldenCross()
    fireEvent.click(continueBtn())
    const max = screen.getByLabelText('Maximum per buy order')
    expect(max).toHaveValue('1000')
    expect(screen.getByText(/Pausing stops new orders/)).toBeInTheDocument()
    fireEvent.change(max, { target: { value: '1500' } })
    fireEvent.click(continueBtn())
    expect(screen.getByRole('alert')).toHaveTextContent('more than the bot’s simulated capital')
    expect(heading()).toHaveTextContent('Controls')
  })

  it('keeps technical settings under Advanced, with readable template rules', async () => {
    mockGets()
    renderWizard()
    await chooseGoldenCross()
    fireEvent.click(continueBtn())
    const advanced = screen.getByText('Advanced settings').closest('details')
    expect(advanced).not.toHaveAttribute('open')
    expect(within(advanced).getByLabelText('Bot name')).toHaveValue('Golden Cross Hunter')
    expect(within(advanced).getByText('Trades only during regular market hours')).toBeInTheDocument()
    expect(within(advanced).getByText('Waits 1 day(s) between trades in a symbol')).toBeInTheDocument()
  })

  it('requires a bot name', async () => {
    mockGets()
    renderWizard()
    await chooseGoldenCross()
    fireEvent.click(continueBtn())
    fireEvent.change(screen.getByLabelText('Bot name'), { target: { value: '  ' } })
    fireEvent.click(continueBtn())
    expect(screen.getByText('Give your bot a name.')).toBeInTheDocument()
  })
})

describe('Back navigation', () => {
  it('preserves inputs across every step', async () => {
    mockGets()
    renderWizard()
    await chooseGoldenCross()
    fireEvent.change(screen.getByLabelText('Simulated capital for this bot'), { target: { value: '2500' } })
    fireEvent.click(continueBtn())
    expect(screen.getByLabelText('Maximum per buy order')).toHaveValue('2500')
    fireEvent.change(screen.getByLabelText('Maximum per buy order'), { target: { value: '400' } })
    fireEvent.change(screen.getByLabelText('Bot name'), { target: { value: 'My cross bot' } })
    fireEvent.click(continueBtn())
    fireEvent.click(screen.getByRole('checkbox'))

    back()
    expect(heading()).toHaveTextContent('Controls')
    expect(screen.getByLabelText('Maximum per buy order')).toHaveValue('400')
    expect(screen.getByLabelText('Bot name')).toHaveValue('My cross bot')
    back()
    expect(screen.getByLabelText('Simulated capital for this bot')).toHaveValue('2500')
    back()
    expect(screen.getByTestId('template-tmpl_golden_cross')).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(continueBtn())
    fireEvent.click(continueBtn())
    fireEvent.click(continueBtn())
    expect(screen.getByTestId('review-summary')).toHaveTextContent('My cross bot')
    expect(screen.getByTestId('review-summary')).toHaveTextContent('$400.00')
  })

  it('resets template-specific defaults when a different bot is chosen', async () => {
    mockGets()
    renderWizard()
    await chooseGoldenCross()
    fireEvent.click(continueBtn())
    back()
    back()
    fireEvent.click(screen.getByTestId('template-tmpl_momentum_buy'))
    fireEvent.click(continueBtn())
    expect(screen.getByLabelText('Symbols to trade')).toBeInTheDocument()
  })
})

describe('Step 4 — review & start', () => {
  it('summarizes the configuration and requires explicit confirmation', async () => {
    mockGets()
    renderWizard()
    await walkToReview()
    const summary = screen.getByTestId('review-summary')
    expect(summary).toHaveTextContent('Paper trading (simulated money)')
    expect(summary).toHaveTextContent('SPY, QQQ, IWM')
    expect(summary).toHaveTextContent('$1,000.00')
    expect(summary).toHaveTextContent('not set aside')
    const start = screen.getByRole('button', { name: 'Start paper trading' })
    expect(start).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(start).toBeEnabled()
  })

  it('creates the bot atomically (paused, with limits), then activates it and opens its page', async () => {
    mockGets()
    post.mockResolvedValue({ id: 'bot_9', enabled: false, config: { direction: 'buy', tickers: ['SPY', 'QQQ', 'IWM'], allocatedAmount: 1000, maxOrderNotional: 1000 } })
    put.mockResolvedValue({ id: 'bot_9', enabled: true })
    renderWizard()
    await walkToReview()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Start paper trading' }))

    expect(await screen.findByTestId('bot-page')).toHaveTextContent('bot bot_9 created')
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/bots/catalog/from-template', {
      templateId: 'tmpl_golden_cross', portfolioId: 'pf_1', name: 'Golden Cross Hunter', tickers: ['SPY', 'QQQ', 'IWM'],
      capitalMode: 'allocated', allocatedAmount: 1000, maxOrderNotional: 1000, riskOnExposure: 1, enabled: false,
    })
    // Activation is a separate, explicit step carrying only the state change.
    expect(put).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith('/bots/bot_9', { enabled: true })
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0])
  })

  it('maps a server-side config rejection', async () => {
    mockGets()
    post.mockRejectedValue(apiError(400, 'INVALID_CONFIG'))
    renderWizard()
    await walkToReview()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Start paper trading' }))
    expect(await screen.findByTestId('submit-error')).toHaveTextContent('rejected these settings')
    expect(put).not.toHaveBeenCalled()
  })

  it('reports a failed creation and stays on review without navigating', async () => {
    mockGets()
    post.mockRejectedValue(apiError(403, 'BROKER_NOT_CONFIGURED'))
    renderWizard()
    await walkToReview()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Start paper trading' }))
    expect(await screen.findByTestId('submit-error')).toHaveTextContent('Connect a paper trading account')
    expect(heading()).toHaveTextContent('Review & start')
    expect(put).not.toHaveBeenCalled()
    expect(screen.queryByTestId('bot-page')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start paper trading' })).toBeEnabled()
  })

  it('if activation fails, says the bot exists paused with its limits and links to it', async () => {
    mockGets()
    post.mockResolvedValue({ id: 'bot_7', enabled: false, config: {} })
    put.mockRejectedValue(apiError(500, null))
    renderWizard()
    await walkToReview()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Start paper trading' }))
    const err = await screen.findByTestId('submit-error')
    expect(err).toHaveTextContent('created with your limits but couldn’t be started, so it’s paused')
    expect(within(err).getByRole('link', { name: 'Open the bot' })).toHaveAttribute('href', '/bots/bot_7')
    expect(put).toHaveBeenCalledTimes(1)
    // A second submit would create a duplicate bot.
    expect(screen.getByRole('button', { name: 'Start paper trading' })).toBeDisabled()
  })

  it('explains an activation blocked by a missing paper account', async () => {
    mockGets()
    post.mockResolvedValue({ id: 'bot_8', enabled: false, config: {} })
    put.mockRejectedValue(apiError(403, 'BROKER_NOT_CONFIGURED'))
    renderWizard()
    await walkToReview()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Start paper trading' }))
    expect(await screen.findByTestId('submit-error')).toHaveTextContent('Connect a paper trading account, then resume it')
  })

  it('blocks when the portfolio cannot be loaded', async () => {
    mockGets({ portfolio: new Error('HTTP 500') })
    renderWizard()
    await walkToReview()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Start paper trading' })).toBeDisabled()
    expect(screen.getByText(/couldn’t load your portfolio/)).toBeInTheDocument()
  })
})

describe('Paper-mode restrictions', () => {
  it('without a connected account: explains, allows browsing, blocks starting', async () => {
    authState.brokerStatus = { connected: false }
    mockGets({ account: { buying_power: null } })
    renderWizard()
    expect(await screen.findByTestId('mode-notice')).toHaveTextContent('Connect a paper trading account')
    await walkToReview()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Start paper trading' })).toBeDisabled()
    expect(screen.getByTestId('review-summary')).toHaveTextContent('No paper account connected')
    expect(post).not.toHaveBeenCalled()
  })

  it('with a live account: states live trading is disabled and blocks starting', async () => {
    authState.brokerStatus = { connected: true, paper: false }
    mockGets()
    renderWizard()
    expect(await screen.findByTestId('mode-notice')).toHaveTextContent('Live trading is disabled')
    await walkToReview()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Start paper trading' })).toBeDisabled()
  })
})

describe('newBotApi helpers', () => {
  it('parses symbols', () => {
    expect(parseSymbols('aapl, msft  aapl\nbrk.b')).toEqual(['AAPL', 'MSFT', 'BRK.B'])
    expect(parseSymbols('')).toEqual([])
  })

  it('validates allocation', () => {
    expect(validateAllocation({ capital: '100' }, { buyingPower: 50, templateTickers: ['SPY'] }).capital).toMatch(/buying power/)
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

describe('Alpha Research Follower', () => {
  const research = {
    id: 'tmpl_alpha_research', name: 'Alpha Research Follower', botType: 'rule_based',
    description: 'Trades only on current, verified Alpha Engine predictions.',
    config: { signalSource: 'alpha_research', tickers: ['SPY'], allocatedAmount: 5000, maxOrderNotional: 1000, research: { minConfidence: 0.6, maxPredictionAgeHours: 96, maxEntryDriftPct: 5, tenantId: 'default' } },
    rules: [{ type: 'market_hours', config: {} }],
  }
  const catalog = { ruleBased: [research, templates.ruleBased[0]], strategyBased: [] }

  async function toControls() {
    fireEvent.click(await screen.findByTestId('template-tmpl_alpha_research'))
    fireEvent.click(continueBtn())
    fireEvent.click(continueBtn())
    expect(heading()).toHaveTextContent('Controls')
  }

  it('describes what the research bot does instead of a fixed direction', async () => {
    mockGets({ catalog })
    renderWizard()
    expect(await screen.findByTestId('template-tmpl_alpha_research')).toHaveTextContent('Buys on current Alpha Engine BUY research')
  })

  it('shows research settings with the template defaults and validates them', async () => {
    mockGets({ catalog })
    renderWizard()
    await toControls()
    const box = screen.getByTestId('research-settings')
    expect(within(box).getByLabelText('Minimum research confidence')).toHaveValue('60')
    expect(within(box).getByLabelText('Ignore research older than')).toHaveValue('96')
    expect(within(box).getByLabelText('Skip if price moved more than')).toHaveValue('5')
    expect(box).toHaveTextContent('not a probability')

    fireEvent.change(within(box).getByLabelText('Minimum research confidence'), { target: { value: '150' } })
    fireEvent.click(continueBtn())
    expect(heading()).toHaveTextContent('Controls')
    expect(within(box).getByText('Enter a number from 0 to 100.')).toBeInTheDocument()
  })

  it('saves the research settings with the bot, keeping template-only keys', async () => {
    mockGets({ catalog })
    post.mockResolvedValue({ id: 'bot_r', enabled: false })
    put.mockResolvedValue({ id: 'bot_r', enabled: true })
    renderWizard()
    await toControls()
    const box = screen.getByTestId('research-settings')
    fireEvent.change(within(box).getByLabelText('Minimum research confidence'), { target: { value: '75' } })
    fireEvent.change(within(box).getByLabelText('Ignore research older than'), { target: { value: '48' } })
    fireEvent.click(continueBtn())
    expect(screen.getByTestId('review-summary')).toHaveTextContent('Confidence at least 75% · research under 48 hours old · price within 5%')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Start paper trading' }))

    expect(await screen.findByTestId('bot-page')).toHaveTextContent('bot bot_r created')
    expect(post).toHaveBeenCalledWith('/bots/catalog/from-template', expect.objectContaining({
      templateId: 'tmpl_alpha_research', tickers: ['SPY'], enabled: false,
      config: { research: { tenantId: 'default', minConfidence: 0.75, maxPredictionAgeHours: 48, maxEntryDriftPct: 5 } },
    }))
  })

  it('does not show research settings for rule bots', async () => {
    mockGets({ catalog })
    renderWizard()
    fireEvent.click(await screen.findByTestId('template-tmpl_golden_cross'))
    fireEvent.click(continueBtn())
    fireEvent.click(continueBtn())
    expect(screen.queryByTestId('research-settings')).toBeNull()
  })
})
