import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { get } from '../../api/client'
import { ResearchEvidence } from '../ActivityFeed'

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

beforeEach(() => vi.clearAllMocks())

const open = (el) => { el.open = true; fireEvent(el, new Event('toggle')) }

describe('ResearchEvidence', () => {
  it('loads only when opened and shows digest verification', async () => {
    get.mockResolvedValue({ data: { status: 'verified_digest', evidence: { ticker: 'AAPL', direction: 'BUY', horizon: '5d', observedAt: '2026-11-19T00:00:00Z', entryPrice: 349.21, strategyId: 'trend_momentum_v1', ranking: { publicationId: 'pub_1', mode: 'historical_replay' } }, researchTrace: { evidenceSha256: 'abc123' } } })
    render(<ResearchEvidence executionId="x1" />)
    expect(get).not.toHaveBeenCalled()
    open(screen.getByTestId('research-evidence-x1'))
    expect(await screen.findByText('Verified')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/executions/x1/research')
    expect(screen.getByText('abc123')).toBeInTheDocument()
    expect(screen.getByText(/pub_1 \(historical replay\)/)).toBeInTheDocument()
  })

  it('says when evidence cannot be verified instead of showing it', async () => {
    get.mockResolvedValue({ data: { status: 'digest_mismatch' } })
    render(<ResearchEvidence executionId="x2" />)
    open(screen.getByTestId('research-evidence-x2'))
    expect(await screen.findByRole('status')).toHaveTextContent('can’t be verified')
    expect(screen.queryByText('Verified')).not.toBeInTheDocument()
  })
})
