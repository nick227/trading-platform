import { useEffect, useState } from 'react'
import { get } from '../api/client'
import { ratioPct, sessionDate } from './format'

const cache = new Map() // symbol -> promise (one fetch per symbol per page load)

export function loadSymbolResearch(symbol) {
  const key = String(symbol).toUpperCase()
  if (!cache.has(key)) cache.set(key, get(`/engine/research/${encodeURIComponent(key)}`).catch(() => ({ symbol: key, status: 'unavailable' })))
  return cache.get(key)
}

/**
 * Alpha Engine's latest verified research for one symbol, presented as an input the user
 * can choose to use — never as a recommendation. Holdout vs the always-up baseline is shown
 * as a direct comparison so "no proven edge" is unmissable.
 */
export default function ResearchCard({ symbol, compact = false }) {
  const [r, setR] = useState(null)
  useEffect(() => {
    let live = true
    setR(null)
    loadSymbolResearch(symbol).then((d) => live && setR(d))
    return () => { live = false }
  }, [symbol])

  if (!r) return <span className="tl-skel" style={{ height: compact ? 20 : 64 }} aria-label={`Loading research for ${symbol}`} />
  if (r.status === 'unavailable') return <p className="tl-small tl-muted m0" data-testid={`research-${symbol}`}>{compact ? 'Unavailable' : `Research for ${symbol} is unavailable right now.`}</p>
  if (r.status === 'none') return <p className="tl-small tl-muted m0" data-testid={`research-${symbol}`}>{compact ? 'No research' : `Alpha Engine has no current research for ${symbol}.`}</p>

  const hit = r.holdout?.hitRate
  const base = r.holdout?.baselineRate
  const gap = hit !== null && hit !== undefined && base !== null && base !== undefined ? (hit - base) * 100 : null
  const verdict = r.edgeOverBaseline === true
    ? <span className="tl-verdict tl-verdict--edge">Beat its baseline</span>
    : r.edgeOverBaseline === false
      ? <span className="tl-verdict tl-verdict--noedge">No proven edge</span>
      : <span className="tl-muted">Edge not evaluated</span>

  if (compact) {
    return (
      <span className="tl-small" data-testid={`research-${symbol}`}>
        {r.direction ?? 'Signal'}{r.score !== null && r.score !== undefined ? ` · score ${Math.round(r.score * 100)}` : ''} · {verdict}
      </span>
    )
  }
  return (
    <div className="tl-research" data-testid={`research-${symbol}`}>
      <div className="tl-research-head">
        <strong>{r.direction ?? 'Signal'}{r.horizon ? ` · ${r.horizon} horizon` : ''}</strong>
        {r.score !== null && r.score !== undefined && <span className="tl-muted"> · research score {Math.round(r.score * 100)}</span>}
        <span className="tl-research-verdict">{verdict}</span>
      </div>
      {gap !== null && (
        <p className="tl-small m0">
          Holdout hit rate {ratioPct(hit)} vs {ratioPct(base)} always-up baseline <span className={gap >= 0 ? 'tl-pos' : 'tl-neg'}>({gap >= 0 ? '+' : '−'}{Math.abs(gap).toFixed(1)} pts)</span>
        </p>
      )}
      <p className="tl-small tl-muted m0">
        {r.model ? `${r.model} · ` : ''}published for {sessionDate(r.marketDate, { year: true })}{r.mode === 'historical_replay' ? ' (historical replay)' : ''}
        {r.genuineOutOfSample === false ? ' · pseudo-out-of-sample' : ''}. Research is an input you can test, not a recommendation.
      </p>
    </div>
  )
}
