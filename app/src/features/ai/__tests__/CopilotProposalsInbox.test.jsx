import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CopilotProposalsInbox from '../CopilotProposalsInbox'
import { get, post } from '../../../api/client'

vi.mock('../../../api/client', () => ({
  get: vi.fn(),
  post: vi.fn()
}))

beforeEach(() => vi.clearAllMocks())

const samplePayload = {
  actionable: [
    {
      id: 'cprop_1',
      symbol: 'NVDA',
      action: 'BUY',
      quantity: 10,
      estimatedNotional: 1400,
      confidence: 0.82,
      status: 'pending_veto',
      deadlineLabel: 'Nov 27, 2026, 1:00 PM ET (NYSE early close)',
      thesis: 'Data-center demand backed by verified 10-Q filing.',
      evidence: ['SEC 10-Q filing confirms 94% YoY segment growth'],
      risks: ['Supply chain lead times']
    }
  ],
  recentResolved: [
    {
      id: 'cprop_0',
      symbol: 'AAPL',
      action: 'BUY',
      quantity: 5,
      estimatedNotional: 1100,
      status: 'executed',
      deadlineLabel: 'Nov 24, 2026, 4:00 PM ET (NYSE close)'
    }
  ]
}

describe('CopilotProposalsInbox', () => {
  it('displays NYSE exchange-calendar deadline and approves or cancels proposals deterministically', async () => {
    get.mockResolvedValue(samplePayload)
    post.mockResolvedValue({ ok: true })

    render(<CopilotProposalsInbox />)

    expect(await screen.findByTestId('copilot-proposals-inbox')).toBeInTheDocument()
    expect(screen.getByTestId('copilot-deadline-cprop_1')).toHaveTextContent(
      'Nov 27, 2026, 1:00 PM ET (NYSE early close)'
    )
    expect(screen.getByTestId('copilot-status-cprop_1')).toHaveTextContent('1-session review window')

    fireEvent.click(screen.getByTestId('copilot-approve-cprop_1'))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/ai/copilot-proposals/cprop_1/approve', {})
    )
  })
})
