import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider, useAuth } from '../../app/AuthProvider.jsx'
import ModeBadge from '../ModeBadge.jsx'
vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))
import * as profile from '../../api/profileClient'
vi.mock('../../api/profileClient', () => ({getSessionUser:vi.fn(),getBrokerStatus:vi.fn(),loginWithCredentials:vi.fn(),registerWithCredentials:vi.fn(),logoutFromServer:vi.fn(),saveBrokerCredentials:vi.fn(),resetPassword:vi.fn()}))
afterEach(()=> {cleanup();vi.resetAllMocks()})
function Probe() {const a=useAuth(); return <ModeBadge brokerStatus={a.brokerStatus} loading={a.brokerStatusLoading} error={a.brokerStatusError}/>}
function mount() {render(<MemoryRouter><AuthProvider><Probe/></AuthProvider></MemoryRouter>)}
describe('account status loading contract',()=> {
 it('never flashes disconnected while broker status is pending',async()=> {
  profile.getSessionUser.mockResolvedValue({id:'test'})
  let resolve; profile.getBrokerStatus.mockReturnValue(new Promise(r=>{resolve=r}))
  mount(); await waitFor(()=>expect(profile.getBrokerStatus).toHaveBeenCalled())
  expect(screen.getByTestId('mode-badge')).toHaveAttribute('data-mode','checking')
  expect(screen.queryByText('No account connected')).toBeNull()
  await act(async()=>resolve({connected:true,paper:true}))
  expect(screen.getByTestId('mode-badge')).toHaveAttribute('data-mode','paper')
 })
 it('shows unavailable rather than disconnected on a failed lookup',async()=> {
  profile.getSessionUser.mockResolvedValue({id:'test'});profile.getBrokerStatus.mockRejectedValue(new Error('offline'))
  mount();await waitFor(()=>expect(screen.getByTestId('mode-badge')).toHaveAttribute('data-mode','unknown'))
 })
 it('shows disconnected only after a successful disconnected result',async()=> {
  profile.getSessionUser.mockResolvedValue({id:'test'});profile.getBrokerStatus.mockResolvedValue({connected:false})
  mount();await waitFor(()=>expect(screen.getByTestId('mode-badge')).toHaveAttribute('data-mode','none'))
 })
 it('does not present a cached connection as current after a lookup error',()=>{
  render(<MemoryRouter><ModeBadge brokerStatus={{connected:true,paper:true}} error/></MemoryRouter>)
  expect(screen.getByTestId('mode-badge')).toHaveAttribute('data-mode','unknown')
 })
})
