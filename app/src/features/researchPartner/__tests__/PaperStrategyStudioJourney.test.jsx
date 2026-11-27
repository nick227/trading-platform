import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PaperStrategyStudio from '../PaperStrategyStudio'
import {
  listResearchPaperStrategies, createResearchPaperStrategy,
  previewPaperStrategyWithAI, approveResearchPaperStrategy
} from '../researchPartnerApi'

vi.mock('../PaperStrategyBacktestPanel', () => ({ default: () => <div>Historical panel</div> }))
vi.mock('../PaperForwardPanel', () => ({ default: () => <div>Forward panel</div> }))
vi.mock('../researchPartnerApi', () => ({
  listResearchPaperStrategies: vi.fn(),
  createResearchPaperStrategy: vi.fn(),
  createPaperStrategyFromResearch: vi.fn(),
  previewPaperStrategyWithAI: vi.fn(),
  approveResearchPaperStrategy: vi.fn()
}))

const validSpec = {
  name: 'Momentum research', mode: 'paper', cadence: 'daily',
  universe: { type: 'watchlist', symbols: ['AAPL'] },
  entryRules: [{ field: 'return20dPct', operator: 'gte', value: 5 }],
  exitRules: [],
  risk: { maxPositionPct: 0.1, maxOrderNotional: 1000, maxOrdersPerCycle: 1 }
}
beforeEach(() => {
  vi.resetAllMocks()
  listResearchPaperStrategies.mockResolvedValue([])
  createResearchPaperStrategy.mockResolvedValue({ id: 'strategy1' })
  approveResearchPaperStrategy.mockResolvedValue({})
})
describe('guided paper strategy creation', () => {
  it('shows one idea stage first and keeps approval hidden until save', async () => {
    render(<PaperStrategyStudio partnerId="p1" session={null} />)
    expect(screen.getByRole('region', { name: 'Describe strategy idea' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save paper strategy draft' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve paper definition' })).not.toBeInTheDocument()
    await waitFor(() => expect(listResearchPaperStrategies).toHaveBeenCalledWith('p1'))
  })
  it('creates an explicit paper-only draft after reviewing editable rules', async () => {
    listResearchPaperStrategies
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'strategy1', name: 'My paper strategy', currentVersion: 1, status: 'draft' }])
    render(<PaperStrategyStudio partnerId="p1" session={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Define rules without AI' }))
    expect(screen.getByText('20-session price change at least 5%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save paper strategy draft' }))
    await waitFor(() => expect(createResearchPaperStrategy).toHaveBeenCalledWith(
      'p1', expect.objectContaining({ mode: 'paper', risk: expect.objectContaining({ maxPositionPct: 0.1 }) })
    ))
    expect(await screen.findByRole('button', { name: 'Approve paper definition' })).toBeInTheDocument()
    expect(approveResearchPaperStrategy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Approve paper definition' }))
    await waitFor(() => expect(approveResearchPaperStrategy).toHaveBeenCalledWith('p1', 'strategy1', 1))
  })
  it('requires users to accept and edit a model-generated preview', async () => {
    previewPaperStrategyWithAI.mockResolvedValue({ definition: validSpec })
    render(<PaperStrategyStudio partnerId="p1" session={null} />)
    fireEvent.change(screen.getByLabelText('Describe the idea and the stocks to evaluate'), {
      target: { value: 'AAPL momentum' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Suggest paper rules with AI' }))
    expect(await screen.findByText('Proposed rules — not saved')).toBeInTheDocument()
    expect(createResearchPaperStrategy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Review these rules' }))
    expect(screen.getByRole('region', { name: 'Review paper strategy rules' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Momentum research')).toBeInTheDocument()
  })
})
