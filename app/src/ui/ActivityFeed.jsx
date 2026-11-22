import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getExecutionResearch } from '../api/services/botDashboardService'
import { ago, dateTime, money, ratioPct, sessionDate } from './format'

/**
 * One activity list for Home, Bots and the bot record. Items come from
 * botDashboardService.buildTimeline (optionally tagged with botId/botName).
 *   lens 'all' | 'trades' | 'decisions'
 */
const TRADES = new Set(['order', 'fill'])
const DECISIONS = new Set(['signal', 'evaluation', 'skip', 'risk', 'error'])
const ROUTINE = new Set(['evaluation', 'skip'])

export const LENSES = [
  { id: 'all', label: 'All' },
  { id: 'trades', label: 'Trades' },
  { id: 'decisions', label: 'Decisions' },
]

export function inLens(item, lens) {
  if (lens === 'trades') return TRADES.has(item.category) || (item.category === 'error' && item.executionId)
  if (lens === 'decisions') return DECISIONS.has(item.category)
  return true
}

/** Collapses repeated routine checks (anywhere in the list) into their newest entry. */
export function collapseRoutine(items) {
  const out = []
  const seen = new Map()
  for (const item of items) {
    if (ROUTINE.has(item.category)) {
      const key = `${item.botId ?? ''}|${item.category}|${item.title}|${item.symbol ?? ''}`
      const prev = seen.get(key)
      if (prev) {
        prev.count += item.count ?? 1
        prev.since = item.since ?? item.at
        continue
      }
      const copy = { ...item, count: item.count ?? 1, since: item.since ?? item.at }
      seen.set(key, copy)
      out.push(copy)
      continue
    }
    out.push(item)
  }
  return out
}

export function FeedIcon({ item }) {
  const sell = item.category === 'fill' && /^Sold/.test(item.title)
  const kind = sell ? 'sell' : item.category
  const paths = {
    fill: <path d="M8 3.5v9M3.5 8h9" />,
    sell: <path d="M3.5 8h9" />,
    order: <><circle cx="8" cy="8" r="4.5" /><path d="M8 5.8V8l1.6 1.2" /></>,
    signal: <path d="M2.5 10.5l3-3 2.5 2.5 5-5.5M10 4.5h3v3" />,
    evaluation: <><path d="M6 4.5v7M10 4.5v7" /></>,
    skip: <><path d="M6 4.5v7M10 4.5v7" /></>,
    risk: <path d="M8 2.5l4.5 1.8v3.4c0 2.6-1.9 4.6-4.5 5.8-2.6-1.2-4.5-3.2-4.5-5.8V4.3z" />,
    error: <><path d="M8 4v5" /><circle cx="8" cy="11.6" r="0.6" fill="currentColor" /></>,
    control: <path d="M8 2.8v4.4M4.6 5a4.6 4.6 0 1 0 6.8 0" />,
  }
  return (
    <span className={`tl-feed-icon tl-feed-icon--${kind}`} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {paths[kind] ?? <circle cx="8" cy="8" r="2" />}
      </svg>
    </span>
  )
}

function ResearchLine({ research }) {
  if (!research) return null
  const h = research.holdout
  return (
    <p className="tl-feed-text tl-muted">
      {research.direction ?? 'Research'} · {research.horizon ?? 'n/a'} horizon
      {h && <> · holdout {ratioPct(h.precision)} vs {ratioPct(h.baselineRate)} baseline</>}
      {research.edgeOverBaseline === false && <> · <span className="tl-verdict tl-verdict--noedge">no proven edge</span></>}
      {research.edgeOverBaseline === true && <> · <span className="tl-verdict tl-verdict--edge">beat its baseline</span></>}
      {research.simulation?.mode === 'historical_replay' && <> · replay of {sessionDate(research.simulation.session)}</>}
    </p>
  )
}

/** Archived, digest-verified research for an order — loaded on open. */
export function ResearchEvidence({ executionId }) {
  const [state, setState] = useState({ status: 'idle' })
  const onToggle = async (e) => {
    if (!e.currentTarget.open || state.status !== 'idle') return
    setState({ status: 'loading' })
    try {
      setState({ status: 'done', data: await getExecutionResearch(executionId) })
    } catch {
      setState({ status: 'error' })
    }
  }
  const d = state.data
  const ev = d?.evidence
  return (
    <details className="tl-evidence" onToggle={onToggle} data-testid={`research-evidence-${executionId}`}>
      <summary>Research evidence</summary>
      <div className="tl-evidence-body">
        {state.status === 'loading' && <span className="tl-muted">Loading…</span>}
        {state.status === 'error' && <span className="tl-neg">Couldn’t load the evidence. Try again later.</span>}
        {state.status === 'done' && d?.status !== 'verified_digest' && (
          <span role="status">{d?.status === 'unavailable' ? 'No research decision is linked to this order.' : `Evidence check: ${d?.status ?? 'unknown'} — this order’s research can’t be verified.`}</span>
        )}
        {state.status === 'done' && d?.status === 'verified_digest' && (
          <dl>
            <dt>Integrity</dt><dd><strong className="tl-pos">Verified</strong> — archived evidence matches its SHA-256 digest <span className="tl-muted">(integrity, not accuracy)</span></dd>
            <dt>Prediction</dt><dd>{ev?.ticker} {ev?.direction} · {ev?.horizon} · observed {String(ev?.observedAt ?? '').slice(0, 10)}</dd>
            <dt>Entry price</dt><dd>{money(ev?.entryPrice)}</dd>
            <dt>Model</dt><dd>{ev?.strategyId ?? '—'}</dd>
            <dt>Publication</dt><dd>{ev?.ranking?.publicationId ?? '—'}{ev?.ranking?.mode === 'historical_replay' ? ' (historical replay)' : ''}</dd>
            <dt>Digest</dt><dd className="tl-muted">{d.researchTrace?.evidenceSha256}</dd>
          </dl>
        )}
      </div>
    </details>
  )
}

export default function ActivityFeed({
  items,
  lens: initialLens = 'all',
  showLensControl = true,
  limit = 8,
  showBot = true,
  empty = 'Nothing has happened yet.',
  testId = 'activity-list',
  routine = 'inline', // 'inline' | 'summary' — summary folds routine checks into one line
}) {
  const [lens, setLens] = useState(initialLens)
  const [shown, setShown] = useState(limit)
  const [showRoutine, setShowRoutine] = useState(false)
  const all = useMemo(() => collapseRoutine((items ?? []).filter((i) => inLens(i, lens))), [items, lens])
  const routineItems = all.filter((i) => ROUTINE.has(i.category))
  const folding = routine === 'summary' && !showRoutine && routineItems.length > 0
  const visible = folding ? all.filter((i) => !ROUTINE.has(i.category)) : all
  const routineCount = routineItems.reduce((n, i) => n + (i.count ?? 1), 0)
  const routineKinds = [...new Set(routineItems.map((i) => i.title.replace(/^(Waiting|Skipped)\s*—\s*/, '').toLowerCase()))]

  return (
    <div>
      {showLensControl && (items ?? []).length > 0 && (
        <div className="tl-seg" role="group" aria-label="Filter activity" style={{ margin: '14px 0 2px' }}>
          {LENSES.map((l) => (
            <button key={l.id} type="button" aria-pressed={lens === l.id} onClick={() => { setLens(l.id); setShown(limit) }}>{l.label}</button>
          ))}
        </div>
      )}
      {visible.length === 0 && !folding ? (
        <p className="tl-feed-empty">{lens === 'all' ? empty : lens === 'trades' ? 'No orders or fills yet.' : 'No decisions recorded yet.'}</p>
      ) : (
        <ol className="tl-feed" data-testid={testId}>
          {visible.slice(0, shown).map((item) => (
            <li key={`${item.botId ?? ''}:${item.id}`} className="tl-feed-item">
              <FeedIcon item={item} />
              <div>
                <div className="tl-feed-title">
                  {item.title}
                  {item.symbol && !item.title.includes(item.symbol) && <> · {item.symbol}</>}
                  {item.count > 1 && <span className="tl-feed-repeat" title={`Since ${dateTime(item.since)}`}>×{item.count}</span>}
                  {showBot && item.botName && (
                    <> <span className="tl-feed-bot">· <Link to={`/bots/${item.botId}`}>{item.botName}</Link></span></>
                  )}
                </div>
                {item.explanation && <p className="tl-feed-text">{item.explanation}</p>}
                <ResearchLine research={item.research} />
                {item.executionId && item.category === 'fill' && item.researchBot !== false && <ResearchEvidence executionId={item.executionId} />}
              </div>
              <time className="tl-feed-time" dateTime={item.at ?? undefined} title={dateTime(item.at)}>{ago(item.at)}</time>
            </li>
          ))}
        </ol>
      )}
      {folding && (
        <p className="tl-small tl-muted" style={{ margin: '12px 0 0' }} data-testid="routine-summary">
          {visible.length === 0 ? 'No orders or decisions yet. ' : ''}
          {routineCount} routine {routineCount === 1 ? 'check' : 'checks'} without a trade ({routineKinds.slice(0, 3).join('; ')}).{' '}
          <button type="button" className="tl-link-btn tl-small" onClick={() => setShowRoutine(true)}>Show them</button>
        </p>
      )}
      {visible.length > shown && (
        <button type="button" className="tl-btn tl-btn--sm tl-feed-more" onClick={() => setShown((n) => n + 12)}>
          Show more ({visible.length - shown})
        </button>
      )}
    </div>
  )
}
