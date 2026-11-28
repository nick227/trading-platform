import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import StockTraderDashboard from '../StockTraderDashboard'
import { get } from '../../../api/client'

vi.mock('../../../api/client', () => ({ get: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

describe('AI Trader public showcase', () => {
  it('presents both existing bots and planned concepts without inventing results', async () => {
    get.mockResolvedValue({ status:'not_initialized', simulated:true })
    render(<StockTraderDashboard />)
    expect(screen.getByTestId('ai-trading-introduction')).toHaveTextContent('What is AI trading?')
    expect(screen.getByTestId('ai-bot-select-flagship')).toHaveTextContent('Flagship AI Trader')
    expect(screen.getByTestId('ai-bot-select-personal')).toHaveTextContent('Personal AI Trader')
    expect(await screen.findByTestId('flagship-uninitialized')).toHaveTextContent('no verified paper-trading results')
    expect(screen.queryByTestId('flagship-performance')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ai-bot-select-catalyst'))
    expect(screen.getByTestId('planned-ai-bot')).toHaveTextContent('no active bot')
    expect(screen.queryByTestId('flagship-uninitialized')).not.toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/public/ai-stock-trader')
    expect(get).not.toHaveBeenCalledWith('/ai/personal-trader')
  })

  it('keeps research proposals separate from recorded paper orders', async () => {
    get.mockResolvedValue({
      status:'paused',capitalAllocated:10000,performance:null,positions:[],orders:[],
      research:[{
        id:'research-1',asOfSession:'2026-11-25',createdAt:'2026-11-25T22:00:00Z',
        model:'mock',marketSummary:'No sufficient setup',
        investigation:{focus:'Compare eligible opportunities',toolsUsed:['get_stock_metrics'],toolCalls:1,modelCalls:2,priorResearchCycles:1},
        decisions:[{symbol:'AAPL',action:'HOLD',confidence:.6,thesis:'Wait',evidence:[],risks:[]}]
      }]
    })
    render(<StockTraderDashboard />)
    expect(await screen.findByTestId('trader-story-overview')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Research',exact:true}))
    expect(screen.getByText('No sufficient setup')).toBeInTheDocument()
    expect(screen.getByTestId('flagship-investigation')).toHaveTextContent('Compare eligible opportunities')
    expect(screen.getByTestId('flagship-investigation')).toHaveTextContent('Model calls: 2')
    expect(screen.getByText(/not a calibrated probability/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Trades & holdings'}))
    expect(screen.getByTestId('flagship-no-positions')).toBeInTheDocument()
    expect(screen.getByTestId('flagship-no-orders')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Decisions',exact:true}))
    expect(screen.getByTestId('trader-decision-journal')).toHaveTextContent('AAPL')
  })

  it('shows an error rather than stale or invented data', async () => {
    get.mockRejectedValue(new Error('unavailable'))
    render(<StockTraderDashboard />)
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable')
  })
})