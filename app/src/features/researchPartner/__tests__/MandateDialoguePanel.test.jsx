
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MandateDialoguePanel from '../MandateDialoguePanel'
import * as api from '../researchPartnerApi'
vi.mock('../researchPartnerApi', () => ({
  startResearchDialogue: vi.fn(),
  continueResearchDialogue: vi.fn(),
  approveResearchDialogue: vi.fn()
}))
describe('RP-11 conversational mandate UI', () => {
  it('does not save mandate until explicit approval', async () => {
    vi.mocked(api.startResearchDialogue).mockResolvedValue({
      id: 'd1', baseVersion: 1, revision: 1,
      transcript: [{ role:'user', content:'Study clean power' }],
      proposal: { mandate: { objective: 'Study clean power' }, clarifyingQuestions: ['Focus on utilities?'], mode:'manual_preview' }
    })
    const approved = vi.fn()
    render(<MandateDialoguePanel partner={{ id:'p1' }} onApproved={approved}/>)
    fireEvent.change(screen.getByLabelText(/What would you like/), { target: { value:'Study clean power' } })
    fireEvent.click(screen.getByText('Start research conversation'))
    await waitFor(() => expect(screen.getByText('Focus on utilities?')).toBeTruthy())
    expect(api.approveResearchDialogue).not.toHaveBeenCalled()
    expect(approved).not.toHaveBeenCalled()
  })
})
