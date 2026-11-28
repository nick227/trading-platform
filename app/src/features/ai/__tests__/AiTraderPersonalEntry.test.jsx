import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import StockTraderDashboard from '../StockTraderDashboard'
import { get } from '../../../api/client'

const state={user:null,sessionLoading:false}
vi.mock('../../../app/AuthProvider',()=>({useAuth:()=>state}))
vi.mock('../../../api/client',()=>({get:vi.fn()}))
vi.mock('../PersonalAiTraderCard',()=>({default:()=> <div data-testid="personal-config">Personal setup</div>}))
beforeEach(()=>{vi.clearAllMocks();state.user=null;state.sessionLoading=false;
  get.mockResolvedValue({status:'not_initialized',simulated:true})})
describe('public versus private AI Trader entry',()=>{
  it('offers sign-in without calling authenticated personal API',async()=>{
    render(<StockTraderDashboard/>)
    expect(await screen.findByTestId('flagship-uninitialized')).toBeInTheDocument()
    expect(screen.getByRole('link',{name:'Sign in to get started'})).toHaveAttribute('href','/auth')
    expect(screen.queryByTestId('personal-config')).not.toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/public/ai-stock-trader')
  })
  it('provides personal configuration after authentication',async()=>{
    state.user={id:'u'}
    render(<StockTraderDashboard/>)
    expect(await screen.findByTestId('personal-config')).toBeInTheDocument()
    expect(screen.queryByRole('link',{name:'Sign in to get started'})).not.toBeInTheDocument()
  })
})
