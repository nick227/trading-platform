
import { useCallback, useEffect, useState } from 'react'
import {
  approveMandate, createResearchPartner, createResearchSession, getResearchPartner,
  listResearchPartners, listResearchSessions, runResearchSession,
  getResearchSession, addResearchFeedback, createFollowUpResearch, interpretResearchMessage,
  listConversationDrafts, answerResearchClarification, closeConversationDraft
} from './researchPartnerApi'
import MandateDialoguePanel from './MandateDialoguePanel'
import ThesisHistory from './ThesisHistory'
import PaperStrategyStudio from './PaperStrategyStudio'
import ResearchMonitorPanel from './ResearchMonitorPanel'
import AgentHeader from '../../ui/agents/AgentHeader'
import ResearchViewLinks from './ResearchViewLinks'
import { researchAgentStatus } from '../../ui/agents/agentExperience'
import { resolveResearchIntent } from './researchIntent'
import './researchPartnerWorkspace.css'

const message = error => error?.serverMessage || error?.message || 'Request failed'

function Report({ session, onFeedback, onFollowUp, onRun, busy }) {
  const report = session?.report
  const [feedback, setFeedback] = useState('')
  const [category, setCategory] = useState('challenge')
  const [followUp, setFollowUp] = useState('')
  return <section className="tl-section" aria-label="Research report">
    <div className="tl-section-head"><h2 className="tl-section-title">Investigation</h2>
      <span className="tl-tag">{session.status}</span></div>
    <p className="tl-lead-sentence">{session.question}</p>
    {!report && <p className="tl-section-note">{session.status === 'queued'
      ? 'Research question saved. Model execution is optional and requires operator enablement.'
      : session.status === 'failed' ? 'Research could not be completed. The question remains in history.'
      : 'No research report available yet.'}</p>}
    {!report && session.status === 'queued' && <button className="tl-btn tl-btn--primary" type="button"
      disabled={busy} onClick={onRun}>Run research (uses configured AI budget)</button>}
    {report && <>
      <p>{report.summary}</p>
      {report.findings?.length > 0 && <div className="rp-findings">
        {report.findings.map((finding, i) => <article className="tl-card tl-card-shell" key={i}>
          <h3>{finding.claim}</h3>
          <p className="tl-small tl-muted">{finding.assessment}</p>
          <p>{finding.reasoning}</p>
          {finding.evidenceIds?.length > 0 && <p className="tl-small">Evidence: {finding.evidenceIds.map(id =>
            <a key={id} href={'#rp-source-' + encodeURIComponent(id)} className="rp-evidence-link">
              {report.evidence?.find(e => e.id === id)?.title || id}
            </a>)}</p>}
        </article>)}
      </div>}
      {report.evidence?.length > 0 && <div className="rp-sources">
        <h3>Sources consulted</h3>
        <ul>{report.evidence.map(e => <li key={e.id} id={'rp-source-' + encodeURIComponent(e.id)}>
          {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.title || e.source}</a> : (e.title || e.source)}
          <span className="tl-small tl-muted"> · {e.quality} · {e.publishedAt}</span>
        </li>)}</ul>
      </div>}
      {report.unavailableSources?.length > 0 && <p className="tl-section-note">
        Unavailable sources: {report.unavailableSources.map(e => e.sourceId).join(', ')}.
      </p>}
      {report.limitations?.length > 0 && <p className="tl-section-note">{report.limitations.join(' ')}</p>}
      {report.uncertainties?.length > 0 && <div><h3>Uncertainties</h3><ul>{report.uncertainties.map((item,i) => <li key={i}>{item}</li>)}</ul></div>}
      {report.followUpQuestions?.length > 0 && <div><h3>Follow-up questions</h3><ul>{report.followUpQuestions.map((item,i) => <li key={i}>{item}</li>)}</ul></div>}

      <div className="rp-preview">
        <h3>Review or challenge these findings</h3>
        {session.messages?.filter(m => m.sources?.kind === 'feedback').map(m =>
          <p key={m.id} className="tl-section-note">{m.sources.category}: {m.content}</p>)}
        <form className="rp-form" onSubmit={async event => {
          event.preventDefault()
          if (await onFeedback({ text: feedback, category })) setFeedback('')
        }}>
          <label htmlFor="rp-feedback-type">Feedback type</label>
          <select id="rp-feedback-type" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="challenge">Challenge conclusion</option>
            <option value="clarification">Request clarification</option>
            <option value="correction">Suggest a correction</option>
            <option value="additional_evidence">Add a research lead</option>
          </select>
          <label htmlFor="rp-feedback-text">Your feedback</label>
          <textarea id="rp-feedback-text" required maxLength={2000} rows={3}
            value={feedback} onChange={e => setFeedback(e.target.value)}/>
          <button className="tl-btn tl-btn--secondary" disabled={busy} type="submit">Save feedback</button>
        </form>
        <form className="rp-form" onSubmit={async event => {
          event.preventDefault()
          if (await onFollowUp(followUp)) setFollowUp('')
        }}>
          <label htmlFor="rp-follow-up-question">Investigate a follow-up question</label>
          <textarea id="rp-follow-up-question" required maxLength={6000} rows={2}
            value={followUp} onChange={e => setFollowUp(e.target.value)}/>
          <button className="tl-btn tl-btn--primary" disabled={busy} type="submit">Save follow-up investigation</button>
        </form>
      </div>
    </>}
  </section>
}

export default function ResearchPartnerWorkspace() {
  const [partners, setPartners] = useState([])
  const [partner, setPartner] = useState(null)
  const [sessions, setSessions] = useState([])
  const [selected, setSelected] = useState(null)
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [question, setQuestion] = useState('')
  const [directionSeed, setDirectionSeed] = useState('')
  const [interpretWithAI, setInterpretWithAI] = useState(false)
  const [proposedIntent, setProposedIntent] = useState(null)
  const [clarificationAnswer, setClarificationAnswer] = useState('')
  const [focus, setFocus] = useState('research')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    const items = await listResearchPartners()
    setPartners(items)
    if (items.length) {
      const full = await getResearchPartner(items[0].id)
      setPartner(full)
      setSessions(await listResearchSessions(full.id))
      const drafts = await listConversationDrafts(full.id)
      setProposedIntent(drafts.find(d => d.status === 'pending') || null)
    }
  }, [])
  useEffect(() => { let live = true
    load().catch(e => { if (live) setError(message(e)) })
    return () => { live = false }
  }, [load])
  async function action(fn) {
    setBusy(true); setError(''); setNotice('')
    try { return await fn() } catch (e) { setError(message(e)); return null }
    finally { setBusy(false) }
  }
  const onCreate = async event => {
    event.preventDefault()
    await action(async () => {
      const created = await createResearchPartner({ name, objective })
      const full = await getResearchPartner(created.id)
      setPartner(full); setPartners(old => [created, ...old]); setSessions([])
      setName(''); setObjective(''); setSelected(null); setFocus('research'); setDirectionSeed(''); setProposedIntent(null); setClarificationAnswer('')
    })
  }
  const onSelect = async id => {
    await action(async () => {
      setPartner(await getResearchPartner(id))
      setSessions(await listResearchSessions(id))
      setSelected(null)
      setFocus('research'); setDirectionSeed(''); setClarificationAnswer('')
      const drafts = await listConversationDrafts(id)
      setProposedIntent(drafts.find(d => d.status === 'pending') || null)
    })
  }
  const onFeedback = async input => action(async () => {
    await addResearchFeedback(partner.id, selected.id, input)
    setSelected(await getResearchSession(partner.id, selected.id))
    setNotice('Feedback saved without changing the original report.')
    return true
  })
  const onFollowUp = async text => action(async () => {
    const created = await createFollowUpResearch(partner.id, selected.id, text)
    setSessions(old => [created, ...old])
    setSelected(created)
    setNotice('New investigation saved with a link to the earlier report.')
    return true
  })
  const onSelectSession = async session => action(async () => {
    setSelected(await getResearchSession(partner.id, session.id))
    setProposedIntent(null)
    setFocus('research')
  })

  const executeResearchIntent = async intent => {
    if (intent.type === 'mandate_proposal') {
      if (intent.text.length > 700) {
        setError('Research direction proposals must be 700 characters or fewer.')
        return false
      }
      // Stage the governed dialogue. Approval is a separate user action.
      setDirectionSeed(intent.text)
      setQuestion('')
      setNotice('Review the direction proposal below. Your mandate will not change without approval.')
      return true
    }
    const result = await action(async () => {
      const followUpEligible = intent.type === 'follow_up' && intent.parentSessionId
      const created = followUpEligible
        ? await createFollowUpResearch(partner.id, intent.parentSessionId, intent.text)
        : await createResearchSession(partner.id, intent.text)
      setQuestion('')
      setSessions(old => [created, ...old])
      setSelected(created)
      setNotice(followUpEligible
        ? 'Follow-up saved and linked to the previous investigation. Run it when ready.'
        : 'Question saved. Run research explicitly when you are ready.')
      return true
    })
    return result === true
  }
  const onResearch = async event => {
    event.preventDefault()
    if (busy) return
    const text = question.trim()
    if (!text) return
    if (!interpretWithAI) {
      const result = await executeResearchIntent({ ...resolveResearchIntent(text, selected?.status === 'completed'),
        parentSessionId: selected?.status === 'completed' ? selected.id : null })
      if (result) setProposedIntent(null)
      return
    }
    await action(async () => {
      const draft = await interpretResearchMessage(
        partner.id, text, selected?.status === 'completed' ? selected.id : null
      )
      setProposedIntent(draft)
      setClarificationAnswer('')
      if (draft.proposal.type === 'clarify') {
        setNotice('The Research Partner needs one clarification before saving a request.')
      } else {
        setNotice('Review the proposed action. Nothing has been saved or executed.')
      }
    })
  }
  const onAnswerClarification = async event => {
    event.preventDefault()
    if (!proposedIntent || busy || !clarificationAnswer.trim()) return
    await action(async () => {
      const next = await answerResearchClarification(
        partner.id, proposedIntent.id, clarificationAnswer, proposedIntent.revision
      )
      setProposedIntent(next)
      setClarificationAnswer('')
      setNotice(next.proposal.type === 'clarify'
        ? 'More information is needed. Start a new interpretation if necessary.'
        : 'Review the proposed action before confirming.')
    })
  }
  const onConfirmInterpretation = async () => {
    if (!proposedIntent || proposedIntent.proposal.type === 'clarify' || busy) return
    // Bind to the persisted source session, not whatever the user happened to select later.
    const text = proposedIntent.answerText
      ? proposedIntent.requestText + ' Clarification: ' + proposedIntent.answerText
      : proposedIntent.requestText
    const success = await executeResearchIntent({
      type: proposedIntent.proposal.type, text, parentSessionId: proposedIntent.sessionId
    })
    if (!success) return
    try {
      await closeConversationDraft(partner.id, proposedIntent.id, proposedIntent.revision, 'confirmed')
      setProposedIntent(null)
    } catch (error) {
      setError('Action saved, but the conversation record could not be closed: ' + message(error))
      // Prevent duplicate creation from a stale confirmation.
      setProposedIntent(null)
    }
  }
  const onDismissInterpretation = async () => {
    if (!proposedIntent || busy) return
    await action(async () => {
      await closeConversationDraft(partner.id, proposedIntent.id, proposedIntent.revision, 'dismissed')
      setProposedIntent(null)
    })
  }
  const onRun = async () => {
    await action(async () => {
      const report = await runResearchSession(partner.id, selected.id)
      const completed = await getResearchSession(partner.id, selected.id)
      setSelected({ ...completed, report })
      setSessions(old => old.map(s => s.id === selected.id ? completed : s))
    })
  }
  return <main className="tl-page rp-page" data-testid="research-partner-workspace">
    <section className="tl-section">
      <AgentHeader title="AI Research Partner" kind="research"
        status={researchAgentStatus({partner,selected,busy,error})}
        description="Set the questions that matter to you. Investigate companies and ideas while preserving the evidence and conclusions."
        detail="Research only. No trade orders or brokerage connection."/>
    </section>
    {error && <div role="alert" className="tl-notice tl-notice--error">{error}</div>}
    {notice && <p role="status" className="tl-section-note">{notice}</p>}
    {partners.length > 1 && <section className="tl-section">
      <label htmlFor="rp-select">Research partner</label>
      <select id="rp-select" value={partner?.id || ''} disabled={busy} onChange={e => onSelect(e.target.value)}>
        {partners.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
      </select>
    </section>}
    {!partner && <section className="tl-section">
      <h2 className="tl-section-title">Create a research partner</h2>
      <form className="rp-form" onSubmit={onCreate}>
        <label htmlFor="rp-name">Name</label>
        <input id="rp-name" value={name} onChange={e => setName(e.target.value)}
          maxLength={120} required placeholder="AI infrastructure researcher" />
        <label htmlFor="rp-objective">What should it investigate?</label>
        <textarea id="rp-objective" value={objective} onChange={e => setObjective(e.target.value)}
          rows={4} maxLength={2000} required placeholder="Investigate businesses building data center infrastructure..." />
        <button className="tl-btn tl-btn--primary" type="submit" disabled={busy}>Create research partner</button>
      </form>
    </section>}
    {partner && <>
      <section className="tl-section rp-context">
        <div className="tl-section-head">
          <h2 className="tl-section-title">{partner.name}</h2>
          <span className="tl-tag">Mandate v{partner.currentMandateVersion}</span>
        </div>
        <p>{partner.mandate?.content?.objective}</p>
        <details className="rp-direction-disclosure" open={directionSeed ? true : undefined} key={directionSeed || partner.id}>
          <summary>Change research direction</summary>
          <p className="tl-section-note">Research goals are hypotheses, not verified claims. Changes require approval.</p>
          <MandateDialoguePanel key={directionSeed || partner.id} partner={partner} initialMessage={directionSeed}
            onApproved={async () => {
              setPartner(await getResearchPartner(partner.id))
              setDirectionSeed('')
              setNotice('Your approved research mandate is saved as a new version.')
            }} />
        </details>
      </section>
      <div className="rp-focused-workspace" key={partner.id}>
        {focus === 'research' && <>
          <section className="tl-section">
            <h2 className="tl-section-title">Investigate</h2>
            <form className="rp-form" onSubmit={onResearch}>
              <label htmlFor="rp-question">Ask your Research Partner</label>
              <textarea id="rp-question" value={question}
                onChange={e => { setQuestion(e.target.value); setProposedIntent(null) }}
                rows={3} maxLength={interpretWithAI ? 2000 : 6000} required
                placeholder="Ask a question, request a follow-up, or change your research direction…" />
              <label className="rp-ai-optin">
                <input type="checkbox" checked={interpretWithAI} disabled={busy}
                  onChange={e => { setInterpretWithAI(e.target.checked); setProposedIntent(null) }} />
                Use AI to interpret my request (uses configured research AI budget)
              </label>
              <button className="tl-btn tl-btn--primary" type="submit" disabled={busy}>
                {interpretWithAI ? 'Interpret request' : 'Continue'}
              </button>
            </form>
            {proposedIntent && <section className="rp-intent-proposal" aria-label="Proposed research action">
              <h3>{proposedIntent.proposal.type === 'clarify' ? 'Clarification needed' : 'Review proposed action'}</h3>
              <p>{proposedIntent.proposal.type === 'clarify'
                ? proposedIntent.proposal.clarification : proposedIntent.proposal.explanation}</p>
              <p className="tl-small tl-muted">Original request: {proposedIntent.requestText}</p>
              {proposedIntent.answerText && <p className="tl-small">Your clarification: {proposedIntent.answerText}</p>}
              {proposedIntent.proposal.type === 'clarify' && !proposedIntent.answerText && <form className="rp-form"
                onSubmit={onAnswerClarification}>
                <label htmlFor="rp-clarification-answer">Your answer</label>
                <textarea id="rp-clarification-answer" required maxLength={700} rows={2}
                  value={clarificationAnswer} onChange={e => setClarificationAnswer(e.target.value)} />
                <button type="submit" className="tl-btn tl-btn--primary" disabled={busy}>Continue interpretation</button>
              </form>}
              {proposedIntent.proposal.type !== 'clarify' && <>
                <p className="tl-small tl-muted">{
                  proposedIntent.proposal.type === 'mandate_proposal' ? 'Propose research direction' :
                    proposedIntent.proposal.type === 'follow_up' ? 'Save a linked follow-up' :
                      'Save a new investigation'
                } · No automatic model run, mandate approval, or trade.</p>
                <button type="button" className="tl-btn tl-btn--primary"
                  disabled={busy} onClick={onConfirmInterpretation}>Confirm proposed action</button>
              </>}
              <button type="button" className="tl-btn tl-btn--secondary"
                disabled={busy} onClick={onDismissInterpretation}>Dismiss proposal</button>
            </section>}
          </section>
          {selected && <Report key={selected.id} session={selected} onFeedback={onFeedback}
            onFollowUp={onFollowUp} onRun={onRun} busy={busy}/>}
          {!selected && <section className="tl-section rp-workspace-empty">
            <h3>Current investigation</h3>
            <p className="tl-section-note">Ask a question or open a previous investigation to review its findings.</p>
            {!!sessions.length && <button type="button" className="tl-btn tl-btn--secondary"
              onClick={() => setFocus('history')}>Open research history</button>}
          </section>}
        </>}
        {focus === 'strategies' && <PaperStrategyStudio key={'studio-'+partner.id}
          partnerId={partner.id} session={selected}/>}
        {focus === 'monitoring' && <ResearchMonitorPanel key={'monitor-'+partner.id}
          partnerId={partner.id} watchlist={partner.mandate?.content?.watchlist || []}/>}
        {focus === 'theses' && <ThesisHistory key={partner.id} partnerId={partner.id} session={selected}/>}
        {focus === 'history' && <section className="tl-section" aria-label="Research history">
          <h2 className="tl-section-title">Research history</h2>
          {!sessions.length && <p className="tl-section-note">No investigations yet.</p>}
          <div className="rp-history">{sessions.map(s => <button className="rp-history-item"
            key={s.id} onClick={() => onSelectSession(s)} type="button">
            <span>{s.question}</span>
            <span className="tl-small tl-muted">{s.status} · Mandate v{s.mandateVersion}</span>
          </button>)}</div>
        </section>}
      </div>
      <ResearchViewLinks current={focus} onSelect={setFocus}/>
    </>}
  </main>
}
