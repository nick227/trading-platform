import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import * as profile from '../../api/profileClient'
import { AuthProvider, useAuth } from '../AuthProvider'

vi.mock('../../api/profileClient', () => ({
  getSessionUser: vi.fn(), getBrokerStatus: vi.fn(), loginWithCredentials: vi.fn(), registerWithCredentials: vi.fn(),
  logoutFromServer: vi.fn(), saveBrokerCredentials: vi.fn(), resetPassword: vi.fn(),
}))

function Probe() {
  const { user, register } = useAuth()
  return (
    <>
      <button type="button" onClick={() => register('a@example.test', 'password123', 'Ada')}>register</button>
      <span data-testid="user">{user ? user.email : 'none'}</span>
    </>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  profile.getSessionUser.mockResolvedValue(null)
  profile.getBrokerStatus.mockResolvedValue({ connected: false })
})

describe('register', () => {
  it('signs in after creating the account, so a session cookie exists before authenticated calls', async () => {
    profile.registerWithCredentials.mockResolvedValue({ id: 'u1', email: 'a@example.test' })
    profile.loginWithCredentials.mockResolvedValue({ id: 'u1', email: 'a@example.test', fullName: 'Ada' })
    render(<AuthProvider><Probe /></AuthProvider>)
    fireEvent.click(screen.getByText('register'))
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('a@example.test'))
    expect(profile.registerWithCredentials).toHaveBeenCalledWith('a@example.test', 'password123', 'Ada')
    expect(profile.loginWithCredentials).toHaveBeenCalledWith('a@example.test', 'password123')
    expect(profile.registerWithCredentials.mock.invocationCallOrder[0]).toBeLessThan(profile.loginWithCredentials.mock.invocationCallOrder[0])
    expect(profile.getBrokerStatus.mock.invocationCallOrder.at(-1)).toBeGreaterThan(profile.loginWithCredentials.mock.invocationCallOrder[0])
  })
})
