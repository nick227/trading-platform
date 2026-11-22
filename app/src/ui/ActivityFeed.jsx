import { useEffect, useMemo, useState } from 'react'
import Disclosure from './Disclosure'
import { Link } from 'react-router-dom'
import { getExecutionResearch } from '../api/services/botDashboardService'
import { ago, dateTime, money, ratioPct, sessionDate } from './format'

/**
 * One activity list for Home, Bots and the bot record. Items come from
 * botDashboardService.buildTimeline (optionally tagged with botId/botName/researchBot).
 *
 * Every trade is ONE row: its signal, research decision, risk verdict, order and fill are
 * folded into an expandable decision trail — nothing is dropped, so the audit trail stays
 * complete. Routine checks (waiting, skipped) collapse into counted rows.
 *   lens 'all' | 'trades' | 'decisions'
 */
const ROUTINE = new Set(['evaluation', 'skip'])
const SIGNAL_ATTACH_MS = 15_000

export const LENSES = [
  { id: 'all', label: 'All' },
  { id: 'trades', label: 'Trades' },
  { id: 'decisions', label: 'Decisions' },
]

export function inLens(item, lens) {
  if (lens === 'trades') return item.kind === 'trade'
  if (lens === 'decisions') return item.kind !== 'trade' || Boolean(item.steps?.some((s) => s.research || s.category === 'risk' || s.category === 'signal'))
  return true
}

const ms = (iso) => new Date(iso ?? 0).getTime()

/**
 * Folds timeline items into trade rows (one per bot + execution) and keeps everything
 * else as individual rows. Input and output are newest-first.
 */
export function groupTrades(items) {
  const asc = [...(items ?? [])].sort((a, b) => ms(a.at) - ms(b.at))
  const groups = new Map() // key -> group
  const rows = []
  const pendingSignals = [] // rule signals waiting for the order they produced

  for (const item of asc) {
    const botKey = item.botId ?? ''
    if (item.executionId && item.category !== 'evaluation' && item.category !== 'skip') {
      const key = `${botKey}|${item.executionId}`
      let g = groups.get(key)
      if (!g) {
        g = { id: `trade:${key}`, kind: 'trade', botId: item.botId, botName: item.botName, researchBot: item.researchBot, executionId: item.executionId, symbol: item.symbol, steps: [] }
        groups.set(key, g)
        rows.push(g)
        // A rule signal logged just before this order belongs to it.
        const i = pendingSignals.findIndex((s) => s.botId === item.botId && s.symbol === item.symbol && ms(item.at) - ms(s.at) <= SIGNAL_ATTACH_MS)
        if (i >= 0) {
          g.steps.push(pendingSignals[i])
          rows.splice(rows.indexOf(pendingSignals[i]), 1)
          pendingSignals.splice(i, 1)
        }
      }
      g.steps.push(item)
      continue
    }
    if (item.category === 'signal' && !item.executionId) pendingSignals.push(item)
    rows.push(item)
  }

  for (const g of groups.values()) {
    // Head row = the trade's outcome: the fill, else cancelled/rejected, else the order.
    const fill = [...g.steps].reverse().find((s) => s.category === 'fill')
    const outcome = [...g.steps].reverse().find((s) => s.outcome)
    const order = [...g.steps].reverse().find((s) => s.category === 'order' || s.category === 'error')
    const head = fill ?? outcome ?? order ?? g.steps[g.steps.length - 1]
    g.at = head.at
    g.category = fill ? 'fill' : head.category
    g.title = head.title
    g.symbol = head.symbol ?? g.symbol
    g.explanation = head.explanation
    g.simulated = Boolean(fill?.simulated)
    g.testScenario = g.steps.some((s) => s.testScenario)
    g.research = g.steps.find((s) => s.research)?.research ?? null
    g.filled = Boolean(fill)
  }
  return rows.sort((a, b) => ms(b.at) - ms(a.at))
}

/** Collapses repeated routine checks (anywhere in the list) into their newest entry. */
export function collapseRoutine(items) {
  const out = []
  const seen = new Map()
  for (const item of items) {
    // Routine checks and repeated rule-level blocks (no order involved) collapse into one
    // counted row; only routine checks are folded away on summary views.
    if (ROUTINE.has(item.category) || (item.category === 'risk' && !item.executionId && item.kind !== 'trade')) {
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

export function ResearchLine({ research }) {
  if (!research) return null
  const h = research.holdout
  return (
    <p className="tl-feed-text tl-muted">
      {research.direction ?? 'Research'} · {research.horizon ?? 'n/a'} horizon
      {research.score !== null && research.score !== undefined && <> · research score {Math.round(Number(research.score) * 100)}</>}
      {h && <> · holdout {ratioPct(h.precision)} vs {ratioPct(h.baselineRate)} baseline</>}
      {research.edgeOverBaseline === false && <> · <span className="tl-verdict tl-verdict--noedge">no proven edge</span></>}
      {research.edgeOverBaseline === true && <> · <span className="tl-verdict tl-verdict--edge">beat its baseline</span></>}
      {research.simulation?.mode === 'historical_replay' && <> · replay of {sessionDate(research.simulation.session)}</>}
    </p>
  )
}

/** Archived, digest-verified research for an order — loaded when shown. */
export function EvidenceBody({ executionId }) {
  const [state, setState] = useState({ status: 'loading' })
  useEffect(() => {
    let live = true
    getExecutionResearch(executionId)
      .then((data) => live && setState({ status: 'done', data }))
      .catch(() => live && setState({ status: 'error' }))
    return () => { live = false }
  }, [executionId])
  const d = state.data
  const ev = d?.evidence
  return (
    <div className="tl-evidence-body" data-testid={`research-evidence-${executionId}`}>
      {state.status === 'loading' && <span className="tl-muted">Loading research evidence…</span>}
      {state.status === 'error' && <span className="tl-neg">Couldn’t load the research evidence. Try again later.</span>}
      {state.status === 'done' && d?.status !== 'verified_digest' && (
        <span role="status">{d?.status === 'unavailable' ? 'No research decision is linked to this order.' : `Evidence check: ${d?.status ?? 'unknown'} — this order’s research can’t be verified.`}</span>
      )}
      {state.status === 'done' && d?.status === 'verified_digest' && (
        <dl>
          <dt>Evidence</dt><dd><strong className="tl-pos">Verified</strong> — matches its SHA-256 digest <span className="tl-muted">(integrity, not accuracy)</span></dd>
          <dt>Prediction</dt><dd>{ev?.ticker} {ev?.direction} · {ev?.horizon} · observed {sessionDate(ev?.observedAt, { year: true })}</dd>
          <dt>Entry price</dt><dd>{money(ev?.entryPrice)}</dd>
          <dt>Model</dt><dd>{ev?.strategyId ?? '—'}</dd>
          <dt>Publication</dt><dd>{ev?.ranking?.publicationId ?? '—'}{ev?.ranking?.mode === 'historical_replay' ? ' (historical replay)' : ''}</dd>
          <dt>Digest</dt><dd className="tl-muted">{d.researchTrace?.evidenceSha256}</dd>
        </dl>
      )}
    </div>
  )
}

export function ResearchEvidence({ executionId }) {
  return <Disclosure label="Research evidence"><EvidenceBody executionId={executionId} /></Disclosure>
}

/** The decision trail of one trade: every recorded step, oldest first. */
function Trail({ steps }) {
  return (
    <ol className="tl-trail-list">
      {steps.map((st) => (
        <li key={st.id}>
          <span className="tl-trail-when">{dateTime(st.at)}</span>
          <span className="tl-trail-what"><strong>{st.title}</strong>{st.explanation ? ` — ${st.explanation}` : ''}{st.note ? ` ${st.note}` : ''}</span>
          <ResearchLine research={st.research} />
        </li>
      ))}
    </ol>
  )
}

/** One disclosure per row: the trade's decision trail and evidence, or an error's raw detail. */
function RowDetails({ item }) {
  if (item.kind === 'trade') {
    const evidence = item.filled && item.researchBot !== false && item.executionId
    return (
      <Disclosure label="Details" meta={`${item.steps.length} ${item.steps.length === 1 ? 'step' : 'steps'}${evidence ? ' · research evidence' : ''}`}>
        <Trail steps={item.steps} />
        {evidence && <EvidenceBody executionId={item.executionId} />}
      </Disclosure>
    )
  }
  if ((item.category === 'error' || item.category === 'risk') && item.diagnostics?.detail) {
    return <Disclosure label="Details"><p className="tl-feed-text tl-muted m0">{item.diagnostics.detail}</p></Disclosure>
  }
  return null
}

export function FeedRow({ item, showBot = true }) {
  const routine = ROUTINE.has(item.category)
  return (
    <li className={`tl-feed-item ${routine ? 'tl-feed-item--routine' : ''}`} title={routine ? item.explanation : undefined} data-kind={item.kind ?? item.category}>
      <FeedIcon item={item} />
      <div>
        <div className="tl-feed-title">
          {item.title}
          {item.symbol && !item.title.includes(item.symbol) && <> · {item.symbol}</>}
          {item.count > 1 && <span className="tl-feed-repeat" title={`Since ${dateTime(item.since)}`}>×{item.count}</span>}
          {item.testScenario && <span className="tl-tag tl-tag--warn tl-feed-tag">Test scenario</span>}
          {showBot && item.botName && <> <span className="tl-feed-bot">· <Link to={`/bots/${item.botId}`}>{item.botName}</Link></span></>}
        </div>
        {item.explanation && !routine && <p className="tl-feed-text">{item.explanation}</p>}
        {item.kind !== 'trade' && <ResearchLine research={item.research} />}
        <RowDetails item={item} />
      </div>
      <time className="tl-feed-time" dateTime={item.at ?? undefined} title={dateTime(item.at)}>{ago(item.at)}</time>
    </li>
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
  footer = null,
}) {
  const [lens, setLens] = useState(initialLens)
  const [shown, setShown] = useState(limit)
  const [showRoutine, setShowRoutine] = useState(false)
  const all = useMemo(() => collapseRoutine(groupTrades(items).filter((i) => inLens(i, lens))), [items, lens])
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
          {visible.slice(0, shown).map((item) => <FeedRow key={`${item.botId ?? ''}:${item.id}`} item={item} showBot={showBot} />)}
        </ol>
      )}
      {folding && (
        <p className="tl-small tl-muted" style={{ margin: '12px 0 0' }} data-testid="routine-summary">
          {visible.length === 0 ? 'No orders or decisions yet. ' : ''}
          {routineCount} routine {routineCount === 1 ? 'check' : 'checks'} without a trade ({routineKinds.slice(0, 3).join('; ')}).{' '}
          <button type="button" className="tl-link-btn tl-small" onClick={() => setShowRoutine(true)}>Show them</button>
        </p>
      )}
      {(visible.length > shown || footer) && (
        <div className="tl-feed-more" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {visible.length > shown && (
            <button type="button" className="tl-btn tl-btn--sm" onClick={() => setShown((n) => n + 12)}>Show more ({visible.length - shown})</button>
          )}
          {footer}
        </div>
      )}
    </div>
  )
}
