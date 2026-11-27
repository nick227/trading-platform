import {describe,it,expect} from 'vitest'
import {render,screen} from '@testing-library/react'
import AgentHeader from '../AgentHeader'
import {researchAgentStatus,traderAgentStatus} from '../agentExperience'
describe('Shared agent experience',()=>{
  it('does not mistake saved questions for active research',()=>{
    expect(researchAgentStatus({partner:{id:'p'},selected:{status:'queued'}})).toBe('question_saved')
    expect(researchAgentStatus({partner:{id:'p'},busy:true})).toBe('working')
    expect(researchAgentStatus({partner:{id:'p'},selected:{status:'completed',report:{}}})).toBe('findings_available')
  })
  it('shows truthful paper permissions and errors',()=>{
    expect(traderAgentStatus({requestStatus:'ready',dataStatus:'enabled'})).toBe('enabled')
    expect(traderAgentStatus({requestStatus:'error',dataStatus:'enabled'})).toBe('unavailable')
  })
  it('renders accessible identity and status without trading authority',()=>{
    render(<AgentHeader title="Research Agent" kind="research" status="question_saved"
      description="Explore ideas" detail="No brokerage connection."/>)
    expect(screen.getByRole('heading',{name:'Research Agent',level:1})).toBeInTheDocument()
    expect(screen.getByLabelText('Agent status: Ready for research')).toBeInTheDocument()
    expect(screen.getByText(/research has not started/)).toBeInTheDocument()
    expect(screen.getByText('No brokerage connection.')).toBeInTheDocument()
  })
})
