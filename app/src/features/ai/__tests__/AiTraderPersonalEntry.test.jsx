import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import StockTraderDashboard from '../StockTraderDashboard'
import { get } from '../../../api/client'

const authState={user:null,sessionLoading:false}
vi.mock('../../../app/AuthProvider',()=>({useAuth:()=>authState}))
vi.mock('../../../api/client',()=>({get:vi.fn()}))
vi.mock('../PersonalAiTraderCard',()=>({default:()=> <div data-testid="personal-config">Personal setup</div>}))
beforeEach(()=>{vi.clearAllMocks();authState.user=null;authState.sessionLoading=false;
  get.mockResolvedValue({status:'not_initialized',simulated:true})})

describe('authenticated AI Trader experience',()=>{
  it('lets guests preview Personal AI Trader but does not request private account data',async()=>{
    render(<StockTraderDashboard/>)
    expect(await screen.findByTestId('flagship-uninitialized')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ai-bot-select-personal'))
    expect(screen.getByRole('link',{name:'Sign in to get started'})).toHaveAttribute('href','/auth')
    expect(screen.queryByTestId('personal-config')).not.toBeInTheDocument()
    expect(get).not.toHaveBeenCalledWith('/ai/personal-trader')
  })
  it("loads the user\'s actual bot status and shows personal controls when selected",async()=>{
    authState.user={id:'u'}
    get.mockImplementation(async path=>path==='/ai/personal-trader'
      ? {configured:true,bot:{enabled:true},lifecycle:{state:'awaiting_next_close_research'}}
      : {status:'not_initialized',simulated:true})
    render(<StockTraderDashboard/>)
    await waitFor(()=>expect(screen.getByTestId('ai-bot-select-personal')).toHaveTextContent('Active'))
    fireEvent.click(screen.getByTestId('ai-bot-select-personal'))
    expect(screen.getByTestId('personal-config')).toBeInTheDocument()
    expect(screen.queryByRole('link',{name:'Sign in to get started'})).not.toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/ai/personal-trader')
  })
})