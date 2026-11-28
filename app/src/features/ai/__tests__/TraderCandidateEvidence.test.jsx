import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import TraderCandidateEvidence, { matchRecordedDecision } from '../TraderCandidateEvidence'

describe('AI trader screening evidence', () => {
  it('only attributes recorded model decisions, not discovery score', () => {
    expect(matchRecordedDecision([], 'AAPL')).toBeNull()
    const record = matchRecordedDecision([{ asOfSession:'2026-11-26',
      decisions:[{symbol:'AAPL', action:'HOLD', thesis:'Watch risk'}] }], 'AAPL')
    expect(record.action).toBe('HOLD')
    const discovery={universeScanned:20,asOfSession:'2026-11-26', discoveries:[
      {symbol:'AAPL',name:'Apple',sector:'Technology',whyItMatters:['Screened on momentum'],indicators:{return20dPct:1}},
      {symbol:'MSFT',name:'Microsoft',sector:'Technology',indicators:{return20dPct:2}}
    ]}
    render(<TraderCandidateEvidence discovery={discovery} research={[
      {asOfSession:'2026-11-26',decisions:[{symbol:'AAPL',action:'HOLD',thesis:'Watch risk'}]}
    ]}/>)
    expect(screen.getByText(/Recorded AI decision:/)).toBeInTheDocument()
    expect(screen.getByText(/No recorded AI decision for this symbol/)).toBeInTheDocument()
    expect(screen.getByText(/Screening alone does not mean/)).toBeInTheDocument()
  })
})
