import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { get } from '../../../api/client'
import StrategyDetail from '../StrategyDetail'
import {
  catalogOverview,
  catalogPeriod,
  catalogResult,
  catalogResultHeading,
  classifySampleSize,
  computeRiskAdjustedScore,
  deriveCardEvidenceMetrics,
  STRATEGY_EXPLANATIONS,
  strategyCategoryMeta,
} from '../strategyCatalogCopy'
import { mainEvidenceWindow } from '../StrategyCard'
import StrategiesIndex from '../StrategiesIndex'
import TemplateBaseline, { behaviourKey } from '../../bots/builder/TemplateBaseline'

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

const curve = [{ date: '2025-11-21', equity: 10000 }, { date: '2026-05-20', equity: 10400 }, { date: '2026-11-20', equity: 10800 }]
const res = (symbol, ret, bh, trades, extra = {}) => ({ symbol, window: '5Y', status: 'ok', startDate: '2021-11-20', endDate: '2026-11-20', riskPolicyVersion: 'normal-abc', parameters: { triggerPrice: 412.5, triggerFrom: '2021-11-19' },
  results: { capital: 10000, metrics: { returnPct: ret, trades, winRate: null, maxDrawdown: { pct: 12.5 } }, buyAndHold: { returnPct: bh }, curve, skips: trades ? {} : { no_position: 1255 } }, ...extra })
const strategy = {
  templateId: 'tmpl_momentum_buy', name: 'Momentum Buy', workshopAvailable: true, description: 'Buys above a threshold.', version: { id: 'sv_0123456789abcdef', published: true, firstSession: '2026-11-20', backtestable: true },
  definition: { config: { direction: 'buy', allocatedAmount: 10000, maxOrderNotional: 1000 }, rules: [{ type: 'price_threshold', config: { price: 0 } }, { type: 'cooldown', config: { windowMs: 3600000 } }], parameters: { triggerPrice: 'close_before_window' } },
  assumptions: ['Historical simulation on Alpha Engine daily bars — not a prediction of future results.'], asOf: '2026-11-20',
  summary: { '5Y': { status: 'ok', symbolsTested: 2, symbolsTraded: 1, medianReturnPct: 4, medianBuyAndHoldPct: 60, beatBuyAndHold: 0, worstDrawdownPct: 12.5, trades: 8 }, '1Y': { status: 'ok', symbolsTested: 2, symbolsTraded: 0, trades: 0 }, forward: { status: 'awaiting_sessions', symbolsTested: 0 } },
  results: [res('NVDA', 8, 120, 8), res('SPY', 0, 60, 0)], versions: [{ id: 'sv_0123456789abcdef', current: true }],
}

describe('public strategy evidence', () => {
  it('index renders editorial intro, excludes leaderboard and internal flagship template, and enriches cards with risk & sample metrics', async () => {
    get.mockResolvedValue([
      { templateId: 'a', name: 'A', description: 'd', asOf: '2026-11-20', windows: { '5Y': strategy.summary['5Y'], '1Y': strategy.summary['1Y'] } },
      { templateId: 'r', name: 'Research', tags: ['research'], description: 'd', windows: { '5Y': { status: 'not_backtestable' } } },
      { templateId: 'tmpl_ai_stock_trader', name: 'Internal Flagship', tags: ['ai'], windows: {} },
    ])
    render(<MemoryRouter><StrategiesIndex /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Automated strategies, tested openly', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Explore trading strategies', level: 2 })).toBeInTheDocument()
    expect(screen.queryByTestId('cross-strategy-leaderboard')).not.toBeInTheDocument()

    const cards = await screen.findAllByTestId('strategy-card')
    expect(cards).toHaveLength(2)
    expect(screen.getByTestId('strategy-family-counts')).toHaveTextContent('01 rule-based / 01 AI & research')

    const [a, r] = cards
    expect(within(a).getByTestId('strategy-family-tag')).toHaveTextContent('Rule-based')
    expect(within(a).getByTestId('strategy-sample-tier')).toHaveTextContent('Developing sample')
    expect(within(a).getByTestId('strategy-primary-return')).toHaveTextContent('+4.00%')
    expect(within(a).getByTestId('strategy-benchmark-delta')).toHaveTextContent('−56.00% vs bench')
    expect(within(a).getByText('Typical strategy return')).toBeInTheDocument()
    expect(within(a).getByText('Typical buy-and-hold return')).toBeInTheDocument()
    expect(a).toHaveTextContent('+60.00%')
    expect(within(a).getByTestId('strategy-drawdown')).toHaveTextContent('−12.50%')
    expect(within(a).getByTestId('strategy-risk-score')).toHaveTextContent('0.32x')
    expect(within(a).getByTestId('strategy-sample-detail')).toHaveTextContent('8 trades · 0/2 beat')
    expect(a).toHaveTextContent('Historical test · Five years')
    expect(a.querySelectorAll('a')).toHaveLength(1)
    expect(a.querySelector('a')).toHaveAttribute('href', '/strategies/a')
    expect(within(a).getByRole('link', { name: /View strategy/ })).toBeInTheDocument()
    expect(within(a).getByTestId('strategy-thumbnail')).toHaveAttribute('aria-hidden', 'true')

    expect(within(r).getByTestId('strategy-family-tag')).toHaveTextContent('Research signal')
    expect(r).toHaveTextContent('Results unavailable')
    expect(r).toHaveTextContent('This strategy cannot be evaluated using the available historical testing method.')
    expect(within(r).queryByText('Typical strategy return')).not.toBeInTheDocument()
  })
  it('detail shows standardized results per symbol, the tested definition and its assumptions', async () => {
    get.mockResolvedValue(strategy)
    render(<MemoryRouter initialEntries={['/strategies/tmpl_momentum_buy']}><Routes><Route path="/strategies/:templateId" element={<StrategyDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByTestId('window-summary')).toHaveTextContent('+4.00%across 2 stocks tested')
    const rows = screen.getAllByTestId('symbol-row')
    expect(rows[1]).toHaveTextContent('0 · the strategy had no shares to sell')
    expect(screen.getByTestId('tested-definition')).toHaveTextContent('Historical trigger: the last closing price before the selected test period')
    expect(screen.getByTestId('open-in-workshop')).toHaveAttribute('href', '/bots/new?template=tmpl_momentum_buy')
    fireEvent.click(screen.getByRole('button', { name: 'Since published' }))
    expect(screen.getByTestId('window-status')).toHaveTextContent('Results pending')
  })
  it('does not offer Workshop for an unavailable rule-based strategy', async () => {
    get.mockResolvedValue({ ...strategy, workshopAvailable: false })
    render(<MemoryRouter initialEntries={['/strategies/tmpl_momentum_buy']}><Routes><Route path="/strategies/:templateId" element={<StrategyDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Momentum Buy' })).toBeInTheDocument()
    expect(screen.queryByTestId('open-in-workshop')).not.toBeInTheDocument()
  })
  it('the Workshop marks departures from the tested defaults', async () => {
    get.mockResolvedValue(strategy)
    const d = { direction: 'buy', triggerType: 'price_threshold', trigger: { operator: 'above', price: '' }, cooldown: { on: true, hours: '1' } }
    expect(behaviourKey({ ...d, symbolsText: 'NVDA', capital: '2500' })).toBe(behaviourKey(d)) // symbols/capital aren't behaviour
    expect(behaviourKey({ ...d, cooldown: { on: true, hours: '24' } })).not.toBe(behaviourKey(d))
    const { rerender } = render(<MemoryRouter><TemplateBaseline templateId="tmpl_momentum_buy" modified={false} /></MemoryRouter>)
    expect(await screen.findByTestId('template-baseline')).toHaveTextContent('Strategy defaults · 5-year backtest: +4.00% median vs +60.00% buy & hold')
    rerender(<MemoryRouter><TemplateBaseline templateId="tmpl_momentum_buy" modified /></MemoryRouter>)
    expect(screen.getByTestId('template-baseline')).toHaveTextContent('Modified strategy · Backtest your changes')
  })
})

describe('redesigned versions', () => {
  it('shows objective, benchmark, development/holdout windows, drawdown comparison and earlier versions', async () => {
    const design = { developmentEnd: '2025-11-21', objective: 'Limit losses on each position.', benchmark: 'Buy & hold; judged mainly on maximum drawdown.', parameterBasis: 'Conventional values, not fitted.' }
    const sum = { status: 'ok', symbolsTested: 2, symbolsTraded: 2, medianReturnPct: 10, medianBuyAndHoldPct: 20, beatBuyAndHold: 0, worstDrawdownPct: 15, trades: 30, exits: 6, medianDrawdownPct: 12, medianBuyAndHoldDrawdownPct: 30, lowerDrawdownThanBuyAndHold: 2, medianTimeInMarketPct: 80 }
    get.mockResolvedValue({ ...strategy, templateId: 'tmpl_loss_guard', design, version: { ...strategy.version, current: true }, standard: { windows: ['5Y', '1Y', 'forward', 'development', 'holdout'] },
      summary: { ...strategy.summary, development: sum, holdout: { ...sum, medianReturnPct: -1 } },
      versions: [{ id: 'sv_new0000000000000', current: true, selected: true, firstSession: '2026-11-24' }, { id: 'sv_old0000000000000', current: false, selected: false, firstSession: '2026-11-23' }] })
    render(<MemoryRouter initialEntries={['/strategies/tmpl_loss_guard']}><Routes><Route path="/strategies/:templateId" element={<StrategyDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByTestId('strategy-design')).toHaveTextContent('How this strategy is defined and compared')
    fireEvent.click(screen.getByRole('button', { name: 'How this strategy is defined and compared' }))
    expect(screen.getByTestId('strategy-design')).toHaveTextContent('After Nov 21, 2025')
    fireEvent.click(screen.getByRole('button', { name: 'Later historical test' }))
    expect(screen.getByTestId('window-summary')).toHaveTextContent('−1.00%')
    expect(screen.getByTestId('drawdown-benchmark')).toHaveTextContent('12.00%Buying and holding declined 30.00%. The strategy had smaller declines for 2 of 2 stocks.')
    fireEvent.click(screen.getByRole('button', { name: 'Previous published versions' }))
    expect(within(screen.getByTestId('version-list')).getByRole('link', { name: 'old00000' })).toHaveAttribute('href', '/strategies/tmpl_loss_guard?version=sv_old0000000000000')
  })
})

describe('AI strategy presentation', () => {
  const aiStrategy = {
    ...strategy,
    templateId: 'tmpl_ai_catalyst_momentum',
    workshopAvailable: false,
    name: 'AI Momentum & Technical Breakout',
    tags: ['ai', 'openai'],
    version: { ...strategy.version, backtestable: false },
    standard: { windows: ['5Y', '1Y', 'forward'] },
    definition: { ...strategy.definition, config: { allocatedAmount: 10000, maxOrderNotional: 2000 }, rules: [] },
  }

  it('shows compact AI identity, paper settings and only the forward window', async () => {
    get.mockImplementation(async (path) => path.includes('/decisions') ? { decisions: [] } : aiStrategy)
    render(<MemoryRouter initialEntries={['/strategies/tmpl_ai_catalyst_momentum']}><Routes><Route path="/strategies/:templateId" element={<StrategyDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'AI Momentum & Technical Breakout' })).toBeInTheDocument()
    expect(screen.queryByTestId('open-in-workshop')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Since published' })).not.toBeInTheDocument()
    expect(screen.queryByText('Forward paper')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '5 years' })).not.toBeInTheDocument()
    expect(screen.getByText('Starting simulated capital')).toBeInTheDocument()
    expect(screen.getByText('$10,000')).toBeInTheDocument()
    expect(screen.getByTestId('tested-definition')).not.toHaveTextContent('Buys each symbol')
  })

  it('does not imply execution is planned when AI proposed no orders', async () => {
    get.mockImplementation(async (path) => path.includes('/decisions')
      ? { decisions: [{ id: 'd1', metadata: {
        asOfSession: '2026-11-20', intendedExecutionSession: '2026-11-23',
        symbolEvaluations: [{ symbol: 'SPY', action: 'HOLD', thesis: 'No entry.' }],
        selectedDecisions: [],
      } }] }
      : aiStrategy)
    render(<MemoryRouter initialEntries={['/strategies/tmpl_ai_catalyst_momentum']}><Routes><Route path="/strategies/:templateId" element={<StrategyDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByText(/No orders proposed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Research' }))
    expect(screen.queryByText('Proposed for')).not.toBeInTheDocument()
  })

  it('distinguishes unavailable decisions from no decisions', async () => {
    get.mockImplementation(async (path) => {
      if (path.includes('/decisions')) throw new Error('Unavailable')
      return aiStrategy
    })
    render(<MemoryRouter initialEntries={['/strategies/tmpl_ai_catalyst_momentum']}><Routes><Route path="/strategies/:templateId" element={<StrategyDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Recorded strategy evaluations could not be loaded.')
    expect(screen.queryByText('No decisions yet.')).not.toBeInTheDocument()
  })
})

describe('public strategy catalog contract', () => {
  it('uses published descriptions rather than constructing a trading rationale', () => {
    expect(catalogOverview({name:'Undocumented'})).toMatch(/is not available/)
    expect(catalogOverview({description:'The published strategy buys shares after a defined price signal.'}))
      .toBe('The published strategy buys shares after a defined price signal.')
  })
  it('preserves losses, incomplete tests, and simulated evidence labels', () => {
    const negative = {status:'ok',symbolsTested:3,symbolsTraded:2,medianReturnPct:-7.25,medianBuyAndHoldPct:3.5}
    expect(catalogResult(negative,'5Y')).toBeNull()
    expect(catalogPeriod('forward')).toBe('Simulated trading · Since publication')
    expect(catalogResult({status:'awaiting_sessions'},'forward')).toMatch(/qualifying forward paper trades/)
    expect(catalogResult({status:'not_backtestable'},'5Y')).toMatch(/cannot be evaluated/)
    expect(catalogResult({status:'not_backtestable'},'forward')).toMatch(/since this strategy was introduced/)
    expect(catalogResult({status:'not_backtestable',reason:'Forward performance evaluation is not configured for this strategy: no active paper trading bot is running.'},'forward'))
      .toMatch(/Forward performance evaluation is not configured/)
  })
  it('prefers a completed available period but does not mislabel AI evidence', () => {
    expect(mainEvidenceWindow({windows:{'5Y':{status:'insufficient_data'},'1Y':{status:'ok'}}})).toBe('1Y')
    expect(mainEvidenceWindow({tags:['ai'],windows:{'5Y':{status:'ok'},forward:{status:'awaiting_sessions'}}})).toBe('forward')
    expect(mainEvidenceWindow({templateId:'tmpl_alpha_research',windows:{'5Y':{status:'not_backtestable'},forward:{status:'not_backtestable'}}})).toBe('forward')
  })
  it('computes risk-adjusted scores, sample tiers, and category badges deterministically', () => {
    expect(computeRiskAdjustedScore(16, 8, 48)).toBe(2)
    expect(computeRiskAdjustedScore(4, 0.1, 5)).toBe(8) // 0.50% drawdown floor
    expect(computeRiskAdjustedScore(10, 5, 0)).toBeNull() // untraded strategies are never scored
    expect(classifySampleSize({ sessionsCount: 1260, tradesCount: 48 }).tier).toBe('substantive')
    expect(classifySampleSize({ sessionsCount: 25, tradesCount: 4 }).tier).toBe('developing')
    expect(classifySampleSize({ sessionsCount: 5, tradesCount: 1 }).tier).toBe('early')
    expect(classifySampleSize({ sessionsCount: 0, tradesCount: 0, status: 'awaiting_sessions' }).label).toBe('Awaiting trades')
    expect(strategyCategoryMeta({ templateId: 'tmpl_ai_catalyst_momentum', tags: ['ai'] })).toEqual({
      family: 'Autonomous AI',
      mode: 'Forward paper',
      isAiOrResearch: true,
    })
    expect(strategyCategoryMeta({ templateId: 'tmpl_alpha_research' })).toEqual({
      family: 'Research signal',
      mode: 'Paper only',
      isAiOrResearch: true,
    })
    const derived = deriveCardEvidenceMetrics({
      status: 'ok',
      symbolsTested: 10,
      symbolsTraded: 8,
      beatBuyAndHold: 6,
      medianReturnPct: 16,
      medianBuyAndHoldPct: 13.5,
      medianDrawdownPct: 8,
      trades: 48,
    }, '5Y')
    expect(derived.excessVsBenchmarkPct).toBe(2.5)
    expect(derived.drawdownText).toBe('−8.00%')
    expect(derived.riskAdjustedText).toBe('2.00x')
    expect(derived.sampleSize.label).toBe('Substantive sample')
    expect(derived.sampleDetailText).toBe('48 trades · 6/10 beat')
  })
})

describe('corrected catalog presentation', () => {
  it('provides reviewed, purpose-first descriptions for all seven published strategies', () => {
    expect(Object.keys(STRATEGY_EXPLANATIONS)).toHaveLength(7)
    for (const [templateId, explanation] of Object.entries(STRATEGY_EXPLANATIONS)) {
      expect(catalogOverview({templateId, description:'Unreviewed technical jargon.'})).toBe(explanation)
      expect(explanation.split(/(?<=[.!?])\s+/)).toHaveLength(2)
    }
  })
  it('uses the same prominent typography for unavailable and completed test headings', () => {
    expect(catalogResultHeading({status:'awaiting_sessions'})).toBe('Results pending')
    expect(catalogResultHeading({status:'not_backtestable'})).toBe('Results unavailable')
    expect(catalogResultHeading({status:'not_backtestable',reason:'Forward performance evaluation is not configured for this strategy'})).toBe('Evaluation not configured')
    expect(catalogResultHeading({status:'ok',symbolsTraded:0})).toBe('No trades recorded')
  })

  it('preserves symbol context across StrategiesIndex and StrategyDetail into bot customization', async () => {
    get.mockResolvedValue([{ templateId: 'tmpl_momentum_buy', name: 'Momentum Buy', description: 'd', asOf: '2026-11-20', windows: { '5Y': strategy.summary['5Y'] } }])
    const { unmount } = render(<MemoryRouter initialEntries={['/strategies?symbol=NVDA']}><StrategiesIndex /></MemoryRouter>)
    expect(await screen.findByTestId('strategy-symbol-context')).toHaveTextContent('Exploring strategies for NVDA')
    const card = await screen.findByTestId('strategy-card')
    expect(card.querySelectorAll('a')).toHaveLength(1)
    expect(card.querySelector('a')).toHaveAttribute('href', '/strategies/tmpl_momentum_buy?symbol=NVDA')
    unmount()

    get.mockResolvedValue(strategy)
    render(<MemoryRouter initialEntries={['/strategies/tmpl_momentum_buy?symbol=NVDA']}><Routes><Route path="/strategies/:templateId" element={<StrategyDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByTestId('open-in-workshop')).toHaveAttribute('href', '/bots/new?template=tmpl_momentum_buy&ticker=NVDA')
    expect(screen.getByRole('link', { name: '← Strategies' })).toHaveAttribute('href', '/strategies?symbol=NVDA')
    expect(screen.getByTestId('strategy-view-stock-link')).toHaveAttribute('href', '/opportunities?symbol=NVDA&strategy=tmpl_momentum_buy')
  })
})
