import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ResearchViewLinks, { RESEARCH_VIEWS } from '../ResearchViewLinks'

describe('UX-02 focused research destinations', () => {
  it('exposes only contextual alternative destinations, not the current focus', () => {
    const select = vi.fn()
    render(<ResearchViewLinks current="research" onSelect={select}/>)
    expect(RESEARCH_VIEWS).toHaveLength(6)
    expect(RESEARCH_VIEWS.map(view=>view.id)).toContain('activity')
    expect(screen.queryByRole('button',{name:/Investigate/})).not.toBeInTheDocument()
    expect(screen.getByRole('navigation',{name:'Explore research workspace'})).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:/Strategies/}))
    expect(select).toHaveBeenCalledWith('strategies')
  })
  it('never exposes trading or approval as a navigation action', () => {
    render(<ResearchViewLinks current="strategies" onSelect={()=>{}}/>)
    expect(screen.queryByRole('button',{name:/Approve|Execute|Broker/i})).not.toBeInTheDocument()
  })
})
