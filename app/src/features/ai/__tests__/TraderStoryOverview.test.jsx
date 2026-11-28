import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import TraderStoryOverview from '../TraderStoryOverview'

describe('public AI trader story', () => {
  it('never converts missing performance into zero or a purported track record', () => {
    render(<TraderStoryOverview data={{ capitalAllocated:10000, research:[] }}/>)
    expect(screen.getByTestId('trader-story-overview')).toHaveTextContent('simulated money')
    expect(screen.getByText('Insufficient observations for a meaningful comparison')).toBeInTheDocument()
    expect(screen.getByText(/not your portfolio or realized investment earnings/)).toBeInTheDocument()
  })
  it('only reports benchmark excess return when the provided sample passes maturity gates', () => {
    const data={performance:{totalEquity:10100,totalPnl:100,fillCount:1},
      performanceIntelligence:{comparison:{excessVsSpyPctPoints:2.5},
        statisticalConfidence:{meetsThreshold:false}}}
    const {rerender}=render(<TraderStoryOverview data={data}/>)
    expect(screen.queryByText('+2.50%')).not.toBeInTheDocument()
    rerender(<TraderStoryOverview data={{...data,performanceIntelligence:{
      ...data.performanceIntelligence,statisticalConfidence:{meetsThreshold:true}}}}/>)
    expect(screen.getByText('+2.50%')).toBeInTheDocument()
  })
})
