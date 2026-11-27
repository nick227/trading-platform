
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ResearchPartnerWorkspace from '../ResearchPartnerWorkspace'
import * as api from '../researchPartnerApi'

vi.mock('../researchPartnerApi', () => ({
  listResearchPartners: vi.fn().mockResolvedValue([]),
  getResearchPartner: vi.fn(),
  listResearchSessions: vi.fn(),
  createResearchPartner: vi.fn(),
  proposeMandate: vi.fn(),
  approveMandate: vi.fn(),
  createResearchSession: vi.fn(),
  runResearchSession: vi.fn()
}))
describe('RP-05 research partner workspace', () => {
  it('provides a research-only create flow without simulated performance claims', async () => {
    render(<ResearchPartnerWorkspace />)
    await waitFor(() => expect(api.listResearchPartners).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: 'AI Research Partner' })).toBeTruthy()
    expect(screen.getByLabelText('What should it investigate?')).toBeTruthy()
    expect(screen.getByText('Research only. No trade orders or brokerage connection.')).toBeTruthy()
  })
})
