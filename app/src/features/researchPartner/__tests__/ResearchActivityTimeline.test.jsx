import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ResearchActivityTimeline from '../ResearchActivityTimeline'
import { listResearchActivity } from '../researchPartnerApi'

vi.mock('../researchPartnerApi', () => ({ listResearchActivity: vi.fn() }))

const item = { id: 'research_result:s1', kind: 'research_result', status: 'completed',
  at: '2026-11-26T20:00:00.000Z', title: 'Investigation completed',
  detail: 'Completed report', reference: { sessionId: 's1' } }
beforeEach(() => {
  vi.resetAllMocks()
  listResearchActivity.mockResolvedValue([item])
})
describe('agent activity presentation', () => {
  it('shows persisted status and offers the original investigation', async () => {
    const onOpenSession = vi.fn()
    render(<ResearchActivityTimeline partnerId="p" onOpenSession={onOpenSession}
      onOpenStrategy={vi.fn()} />)
    expect(await screen.findByText('Investigation completed')).toBeInTheDocument()
    expect(screen.getByText('Completed report')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review investigation' }))
    expect(onOpenSession).toHaveBeenCalledWith('s1')
  })
  it('does not present a failed fetch as an empty activity history', async () => {
    listResearchActivity.mockRejectedValueOnce(new Error('Server unavailable'))
      .mockResolvedValueOnce([])
    render(<ResearchActivityTimeline partnerId="p" onOpenSession={vi.fn()}
      onOpenStrategy={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The activity record could not be verified')
    expect(screen.queryByText('No activity is recorded for this research partner yet.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No activity is recorded for this research partner yet.')).toBeInTheDocument()
    await waitFor(() => expect(listResearchActivity).toHaveBeenCalledTimes(2))
  })
  it('opens paper strategy view without presenting any trading action', async () => {
    listResearchActivity.mockResolvedValue([{
      ...item, id: 'paper_cycle:c1', status: 'completed',
      title: 'Manual paper session processed', detail: '2026-11-26 · simulated fills: 1',
      reference: { strategyId: 'strategy-1' }
    }])
    const onOpenStrategy = vi.fn()
    render(<ResearchActivityTimeline partnerId="p" onOpenSession={vi.fn()}
      onOpenStrategy={onOpenStrategy} />)
    await screen.findByText('Manual paper session processed')
    expect(screen.getByText(/simulated fills: 1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review paper strategies' }))
    expect(onOpenStrategy).toHaveBeenCalledWith('strategy-1')
  })
})
