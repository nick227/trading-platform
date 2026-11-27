import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import StrategyResultsEvidence from '../StrategyResultsEvidence'
import { getPaperForwardAccount, listPaperStrategyBacktests } from '../researchPartnerApi'

vi.mock('../researchPartnerApi', () => ({
  getPaperForwardAccount: vi.fn(), listPaperStrategyBacktests: vi.fn()
}))

const strategy = { id: 'strategy1', name: 'Paper momentum', currentVersion: 2,
  versions: [{ version: 2, provenance: { kind: 'research_finding',
    sessionId: 'research1', findingIndex: 0, sourceStatus: 'cited_unverified_interpretation',
    finding: { claim: 'Momentum may continue', assessment: 'inconclusive' },
    sources: [{ id: 's1', title: 'Company report', url: 'https://example.com/report' }] } }] }
beforeEach(() => {
  vi.resetAllMocks()
  listPaperStrategyBacktests.mockResolvedValue([])
  getPaperForwardAccount.mockRejectedValue({ status: 404 })
})
describe('strategy evidence and results review', () => {
  it('shows research source and distinct empty performance states', async () => {
    render(<StrategyResultsEvidence partnerId="p" strategy={strategy} onClose={vi.fn()} />)
    expect(await screen.findByText('Momentum may continue')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Company report' })).toHaveAttribute('href', 'https://example.com/report')
    expect(screen.getByText(/No saved historical simulation/)).toBeInTheDocument()
    expect(screen.getByText(/No forward paper account was activated/)).toBeInTheDocument()
    expect(screen.getByText(/do not prove that the cited research caused/)).toBeInTheDocument()
  })
  it('does not count results from an earlier version', async () => {
    listPaperStrategyBacktests.mockResolvedValue([
      { id:'old', version:1, startSession:'2026-01-01', endSession:'2026-02-01', result:{returnPct:99} },
      { id:'current', version:2, startSession:'2026-05-01', endSession:'2026-06-01',
        result:{returnPct:-2, maxDrawdownPct:-4, fillCount:2, endingEquity:9800} }
    ])
    getPaperForwardAccount.mockResolvedValue({ version:1, status:'paused', cycles:[
      { session:'2026-11-26', result:{equity:20000, returnPct:100, filled:[{}]} }
    ] })
    render(<StrategyResultsEvidence partnerId="p" strategy={strategy} onClose={vi.fn()} />)
    expect(await screen.findByText('-2%')).toBeInTheDocument()
    expect(screen.queryByText('99%')).not.toBeInTheDocument()
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
    expect(screen.getByText(/belongs to an earlier strategy version/)).toBeInTheDocument()
  })
  it('treats fetch failure as unknown rather than an empty result', async () => {
    listPaperStrategyBacktests.mockRejectedValueOnce(new Error('Service unavailable'))
      .mockResolvedValueOnce([])
    render(<StrategyResultsEvidence partnerId="p" strategy={strategy} onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence and performance are unavailable')
    expect(screen.queryByText(/No saved historical simulation/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(listPaperStrategyBacktests).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Momentum may continue')).toBeInTheDocument()
  })
})
