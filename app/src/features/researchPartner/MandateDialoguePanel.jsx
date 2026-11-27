
import { useState } from 'react'
import { approveResearchDialogue, continueResearchDialogue, startResearchDialogue } from './researchPartnerApi'
const errorText = e => e?.serverMessage || e?.message || 'Unable to update mandate'

/** A persistent draft dialog; approval is the only operation that changes the mandate. */
export default function MandateDialoguePanel({ partner, onApproved }) {
  const [draft, setDraft] = useState(null)
  const [message, setMessage] = useState('')
  const [useAI, setUseAI] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    const text = message.trim()
    if (!text || busy) return
    setBusy(true); setError('')
    try {
      const result = draft
        ? await continueResearchDialogue(partner.id, draft.id, { text, expectedRevision: draft.revision, useAI })
        : await startResearchDialogue(partner.id, { message: text, useAI })
      setDraft(result); setMessage('')
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  async function approve() {
    if (!draft || busy) return
    setBusy(true); setError('')
    try {
      await approveResearchDialogue(partner.id, draft.id, draft.revision)
      setDraft(null); setMessage('')
      await onApproved()
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  return <section className="rp-dialogue" aria-label="Research direction conversation">
    <div className="rp-dialogue-heading">
      <h3>Refine your research direction</h3>
      <p className="tl-section-note">Discuss your interests and hypotheses. Review the proposal before saving.</p>
    </div>
    {draft && <div className="rp-transcript">
      {draft.transcript?.map((turn, i) => <p key={i} className="rp-transcript-turn">
        <span className="tl-small tl-muted">You</span>{turn.content}
      </p>)}
      {draft.proposal?.clarifyingQuestions?.length > 0 && <div className="rp-clarifications">
        <strong>Questions to clarify</strong>
        <ul>{draft.proposal.clarifyingQuestions.map((question,i) => <li key={i}>{question}</li>)}</ul>
      </div>}
      <div className="rp-draft-summary">
        <strong>Proposed research mandate</strong>
        <p>{draft.proposal?.mandate?.objective}</p>
        <p className="tl-small tl-muted">Proposal only · Mandate v{draft.baseVersion} · {draft.proposal?.mode === 'manual_preview' ? 'Manual preview' : 'AI interpretation'}</p>
        <button className="tl-btn tl-btn--primary" type="button" disabled={busy} onClick={approve}>Approve this mandate</button>
      </div>
    </div>}
    {error && <p role="alert" className="tl-notice tl-notice--error">{error}</p>}
    <form className="rp-form" onSubmit={submit}>
      <label htmlFor="rp-dialogue-input">{draft ? 'Add information or answer a question' : 'What would you like the partner to investigate?'}</label>
      <textarea id="rp-dialogue-input" value={message} maxLength={700} required rows={3}
        onChange={e => setMessage(e.target.value)}
        placeholder="Focus on energy infrastructure with stable cash flow..." />
      <label className="rp-ai-optin">
        <input type="checkbox" checked={useAI} onChange={e => setUseAI(e.target.checked)} />
        Use AI to interpret my instructions (requires an enabled model budget)
      </label>
      <button className="tl-btn tl-btn--secondary" disabled={busy || (draft?.transcript?.length ?? 0) >= 10} type="submit">
        {draft ? 'Add to research direction' : 'Start research conversation'}
      </button>
    </form>
  </section>
}
