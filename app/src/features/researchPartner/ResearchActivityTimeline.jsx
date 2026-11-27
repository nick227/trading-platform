import { useCallback, useEffect, useState } from 'react'
import { listResearchActivity } from './researchPartnerApi'

const labels = Object.freeze({
  recorded: 'Recorded', completed: 'Completed', failed: 'Failed',
  in_progress: 'In progress', needs_input: 'Needs input', pending: 'Awaiting confirmation',
  dismissed: 'Dismissed', approved: 'Approved'
})
const showDate = value => {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Date unavailable'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
const message = err => err?.serverMessage || err?.message || 'Activity unavailable'

/** Server-projected history only. A displayed event never grants execution authority. */
export default function ResearchActivityTimeline({ partnerId, onOpenSession, onOpenStrategy }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(n => n + 1), [])
  useEffect(() => {
    let active = true
    setBusy(true)
    setError('')
    listResearchActivity(partnerId)
      .then(data => { if (active) setRows(data) })
      .catch(err => { if (active) { setRows([]); setError(message(err)) } })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [partnerId, revision])
  return <section className="tl-section rp-activity" aria-label="Research and paper activity">
    <div className="tl-section-head">
      <div>
        <h2 className="tl-section-title">Agent activity</h2>
        <p className="tl-section-note">Recorded research and manual paper simulation events. A proposal is not a decision, and a simulated fill is not a brokerage trade.</p>
      </div>
      <button type="button" className="tl-btn tl-btn--secondary" disabled={busy} onClick={refresh}>Refresh activity</button>
    </div>
    {busy && <p role="status">Loading recorded activity…</p>}
    {!busy && error && <div role="alert" className="rp-activity-error">
      <p>{error}. The activity record could not be verified.</p>
      <button type="button" className="tl-btn tl-btn--secondary" onClick={refresh}>Try again</button>
    </div>}
    {!busy && !error && !rows.length && <p className="tl-section-note">No activity is recorded for this research partner yet.</p>}
    {!busy && !error && <ol className="rp-activity-list">
      {rows.map(row => <li key={row.id} className="rp-activity-event">
        <div className="rp-activity-event__meta">
          <time dateTime={row.at}>{showDate(row.at)}</time>
          <span className={'rp-activity-status rp-activity-status--'+row.status}>{labels[row.status] || 'Recorded'}</span>
        </div>
        <h3>{row.title}</h3>
        <p>{row.detail}</p>
        {row.reference?.sessionId && <button className="tl-btn tl-btn--secondary" type="button"
          onClick={()=>onOpenSession(row.reference.sessionId)}>Review investigation</button>}
        {row.reference?.strategyId && <button className="tl-btn tl-btn--secondary" type="button"
          onClick={()=>onOpenStrategy(row.reference.strategyId)}>Review paper strategies</button>}
      </li>)}
    </ol>}
    <p className="tl-small tl-muted">Most recent 100 records from bounded source queries. This is a partial activity history, not a complete audit log.</p>
  </section>
}
