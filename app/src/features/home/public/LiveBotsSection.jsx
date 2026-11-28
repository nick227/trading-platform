import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadPublicStrategies, pctText } from '../../strategies/strategiesApi'

const AI_TEMPLATE = 'tmpl_ai_catalyst_momentum'
const isAiStrategy = row => row.templateId === AI_TEMPLATE || row.tags?.includes('ai')

function evidenceFor(row) {
  const ai = isAiStrategy(row)
  const window = ai ? 'forward' : row.windows?.['1Y'] ? '1Y' : '5Y'
  return { window, ai, evidence: row.windows?.[window] }
}

function Metric({ label, value }) {
  return <div className="tl-public-result__metric"><dt>{label}</dt><dd>{value}</dd></div>
}

function ResultCard({ row }) {
  const { window, ai, evidence } = evidenceFor(row)
  const ready = evidence?.status === 'ok'
  const templateId = row.templateId
  return (
    <article className="tl-public-panel tl-public-result" data-testid="public-result-card">
      <div className="tl-public-result__topline">
        <span className="tl-public-result-type">{ai ? 'AI · FORWARD PAPER' : 'STRATEGY · HISTORICAL TEST'}</span>
        <span className="tl-public-result__window">{window === 'forward' ? 'Since publication' : window === '1Y' ? '1-year test' : '5-year test'}</span>
      </div>
      <h3>{row.name || row.title || templateId}</h3>
      {ready ? (
        <dl className="tl-public-result__metrics">
          <Metric label="Typical return" value={pctText(evidence.medianReturnPct)} />
          <Metric label="Buy-and-hold comparison" value={pctText(evidence.medianBuyAndHoldPct)} />
          <Metric label="Stocks tested" value={Number.isFinite(evidence.symbolsTested) ? evidence.symbolsTested : '—'} />
          <Metric label="Recorded trades" value={Number.isFinite(evidence.trades) ? evidence.trades : '—'} />
        </dl>
      ) : (
        <div className="tl-public-result__unavailable" role="status">{evidence?.status === 'awaiting_sessions' ? 'Awaiting forward paper sessions' : evidence?.status === 'not_backtestable' ? 'Historical test not available' : 'No completed results published'}</div>
      )}
      <span className="tl-public-result-meta">{ready ? 'Published simulated evidence' : 'No completed return available'}</span>
      <Link to={`/strategies/${encodeURIComponent(templateId)}`} className="tl-public-result-link">Inspect strategy and methodology <span aria-hidden="true">↗</span></Link>
    </article>
  )
}

function StrategyEvidence() {
  const [result, setResult] = useState({status:'loading',rows:[]})
  useEffect(() => {
    let active = true
    loadPublicStrategies()
      .then(data => { if (active) setResult({status:'ready',rows:Array.isArray(data) ? data : []}) })
      .catch(() => { if (active) setResult({status:'error',rows:[]}) })
    return () => { active = false }
  }, [])
  if (result.status === 'loading') return <div className="tl-public-panel tl-public-result-state" role="status">Loading published strategy evidence…</div>
  if (result.status === 'error') return <div className="tl-public-panel tl-public-result-state" role="status">Strategy data is temporarily unavailable. <Link to="/strategies">Browse strategies</Link></div>
  if (result.rows.length === 0) return <div className="tl-public-panel tl-public-result-state">No published strategy results yet. <Link to="/strategies">View strategies</Link></div>
  const selected = [...result.rows].sort((a,b) => Number(isAiStrategy(b)) - Number(isAiStrategy(a))).slice(0,3)
  return (
    <div className="tl-public-results-grid">
      {selected.map(row => <ResultCard row={row} key={row.templateId} />)}
    </div>
  )
}

export default function LiveBotsSection() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const el = document.getElementById('public-live-evidence')
    if (!el) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => { if (entries.some(x => x.isIntersecting)) { setVisible(true); observer.disconnect() } }, {rootMargin:'320px'})
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <section className="tl-public-section" id="public-live-evidence" aria-labelledby="live-evidence-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">PUBLISHED STRATEGY EVIDENCE</p>
        <h2 id="live-evidence-title">Review our performance</h2>
        <p>Explore published strategy results, compare historical performance, and inspect the trading activity recorded during supported simulations. Historical and forward paper observations are identified separately, including losses and incomplete records.</p>
      </header>
      <div className="tl-public-evidence-area">{visible ? <StrategyEvidence/> : <div className="tl-public-panel tl-public-result-state" aria-hidden="true">Strategy evidence</div>}</div>
      <p className="tl-public-disclosure">These results come from historical testing or simulated trades, not investor accounts. Results may include losses or incomplete records and do not predict future investment performance.</p>
      <Link className="tl-public-text-link" to="/strategies">Compare all published strategies <span aria-hidden="true">↗</span></Link>
    </section>
  )
}
