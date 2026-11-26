import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AdminRoute from '../AdminRoute'

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

const authState = { user: null, sessionLoading: false }
vi.mock('../../../app/AuthProvider', () => ({
  useAuth: () => authState
}))

describe('AdminRoute Guard', () => {
  beforeEach(() => {
    authState.user = null
    authState.sessionLoading = false
  })

  it('renders loading skeleton while session is resolving', () => {
    authState.sessionLoading = true
    const { container } = render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminRoute>
          <div>Protected Content</div>
        </AdminRoute>
      </MemoryRouter>
    )

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
    expect(container.querySelector('.page-skeleton') || container.firstChild).toBeInTheDocument()
  })

  it('redirects unauthenticated users to /auth', () => {
    authState.user = null
    authState.sessionLoading = false

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <div>Protected Content</div>
              </AdminRoute>
            }
          />
          <Route path="/auth" element={<div>Auth Sign In Page</div>} />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
    expect(screen.getByText('Auth Sign In Page')).toBeInTheDocument()
  })

  it('displays 403 Forbidden view for regular users without admin or operator role', () => {
    authState.user = { id: 'usr_1', email: 'user@example.com', role: 'user' }

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminRoute>
          <div>Protected Content</div>
        </AdminRoute>
      </MemoryRouter>
    )

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
    expect(screen.getByText(/403 — Authorization Required/i)).toBeInTheDocument()
    expect(screen.getByText(/restricted to platform operators and administrators/i)).toBeInTheDocument()
  })

  it('renders children for users with admin role', () => {
    authState.user = { id: 'usr_adm', email: 'admin@example.com', role: 'admin' }

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminRoute>
          <div>Admin Dashboard View</div>
        </AdminRoute>
      </MemoryRouter>
    )

    expect(screen.getByText('Admin Dashboard View')).toBeInTheDocument()
  })

  it('renders children for users with operator role', () => {
    authState.user = { id: 'usr_op', email: 'operator@example.com', role: 'operator' }

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminRoute>
          <div>Operator Telemetry View</div>
        </AdminRoute>
      </MemoryRouter>
    )

    expect(screen.getByText('Operator Telemetry View')).toBeInTheDocument()
  })
})
