import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PaperStrategyTestingJourney from '../PaperStrategyTestingJourney'
import { getPaperForwardAccount, listPaperStrategyBacktests } from '../researchPartnerApi'

vi.mock('../PaperStrategyBacktestPanel', () => ({
  default: ({ onRunsChange }) => <button type="button"
    onClick={() => onRunsChange([{ id: 'run2', version: 3, startSession: '2026-01-01',
      endSession: '2026-03-01', result: { returnPct: 3.5, maxDrawdownPct: -2, fillCount: 4 } }])}>
    Run historical test
  </button>
}))
vi.mock('../PaperForwardPanel', () => ({
  default: () => <div>Simulated account and explicit activation controls</div>
}))
vi.mock('../researchPartnerApi', () => ({
  getPaperForwardAccount: vi.fn(),
  listPaperStrategyBacktests: vi.fn()
}))

const strategy = { id: 'strategy1', name: 'Balanced momentum', currentVersion: 3 }
const historical = { id: 'run1', version: 3, startSession: '2026-01-01',
  endSession: '2026-03-01', result: { returnPct: 4.2, maxDrawdownPct: -3.8, fillCount: 6 } }

beforeEach(() => {
  vi.resetAllMocks()
  listPaperStrategyBacktests.mockResolvedValue([])
  getPaperForwardAccount.mockRejectedValue({ status: 404 })
})
describe('evidence-first paper strategy journey', () => {
  it('requires acknowledgement to continue without historical evidence', async () => {
    render(<PaperStrategyTestingJourney partnerId="p1" strategy={strategy} onClose={vi.fn()} />)
    await screen.findByRole('button', { name: 'Review testing evidence' })
    fireEvent.click(screen.getByRole('button', { name: 'Review testing evidence' }))
    expect(screen.getByText(/No historical test is saved/)).toBeInTheDocument()
    const advance = screen.getByRole('button', { name: 'Continue to paper simulation' })
    expect(advance).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /continuing without historical testing evidence/ }))
    expect(advance).toBeEnabled()
    fireEvent.click(advance)
    expect(screen.getByText('Simulated account and explicit activation controls')).toBeInTheDocument()
  })
  it('shows actual historical results for the approved version', async () => {
    listPaperStrategyBacktests.mockResolvedValue([{
      ...historical, version: 2
    }, historical])
    render(<PaperStrategyTestingJourney partnerId="p1" strategy={strategy} onClose={vi.fn()} />)
    expect(await screen.findByText('Historical return:')).toBeInTheDocument()
    expect(screen.getByText('4.2%')).toBeInTheDocument()
    expect(screen.getByText('-3.8%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to paper simulation' })).toBeEnabled()
  })
  it('preserves paper account state when reopening an activated strategy', async () => {
    getPaperForwardAccount.mockResolvedValue({ id: 'account', status: 'paused', version: 3 })
    render(<PaperStrategyTestingJourney partnerId="p1" strategy={strategy} onClose={vi.fn()} />)
    expect(await screen.findByText('Simulated account and explicit activation controls')).toBeInTheDocument()
    expect(listPaperStrategyBacktests).toHaveBeenCalledWith('p1', 'strategy1')
    expect(getPaperForwardAccount).toHaveBeenCalledWith('p1', 'strategy1')
  })
  it('transitions from an explicit historical run to evidence review', async () => {
    render(<PaperStrategyTestingJourney partnerId="p1" strategy={strategy} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run historical test' }))
    await waitFor(() => expect(screen.getByText('3.5%')).toBeInTheDocument())
  })
})
