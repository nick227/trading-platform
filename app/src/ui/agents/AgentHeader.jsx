import { AGENT_STATES } from './agentExperience'
import './agentExperience.css'
/** Shared identity for the two distinct agents. Never authorizes actions. */
export default function AgentHeader({title,kind,status,description,detail,actions}) {
  const [label,context,tone]=AGENT_STATES[status]||AGENT_STATES.unavailable
  return <header className="tl-agent-head" data-testid="agent-header">
    <div className="tl-agent-head__top">
      <div className="tl-agent-head__identity">
        <span aria-hidden="true" className="tl-agent-head__symbol">{kind==='trader'?'◈':'◎'}</span>
        <div><h1 className="tl-section-title">{title}</h1>
          <p className="tl-agent-head__kind">{kind==='trader'?'Autonomous AI Trader':'User-directed Research Partner'}</p></div>
      </div>
      <span data-testid="agent-status" aria-label={'Agent status: '+label}
        className={'tl-agent-head__status tl-agent-head__status--'+tone}>
        <span aria-hidden="true" className="tl-agent-head__dot"/>{label}
      </span>
    </div>
    {description&&<p className="tl-lead-sentence">{description}</p>}
    {detail&&<p className="tl-section-note">{detail}</p>}
    <p className="tl-agent-head__context">{context}</p>
    {actions&&<div className="tl-agent-head__actions">{actions}</div>}
  </header>
}
