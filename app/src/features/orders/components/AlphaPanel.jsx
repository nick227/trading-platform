import { getSignalColor } from '../../../utils/signal.js'

export default function AlphaPanel({ alpha, loading, selectedStock, compact = false }) {
  const shellClass = `card ${compact ? 'card-pad-sm' : 'card-pad-md'}`

  if (!selectedStock) {
    return (
      <article className={shellClass}>
        <div className="panel-empty">Select a stock to view AI analysis</div>
      </article>
    )
  }

  const sigColor = getSignalColor(alpha?.signal)

  return (
    <article className={shellClass}>
      <div className="panel-header">
        <h3 className="panel-title">Alpha Engine Analysis</h3>
      </div>

      {loading ? (
        <div className="panel-empty">Loading analysis…</div>
      ) : alpha ? (
        <div className="stack-sm">
          <div className="l-row">
            <div className="hstack">
              <span className="badge badge-xs" style={{ background: sigColor, color: 'white' }}>
                {alpha.signal.replace(/_/g, ' ')}
              </span>
              <span className="text-xs font-600">{alpha.confidence}% confidence</span>
            </div>
            <span className="text-xs muted">
              {[alpha.risk, alpha.timeframe].filter(Boolean).join(' · ')}
            </span>
          </div>

          <div className="progress mb-3">
            <div className="progress-bar" style={{ '--progress': `${alpha.confidence}%`, '--progress-bg': sigColor }} />
          </div>

          {alpha.thesis?.length > 0 ? (
            <ul className="list text-xs mb-3">
              {alpha.thesis.map((point, i) => <li key={i}>{point}</li>)}
            </ul>
          ) : alpha.reasoning ? (
            <div className="text-xs mb-3">{alpha.reasoning}</div>
          ) : null}

          {!compact && (
            <>
              {alpha.entryZone && (
                <div className="subcard subcard-sm mb-2">
                  <div className="l-row text-xs">
                    <span className="muted">Entry zone</span>
                    <span className="font-600">
                      ${alpha.entryZone[0].toFixed(2)} – ${alpha.entryZone[1].toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {alpha.avoidIf?.length > 0 && (
                <div className="text-xs muted">
                  <span className="text-negative font-600">Avoid if: </span>
                  {alpha.avoidIf.join(' · ')}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="panel-empty">Analysis unavailable</div>
      )}
    </article>
  )
}

