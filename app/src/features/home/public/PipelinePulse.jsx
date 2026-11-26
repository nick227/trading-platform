import { useEffect, useState } from 'react'
import { get } from '../../../api/client'

const STAGES = [
  ['market_data_ingestion', 'Market data'],
  ['pending_order_execution', 'Pending paper orders'],
  ['ai_research_decision', 'AI research decision'],
  ['portfolio_valuation', 'Portfolio valuation'],
  ['strategy_evidence_publication', 'Evidence publication'],
]
const STATES = {
  ok: 'Completed',
  skipped: 'Skipped',
  failed: 'Failed',
  in_progress: 'In progress',
  unrecorded: 'Not recorded',
}
function stateLabel(value) {
  return STATES[value] || 'Unreported'
}
function formatRecorded(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', {timeZone:'UTC',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}) : null
}

/** Read-only status from recorded events, not inferred progress or simulated live activity. */
export default function PipelinePulse() {
  const [state, setState] = useState({kind:'loading',data:null})
  useEffect(() => {
    let mounted = true
    async function refresh() {
      try {
        const data = await get('/public/strategies/tmpl_ai_catalyst_momentum/pipeline')
        if (mounted) setState({kind:'ready',data})
      } catch {
        if (mounted) setState({kind:'error',data:null})
      }
    }
    refresh()
    const timer = setInterval(() => { if (!document.hidden) refresh() }, 60000)
    return () => { mounted = false; clearInterval(timer) }
  }, [])
  if (state.kind === 'loading') return <div className="tl-public-panel tl-public-pipeline__state" role="status">Loading recorded pipeline stages…</div>
  if (state.kind === 'error') return <div className="tl-public-panel tl-public-pipeline__state" role="status">Pipeline activity is temporarily unavailable.</div>
  const data = state.data || {}
  if (data.status === 'bot_not_found') return <div className="tl-public-panel tl-public-pipeline__state">No canonical AI bot is currently reporting stage events.</div>
  const recorded = STAGES.filter(([key]) => data.stages?.[key]?.status === 'ok').length
  return (
    <div className="tl-public-panel tl-public-pipeline" data-testid="public-pipeline">
      <div className="tl-public-pipeline__summary">
        <div><h3>Recorded AI pipeline</h3><p>{recorded} of {STAGES.length} stages have a latest completed event; stage sessions may differ.</p></div>
        <div className="tl-public-pipeline__order-count"><strong>{Number.isInteger(data.pendingOrdersCount) ? data.pendingOrdersCount : '—'}</strong><span>Pending paper orders</span></div>
      </div>
      <ol className="tl-public-pipeline__list">
        {STAGES.map(([key,label], index) => {
          const item = data.stages?.[key] || {}
          const status = item.status || 'unrecorded'
          const recordedAt = formatRecorded(item.recordedAt)
          return <li key={key}>
            <span className="tl-public-pipeline__step">{index + 1}</span>
            <div className="tl-public-pipeline__label"><strong>{label}</strong>{item.session && <span>Session {item.session}</span>}{recordedAt && <span>Recorded {recordedAt}</span>}</div>
            <span className={`tl-public-pipeline__status tl-public-pipeline__status--${STATES[status] ? status : 'unrecorded'}`}>{stateLabel(status)}</span>
          </li>
        })}
      </ol>
      <p className="tl-public-pipeline__footnote">Latest recorded stage events, not a real-time execution feed. Missing events are shown as unrecorded; completing a stage does not establish trading profitability.</p>
    </div>
  )
}
