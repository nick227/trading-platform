import { useMemo } from 'react'
import { getSignalColor } from '../../../utils/signal.js'

function normalizeConfidence(value) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  if (num <= 1) return Math.round(num * 100)
  if (num <= 100) return Math.round(num)
  return null
}

function formatAsOf(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString()
}

export default function RecommendationPanel({ bootstrapData, selectedStock, loading = false }) {
  const rec = useMemo(() => {
    const base = bootstrapData?.recommendation ?? null
    const unwrapped = base?.recommendation ?? base
    return unwrapped && typeof unwrapped === 'object' ? unwrapped : null
  }, [bootstrapData])

  if (!selectedStock) {
    return (
      <article className="card card-pad-sm">
        <div className="panel-header">
          <h3 className="panel-title">Recommendation</h3>
        </div>
        <div className="panel-empty">Select a stock to view recommendation</div>
      </article>
    )
  }

  const confidence = normalizeConfidence(rec?.confidence)
  const action = String(rec?.action ?? '').toUpperCase()
  const sigColor = getSignalColor(action ? action : null)

  const entryZone = Array.isArray(rec?.entryZone)
    ? `$${Number(rec.entryZone[0]).toFixed(2)} – $${Number(rec.entryZone[1]).toFixed(2)}`
    : (rec?.entryZone ?? null)

  const thesis = Array.isArray(rec?.thesis)
    ? rec.thesis
    : typeof rec?.thesis === 'string'
      ? [rec.thesis]
      : []

  const avoidIf = Array.isArray(rec?.avoidIf)
    ? rec.avoidIf
    : typeof rec?.avoidIf === 'string'
      ? [rec.avoidIf]
      : []

  const asOf = formatAsOf(rec?.asOf ?? rec?.as_of)

  return (
    <article className="card card-pad-sm">
      <div className="panel-header">
        <h3 className="panel-title">Recommendation</h3>
        {asOf ? <span className="text-xs muted">As of {asOf}</span> : null}
      </div>

      {loading ? (
        <div className="panel-empty">Loading recommendation…</div>
      ) : rec ? (
        <div className="stack-sm">
          <div className="l-row">
            <div className="hstack">
              <span className="badge badge-xs" style={{ background: sigColor, color: 'white' }}>
                {action || '—'}
              </span>
              <span className="text-xs font-600">{confidence != null ? `${confidence}%` : '—'} confidence</span>
            </div>
            <span className="text-xs muted">
              {[rec?.risk, rec?.horizon].filter(Boolean).join(' · ') || '—'}
            </span>
          </div>

          {entryZone ? (
            <div className="subcard subcard-sm">
              <div className="l-row text-xs">
                <span className="muted">Entry zone</span>
                <span className="font-600">{entryZone}</span>
              </div>
            </div>
          ) : null}

          {thesis.length > 0 ? (
            <div>
              <div className="eyebrow mb-0">Thesis</div>
              <ul className="list mt-2 text-xs">
                {thesis.slice(0, 8).map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          ) : null}

          {avoidIf.length > 0 ? (
            <div className="text-xs muted">
              <span className="text-negative font-600">Avoid if: </span>
              {avoidIf.slice(0, 6).join(' · ')}
            </div>
          ) : null}

          {rec?.source && (
            <div className="text-xs muted">Source: {String(rec.source)}</div>
          )}
        </div>
      ) : (
        <div className="panel-empty">Recommendation unavailable</div>
      )}
    </article>
  )
}

