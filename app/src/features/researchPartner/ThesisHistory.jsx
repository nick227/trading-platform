
import { useEffect, useState } from 'react'
import { listResearchTheses, createResearchThesis, linkThesisFinding } from './researchPartnerApi'
const message = e => e?.serverMessage || e?.message || 'Unable to save thesis'
export default function ThesisHistory({ partnerId, session }) {
  const [theses, setTheses] = useState([])
  const [statement, setStatement] = useState('')
  const [selectedThesis, setSelectedThesis] = useState('')
  const [findingIndex, setFindingIndex] = useState('0')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = async () => setTheses(await listResearchTheses(partnerId))
  useEffect(() => { let live = true
    listResearchTheses(partnerId).then(rows => { if (live) setTheses(rows) })
      .catch(e => { if (live) setError(message(e)) })
    return () => { live = false }
  }, [partnerId])
  async function perform(fn) {
    setBusy(true); setError('')
    try { await fn(); await reload() } catch(e) { setError(message(e)) }
    finally { setBusy(false) }
  }
  return <section className="tl-section rp-theses" aria-label="Research thesis history">
    <div className="tl-section-head"><h2 className="tl-section-title">Research theses</h2></div>
    <p className="tl-section-note">Track how cited findings change across investigations. This does not measure investment returns or prove causation.</p>
    {error && <p className="tl-notice tl-notice--error" role="alert">{error}</p>}
    <form className="rp-form" onSubmit={e => { e.preventDefault(); perform(async () => {
      await createResearchThesis(partnerId, statement); setStatement('')
    }) }}>
      <label htmlFor="rp-thesis-input">New hypothesis to investigate</label>
      <textarea id="rp-thesis-input" required maxLength={600} rows={2} value={statement} onChange={e=>setStatement(e.target.value)}/>
      <button className="tl-btn tl-btn--secondary" type="submit" disabled={busy}>Save thesis</button>
    </form>
    {theses.length > 0 && <div className="rp-thesis-history">
      {theses.map(thesis => <article key={thesis.id} className="rp-thesis-row">
        <h3>{thesis.statement}</h3>
        <p className="tl-small tl-muted">{thesis.overview.latest} · {thesis.overview.assessments} linked assessments · {thesis.overview.transitions} changes in assessment</p>
        {thesis.assessments?.length > 0 && <ol>{thesis.assessments.map(a =>
          <li key={a.id}><span>{a.assessment}</span> — {a.claim} <span className="tl-small tl-muted">({new Date(a.recordedAt).toLocaleDateString()})</span></li>)}</ol>}
      </article>)}
    </div>}
    {session?.status === 'completed' && session.report?.findings?.length > 0 && theses.length > 0 &&
      <form className="rp-form" onSubmit={e => { e.preventDefault(); perform(() =>
        linkThesisFinding(partnerId, selectedThesis || theses[0].id, session.id, Number(findingIndex))) }}>
        <h3>Link a finding from the open investigation</h3>
        <label htmlFor="rp-thesis-select">Thesis</label>
        <select id="rp-thesis-select" value={selectedThesis || theses[0].id} onChange={e=>setSelectedThesis(e.target.value)}>
          {theses.map(t=><option key={t.id} value={t.id}>{t.statement}</option>)}
        </select>
        <label htmlFor="rp-finding-select">Recorded finding</label>
        <select id="rp-finding-select" value={findingIndex} onChange={e=>setFindingIndex(e.target.value)}>
          {session.report.findings.map((finding,i)=><option key={i} value={i}>{finding.assessment}: {finding.claim}</option>)}
        </select>
        <button className="tl-btn tl-btn--secondary" disabled={busy} type="submit">Link finding to thesis</button>
      </form>}
  </section>
}
