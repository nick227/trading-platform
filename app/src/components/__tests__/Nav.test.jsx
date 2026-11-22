import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  it('shows exactly two destinations plus an account link for signed-in users', () => {
    renderNav()
    const links = screen.getAllByRole('link').filter((a) => a.classList.contains('tl-nav-link'))
    expect(links.map((a) => a.textContent)).toEqual(['Home', 'Bots'])
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/profile')
    for (const removed of ['Portfolio', 'Orders', 'Opportunities', 'Templates', 'Profile']) {
      expect(screen.queryByRole('link', { name: removed })).not.toBeInTheDocument()
    }
  })

  it('marks the active section, including nested bot routes', () => {
    renderNav('/bots/bot_1')
    expect(screen.getByRole('link', { name: 'Bots' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
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

  it('shows Sign in and no mode badge when signed out', () => {
    authState.user = null
    renderNav()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth')
    expect(screen.queryByTestId('mode-badge')).not.toBeInTheDocument()
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
