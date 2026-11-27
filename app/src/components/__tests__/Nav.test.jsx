import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Nav from '../Nav'
import { getTradingMode } from '../ModeBadge'

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))
vi.mock('../../app/pagePrefetch', () => ({ prefetchByPath: vi.fn() }))

const authState = { user: null, brokerStatus: null }
vi.mock('../../app/AuthProvider', () => ({ useAuth: () => authState }))

const renderNav = (path = '/') =>
  render(<MemoryRouter initialEntries={[path]}><Nav /></MemoryRouter>)

beforeEach(() => {
  authState.user = { fullName: 'Ada' }
  authState.brokerStatus = { connected: true, paper: true }
})

describe('Nav', () => {
  it('shows the four primary surfaces plus an account link for signed-in users, keeping AI workspaces contextual', () => {
    renderNav()
    const links = screen.getAllByRole('link').filter((a) => a.classList.contains('tl-nav-link'))
    expect(links.map((a) => a.textContent)).toEqual(['Portfolio', 'Stocks', 'Strategies', 'My Bots'])
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/profile')
    for (const removed of ['Home', 'Orders', 'Opportunities', 'Templates', 'Profile', 'Research Partner', 'AI Stock Trader']) {
      expect(screen.queryByRole('link', { name: removed })).not.toBeInTheDocument()
    }
  })

  it('renders Admin destination link when user has admin or operator role', () => {
    authState.user = { fullName: 'Admin User', role: 'admin' }
    renderNav()
    const links = screen.getAllByRole('link').filter((a) => a.classList.contains('tl-nav-link'))
    expect(links.map((a) => a.textContent)).toEqual(['Portfolio', 'Stocks', 'Strategies', 'My Bots', 'Admin'])
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')

    cleanup()
    authState.user = { fullName: 'Op User', role: 'operator' }
    renderNav()
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')
  })

  it('marks the active section across Portfolio, Stocks (/opportunities and /assets/*), Strategies, and My Bots', () => {
    renderNav('/bots/bot_1')
    expect(screen.getByRole('link', { name: 'My Bots' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Portfolio' })).not.toHaveAttribute('aria-current')

    cleanup()
    renderNav('/assets/NVDA')
    expect(screen.getByRole('link', { name: 'Stocks' })).toHaveAttribute('aria-current', 'page')

    cleanup()
    renderNav('/opportunities')
    expect(screen.getByRole('link', { name: 'Stocks' })).toHaveAttribute('aria-current', 'page')

    cleanup()
    renderNav('/strategies/tmpl_spy_trend_filter')
    expect(screen.getByRole('link', { name: 'Strategies' })).toHaveAttribute('aria-current', 'page')
  })

  it('always shows paper/live status', () => {
    renderNav()
    expect(screen.getByTestId('mode-badge')).toHaveTextContent('Paper trading')
  })

  it('flags a live account as trading disabled', () => {
    authState.brokerStatus = { connected: true, paper: false }
    renderNav()
    expect(screen.getByTestId('mode-badge')).toHaveTextContent('Live account — trading disabled')
  })

  it('shows Stocks, Strategies, Sign in and no mode badge when signed out', () => {
    authState.user = null
    renderNav()
    expect(screen.getByRole('link', { name: 'Stocks' })).toHaveAttribute('href', '/opportunities')
    expect(screen.getByRole('link', { name: 'Strategies' })).toHaveAttribute('href', '/strategies')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth')
    expect(screen.queryByTestId('mode-badge')).not.toBeInTheDocument()
  })

  it('shows Admin link when user possesses admin role', () => {
    authState.user = { fullName: 'Ada Admin', role: 'admin' }
    renderNav()
    const adminLink = screen.getByRole('link', { name: 'Admin' })
    expect(adminLink).toBeInTheDocument()
    expect(adminLink).toHaveAttribute('href', '/admin')
  })

  it('shows Admin link when user possesses operator role', () => {
    authState.user = { fullName: 'Sam Operator', role: 'operator' }
    renderNav()
    const adminLink = screen.getByRole('link', { name: 'Admin' })
    expect(adminLink).toBeInTheDocument()
    expect(adminLink).toHaveAttribute('href', '/admin')
  })
})

describe('getTradingMode', () => {
  it('maps broker status to a mode', () => {
    expect(getTradingMode(null)).toBe('none')
    expect(getTradingMode({ connected: false })).toBe('none')
    expect(getTradingMode({ connected: true, paper: true })).toBe('paper')
    expect(getTradingMode({ connected: true })).toBe('paper')
    expect(getTradingMode({ connected: true, paper: false })).toBe('live-disabled')
  })
})

describe('simulator badge', () => {
  it('labels the internal historical-replay simulator distinctly while staying paper-like for checks', () => {
    authState.brokerStatus = { connected: true, paper: true, simulated: true, mode: 'historical_replay', session: '2026-11-19' }
    expect(getTradingMode(authState.brokerStatus)).toBe('paper')
    renderNav()
    const badge = screen.getByTestId('mode-badge')
    expect(badge).toHaveAttribute('aria-label', 'Simulated · Nov 19 replay')
    expect(badge).toHaveTextContent('Simulated · Nov 19 replay')
  })
})
