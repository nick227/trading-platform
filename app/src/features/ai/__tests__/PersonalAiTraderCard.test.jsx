import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PersonalAiTraderCard from '../PersonalAiTraderCard'
import { get, put } from '../../../api/client'

vi.mock('../../../api/client', () => ({
  get: vi.fn(),
  put: vi.fn()
}))

const sampleUnconfigured = {
  configured: false,
  portfolio: {
    id: 'prt_paper_u1',
    name: 'Simulated Paper Portfolio',
    accountKind: 'default_simulated_paper',
    startingCash: 10000,
    simulated: true
  },
  bot: null,
  lifecycle: {
    state: 'not_configured',
    badge: 'Not configured',
    headline: 'Your Personal AI Trader is not set up yet.',
    whatHappensNext: 'Complete the 3-step structured setup to run autonomous paper research on your $10,000 simulated portfolio.',
    spendingGateActive: true
  },
  options: {
    riskProfiles: [
      { id: 'conservative', label: 'Conservative', maxPositionPct: 0.10, maxOrderNotional: 1000 },
      { id: 'balanced', label: 'Balanced', maxPositionPct: 0.15, maxOrderNotional: 1500 },
      { id: 'growth', label: 'Growth', maxPositionPct: 0.20, maxOrderNotional: 2000 }
    ],
    sectors: ['Financials', 'Healthcare', 'Technology'],
    approvalModes: [
      { id: 'paper_veto_1s', label: 'Copilot · 1-session review window (Recommended)' },
      { id: 'require_approval', label: 'Manual approval required' },
      { id: 'autopilot', label: 'Full paper autopilot' }
    ]
  }
}

beforeEach(() => vi.clearAllMocks())

describe('PersonalAiTraderCard', () => {
  it('renders structured 3-step setup and saves preferences without freeform text', async () => {
    get.mockResolvedValue(sampleUnconfigured)
    put.mockResolvedValue({
      ...sampleUnconfigured,
      configured: true,
      bot: {
        id: 'bot_personal_ai_u1',
        enabled: true,
        personalMandate: {
          riskProfile: 'conservative',
          sectors: ['Technology', 'Healthcare', 'Financials'],
          approvalMode: 'require_approval'
        }
      },
      lifecycle: {
        state: 'awaiting_next_close_research',
        badge: 'Active · Awaiting market close',
        headline: 'Your Personal AI Trader is active and ready for the next market close.',
        whatHappensNext: 'After the next NYSE session close (4:45 PM ET), it screens your chosen sectors.',
        spendingGateActive: false
      }
    })

    render(<PersonalAiTraderCard />)

    expect(await screen.findByTestId('personal-ai-trader-card')).toBeInTheDocument()
    expect(screen.getByTestId('personal-trader-lifecycle-badge')).toHaveTextContent('Not configured')
    expect(screen.getByTestId('personal-trader-next-step')).toHaveTextContent('Complete the 3-step structured setup')

    fireEvent.click(screen.getByTestId('personal-risk-conservative'))
    fireEvent.change(screen.getByTestId('personal-approval-mode'), {
      target: { value: 'require_approval' }
    })
    fireEvent.click(screen.getByTestId('personal-trader-save-btn'))

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/ai/personal-trader', {
        riskProfile: 'conservative',
        sectors: ['Technology', 'Healthcare', 'Financials'],
        approvalMode: 'require_approval',
        enabled: true
      })
    )
    expect(await screen.findByTestId('personal-trader-lifecycle-badge')).toHaveTextContent('Active · Awaiting market close')
  })
})
