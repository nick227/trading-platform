import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { get } from '../../../api/client'
import StrategyDetail from '../StrategyDetail'
import StrategiesIndex from '../StrategiesIndex'
import TemplateBaseline, { behaviourKey } from '../../bots/builder/TemplateBaseline'

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

const curve = [{ date: '2025-11-21', equity: 10000 }, { date: '2026-05-20', equity: 10400 }, { date: '2026-11-20', equity: 10800 }]
const res = (symbol, ret, bh, trades, extra = {}) => ({ symbol, window: '5Y', status: 'ok', startDate: '2021-11-20', endDate: '2026-11-20', riskPolicyVersion: 'normal-abc', parameters: { triggerPrice: 412.5, triggerFrom: '2021-11-19' },
  results: { capital: 10000, metrics: { returnPct: ret, trades, winRate: null, maxDrawdown: { pct: 12.5 } }, buyAndHold: { returnPct: bh }, curve, skips: trades ? {} : { no_position: 1255 } }, ...extra })
const strategy = {
  templateId: 'tmpl_momentum_buy', name: 'Momentum Buy', description: 'Buys above a threshold.', version: { id: 'sv_0123456789abcdef', published: true, firstSession: '2026-11-20', backtestable: true },
  definition: { config: { direction: 'buy', allocatedAmount: 10000, maxOrderNotional: 1000 }, rules: [{ type: 'price_threshold', config: { price: 0 } }, { type: 'cooldown', config: { windowMs: 3600000 } }], parameters: { triggerPrice: 'close_before_window' } },
  assumptions: ['Historical simulation on Alpha Engine daily bars — not a prediction of future results.'], asOf: '2026-11-20',
  summary: { '5Y': { status: 'ok', symbolsTested: 2, symbolsTraded: 1, medianReturnPct: 4, medianBuyAndHoldPct: 60, beatBuyAndHold: 0, worstDrawdownPct: 12.5, trades: 8 }, '1Y': { status: 'ok', symbolsTested: 2, symbolsTraded: 0, trades: 0 }, forward: { status: 'awaiting_sessions', symbolsTested: 0 } },
  results: [res('NVDA', 8, 120, 8), res('SPY', 0, 60, 0)], versions: [{ id: 'sv_0123456789abcdef', current: true }],
}

describe('public strategy evidence', () => {
  it('index lists every strategy with plain results, including non-results', async () => {
    get.mockResolvedValue([{ templateId: 'a', name: 'A', description: 'd', asOf: '2026-11-20', windows: { '5Y': strategy.summary['5Y'], '1Y': strategy.summary['1Y'] } }, { templateId: 'r', name: 'Research', description: 'd', windows: { '5Y': { status: 'not_backtestable' } } }])
    render(<MemoryRouter><StrategiesIndex /></MemoryRouter>)
    const [a, r] = await screen.findAllByTestId('strategy-card')
    expect(a).toHaveTextContent('+4.00% median vs +60.00% buy & hold')
    expect(a).toHaveTextContent('Didn’t trade on any of 2 symbols')
    expect(a).toHaveTextContent('0 of 2 symbols')
    expect(r).toHaveTextContent('Not backtestable')
  })
  it('detail shows standardized results per symbol, the tested definition and its assumptions', async () => {
    get.mockResolvedValue(strategy)
    render(<MemoryRouter initialEntries={['/strategies/tmpl_momentum_buy']}><Routes><Route path="/strategies/:templateId" element={<StrategyDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByTestId('window-summary')).toHaveTextContent('+4.00%across 2 symbols')
    const rows = screen.getAllByTestId('symbol-row')
    expect(rows[1]).toHaveTextContent('0 · it had nothing to sell')
    expect(screen.getByTestId('tested-definition')).toHaveTextContent('Trigger price: the symbol’s close on the last session before the test window')
    expect(screen.getByTestId('open-in-workshop')).toHaveAttribute('href', '/bots/new?template=tmpl_momentum_buy')
    fireEvent.click(screen.getByRole('button', { name: 'Since published' }))
    expect(screen.getByTestId('window-status')).toHaveTextContent('Awaiting new sessions')
  })
  it('the Workshop marks departures from the tested defaults', async () => {
    get.mockResolvedValue(strategy)
    const d = { direction: 'buy', triggerType: 'price_threshold', trigger: { operator: 'above', price: '' }, cooldown: { on: true, hours: '1' } }
    expect(behaviourKey({ ...d, symbolsText: 'NVDA', capital: '2500' })).toBe(behaviourKey(d)) // symbols/capital aren't behaviour
    expect(behaviourKey({ ...d, cooldown: { on: true, hours: '24' } })).not.toBe(behaviourKey(d))
    const { rerender } = render(<MemoryRouter><TemplateBaseline templateId="tmpl_momentum_buy" modified={false} /></MemoryRouter>)
    expect(await screen.findByTestId('template-baseline')).toHaveTextContent('Platform-tested defaults. 5-year standardized backtest: +4.00% median vs +60.00% buy & hold.')
    rerender(<MemoryRouter><TemplateBaseline templateId="tmpl_momentum_buy" modified /></MemoryRouter>)
    expect(screen.getByTestId('template-baseline')).toHaveTextContent('Modified from the platform-tested defaults.')
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
    expect(await screen.findByTestId('strategy-design')).toHaveTextContent('Details')
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByTestId('strategy-design')).toHaveTextContent('After Nov 21, 2025')
    fireEvent.click(screen.getByRole('button', { name: 'Holdout (out of sample)' }))
    expect(screen.getByTestId('window-summary')).toHaveTextContent('−1.00%')
    expect(screen.getByTestId('drawdown-benchmark')).toHaveTextContent('12.00%buy & hold 30.00% · lower on 2 of 2')
    fireEvent.click(screen.getByRole('button', { name: 'Methodology' }))
    expect(within(screen.getByTestId('version-list')).getByRole('link', { name: 'old00000' })).toHaveAttribute('href', '/strategies/tmpl_loss_guard?version=sv_old0000000000000')
  })
})

describe('AI strategy presentation', () => {
  const aiStrategy = {
    ...strategy,
    templateId: 'tmpl_ai_catalyst_momentum',
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
    expect(screen.getByTestId('open-in-workshop')).toHaveTextContent('Customize')
    expect(screen.queryByRole('button', { name: '5 years' })).not.toBeInTheDocument()
    expect(screen.getByTestId('tested-definition')).toHaveTextContent('$10,000 simulated capital')
    expect(screen.getByTestId('tested-definition')).not.toHaveTextContent('Buys each symbol')
  })

  it('distinguishes unavailable decisions from no decisions', async () => {
    get.mockImplementation(async (path) => {
      if (path.includes('/decisions')) throw new Error('Unavailable')
      return aiStrategy
    })
    render(<MemoryRouter initialEntries={['/strategies/tmpl_ai_catalyst_momentum']}><Routes><Route path="/strategies/:templateId" element={<StrategyDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Decisions unavailable.')
    expect(screen.queryByText('No decisions yet.')).not.toBeInTheDocument()
  })
})
