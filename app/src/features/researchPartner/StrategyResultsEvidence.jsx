import { useEffect, useState } from 'react'
import { getPaperForwardAccount, listPaperStrategyBacktests } from './researchPartnerApi'
import { secureEvidenceUrl, strategyEvidenceView } from './strategyEvidenceView'

const missing = error => [error?.status, error?.statusCode, error?.response?.status].includes(404)
const describe = error => error?.serverMessage || error?.message || 'Results could not be loaded'
const metric = (value, suffix = '') => Number.isFinite(value) ? String(value) + suffix : 'Unavailable'
const money = value => Number.isFinite(value)
  ? value.toLocaleString('en-US', { style:'currency', currency:'USD' }) : 'Unavailable'

/** Source-backed explanation; never generates a causal AI narrative. */
export default function StrategyResultsEvidence({ partnerId, strategy, onClose }) {
  const [runs, setRuns] = useState([])
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setRuns([]); setAccount(null)
    Promise.all([
      listPaperStrategyBacktests(partnerId, strategy.id),
      getPaperForwardAccount(partnerId, strategy.id).catch(err => {
        if (missing(err)) return null
        throw err
      })
    ]).then(([history, paper]) => {
      if (!active) return
      setRuns(history)
      setAccount(paper)
    }).catch(err => { if (active) setError(describe(err)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [partnerId, strategy.id, strategy.currentVersion, revision])

  const view = strategyEvidenceView({ strategy, runs, account })
  const finding = view.provenance?.finding
  return <section className="rp-results-evidence" aria-label={'Evidence and results for '+strategy.name}>
    <header className="rp-results-head">
      <div>
        <h4>Evidence and results · {strategy.name}</h4>
        <p className="tl-section-note">Strategy version {view.version} · read-only history · paper trading only</p>
      </div>
      <div className="rp-results-actions">
        <button type="button" className="tl-btn tl-btn--secondary"
          disabled={loading} onClick={()=>setRevision(x=>x+1)}>Refresh</button>
        <button type="button" className="tl-btn tl-btn--secondary" onClick={onClose}>Close</button>
      </div>
    </header>
    {loading && <p role="status">Loading recorded evidence and results…</p>}
    {!loading && error && <div className="tl-notice tl-notice--error" role="alert">
      <p>{error}. Evidence and performance are unavailable until records can be verified.</p>
      <button type="button" className="tl-btn tl-btn--secondary"
        onClick={()=>setRevision(x=>x+1)}>Retry loading</button>
    </div>}
    {!loading && !error && <>
      <section className="rp-results-section" aria-label="Research rationale">
        <h5>Research basis</h5>
        {!view.hasResearch ? <p>No research finding was linked to this strategy version. The trading rules alone do not establish why they should work.</p> : <>
          <p><strong>Recorded hypothesis:</strong> {finding?.claim || 'Unavailable'}</p>
          <p><strong>Research assessment:</strong> {finding?.assessment || 'Inconclusive'}</p>
          <p className="tl-section-note">{view.sourceStatus}</p>
          <p className="tl-small tl-muted">Research session: {view.provenance.sessionId} · finding {view.provenance.findingIndex + 1}</p>
          {view.provenance.sources?.length > 0 && <>
            <h6>Sources cited by the original research finding</h6>
            <ul>{view.provenance.sources.map((source,i) => <li key={source.id || i}>
              {secureEvidenceUrl(source.url)
                ? <a href={secureEvidenceUrl(source.url)} target="_blank" rel="noopener noreferrer">
                    {source.title || source.source || 'Source'}
                  </a>
                : <span>{source.title || source.source || 'Source reference unavailable'}</span>}
              {source.publishedAt && <span className="tl-small tl-muted"> · published {source.publishedAt}</span>}
            </li>)}</ul>
          </>}
        </>}
      </section>
      <section className="rp-results-section" aria-label="Historical performance">
        <h5>Historical simulation</h5>
        {!view.hasHistorical ? <p>No saved historical simulation for the current strategy version. No return or drawdown is established.</p> : <>
          <p>{view.historical.length} recorded historical run(s) for this version. Latest: {view.latestHistorical.startSession} – {view.latestHistorical.endSession}</p>
          <dl className="rp-results-metrics">
            <div><dt>Simulated return</dt><dd>{metric(view.latestHistorical.result?.returnPct,'%')}</dd></div>
            <div><dt>Maximum drawdown</dt><dd>{metric(view.latestHistorical.result?.maxDrawdownPct,'%')}</dd></div>
            <div><dt>Simulated fills</dt><dd>{metric(view.latestHistorical.result?.fillCount)}</dd></div>
            <div><dt>Ending simulated equity</dt><dd>{money(view.latestHistorical.result?.endingEquity)}</dd></div>
          </dl>
          <p className="tl-section-note">Historical assumptions include zero slippage and fees; this is not live or forward performance.</p>
        </>}
      </section>
      <section className="rp-results-section" aria-label="Forward paper results">
        <h5>Forward paper simulation</h5>
        {!account ? <p>No forward paper account was activated for this strategy.</p> : <>
          <p>Account status: <strong>{account.status}</strong> · pinned strategy version {account.version}</p>
          {!view.accountMatches ? <p role="status">This account belongs to an earlier strategy version. Its results are not attributed to the current version.</p>
            : !view.hasPaper ? <p>The paper account exists, but no completed simulation sessions are recorded.</p>
              : <>
                <p>Most recent simulated session: {view.latestPaper.session}</p>
                <dl className="rp-results-metrics">
                  <div><dt>Paper account equity</dt><dd>{money(view.latestPaper.result?.equity)}</dd></div>
                  <div><dt>Paper return</dt><dd>{metric(view.latestPaper.result?.returnPct,'%')}</dd></div>
                  <div><dt>Simulated fills</dt><dd>{metric(view.latestPaper.result?.filled?.length)}</dd></div>
                  <div><dt>Rejected simulated orders</dt><dd>{metric(view.latestPaper.result?.rejected?.length)}</dd></div>
                </dl>
              </>}
        </>}
      </section>
      <section className="rp-results-section" aria-label="Limitations and interpretation">
        <h5>What these results do not establish</h5>
        <ul>{view.limitations.map(item=><li key={item}>{item}</li>)}</ul>
        <p className="tl-section-note">These records show what was saved and simulated; they do not prove that the cited research caused the observed performance.</p>
      </section>
    </>}
  </section>
}
