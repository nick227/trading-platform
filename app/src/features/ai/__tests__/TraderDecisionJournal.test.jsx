import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { buildTraderJournal } from '../traderJournal'
import TraderDecisionJournal from '../TraderDecisionJournal'
const data={research:[{id:'r1',createdAt:'2026-11-25T21:00:00Z',asOfSession:'2026-11-25',
  decisions:[{symbol:'AAPL',action:'HOLD',thesis:'No safe entry',risks:['Volatility']}] }],
  orders:[{id:'o1',symbol:'AAPL',direction:'buy',status:'pending',createdAt:'2026-11-26T21:00:00Z'}]}
describe('recorded AI journal',()=>{
  it('never fabricates executions or causal links',()=>{
    const rows=buildTraderJournal(data)
    expect(rows).toHaveLength(2)
    expect(rows[0].kind).toBe('order')
    expect(rows[0].filled).toBe(false)
    expect(rows[1].thesis).toBe('No safe entry')
  })
  it('labels paper orders and model proposals separately, with useful filters',()=>{
    render(<TraderDecisionJournal {...data}/>)
    expect(screen.getByText(/No filled quantity or price was confirmed/)).toBeInTheDocument()
    expect(screen.getByText('No safe entry')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'AI decisions'}))
    expect(screen.queryByText(/No filled quantity/)).not.toBeInTheDocument()
    expect(screen.getByText(/research proposal does not confirm a trade/i)).toBeInTheDocument()
  })
})
