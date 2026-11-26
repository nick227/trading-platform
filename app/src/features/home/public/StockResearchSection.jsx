import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get } from '../../../api/client'

const TOP_COUNT = 5

function formatDate(value) {
  if (!value) return 'Publication date unavailable'
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime())
    ? `Data as of ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone:'UTC' }).format(parsed)}`
    : 'Publication date unavailable'
}

function Candidates() {
  const [state, setState] = useState({status:'loading', data:null})
  useEffect(() => {
    let active = true
    get('/engine/rankings/top', {limit: TOP_COUNT})
      .then(data => { if (active) setState({status:'ready',data}) })
      .catch(() => { if (active) setState({status:'error',data:null}) })
    return () => { active = false }
  }, [])

  if (state.status === 'loading') return <div className="tl-public-panel tl-public-picker-state" role="status">Loading published stock rankings…</div>
  if (state.status === 'error') return <div className="tl-public-panel tl-public-picker-state" role="status">Stock ranking data is temporarily unavailable. Sign in to access the research workspace.</div>

  const data = state.data
  const rows = Array.isArray(data?.rankings) ? data.rankings.slice(0, TOP_COUNT) : []
  if (rows.length === 0) return <div className="tl-public-panel tl-public-picker-state">No stock candidates are currently published.</div>

  const asOf = data?.as_of ?? data?.asOf ?? data?.snapshot_ts_latest
  return (
    <div className="tl-public-panel tl-public-picker" data-testid="public-stock-picker">
      <div className="tl-public-picker__head">
        <div>
          <p className="tl-public-picker__eyebrow">ALPHA ENGINE RESEARCH SNAPSHOT</p>
          <h3>Ranked stock candidates</h3>
        </div>
        <span className="tl-public-picker__date">{formatDate(asOf)}</span>
      </div>
      <ol className="tl-public-picker__list">
        {rows.map((row, index) => {
          const symbol = String(row.symbol ?? row.ticker ?? '').trim().toUpperCase()
          if (!/^[A-Z0-9.^-]{1,15}$/.test(symbol)) return null
          const score = typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : null
          const rank = Number.isInteger(row.currentRank) && row.currentRank > 0 ? row.currentRank : Number.isInteger(row.rank) && row.rank > 0 ? row.rank : index + 1
          return (
            <li key={symbol}>
              <span className="tl-public-picker__rank">{rank}</span>
              <strong>{symbol}</strong>
              <span className="tl-public-picker__score">{score === null ? 'Score not published' : `Research score ${score.toFixed(1)}`}</span>
            </li>
          )
        })}
      </ol>
      <div className="tl-public-picker__foot">
        <p>Ranked research observations—not buy orders or predictions of returns. Data quality and trading eligibility can differ from ranking position.</p>
        <Link to="/research" className="tl-public-text-link">Open stock research <span aria-hidden="true">↗</span></Link>
      </div>
    </div>
  )
}

export default function StockResearchSection() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const el = document.getElementById('public-stock-research')
    if (!el) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => { if (entries.some(x => x.isIntersecting)) { setVisible(true); observer.disconnect() } }, {rootMargin:'320px'})
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <section className="tl-public-section" id="public-stock-research" aria-labelledby="public-stock-research-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">STOCK RESEARCH</p>
        <h2 id="public-stock-research-title">AI-assisted research identifies and ranks market opportunities.</h2>
        <p>TradeLoom's Alpha Engine analyzes available market data and publishes ranked stock candidates for further investigation. Research scores and supporting information are available in the signed-in workspace.</p>
      </header>
      {visible ? <Candidates /> : <div className="tl-public-panel tl-public-picker-state" aria-hidden="true">Stock research</div>}
      <p className="tl-public-disclosure">Rankings are research output, not personalized advice or trading instructions. A rank does not establish model accuracy, investment quality, or an expected return.</p>
    </section>
  )
}
