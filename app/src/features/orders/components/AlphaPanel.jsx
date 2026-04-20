import { getSignalColor } from '../../../utils/signal.js'

export default function AlphaPanel({ alpha, loading, selectedStock, compact = false }) {
  if (!selectedStock) {
    return (
      <article style={{
        background: 'white', borderRadius: '8px',
        padding: compact ? '1rem' : '1.5rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        textAlign: 'center', color: '#666',
      }}>
        <div style={{ fontSize: '14px' }}>Select a stock to view AI analysis</div>
      </article>
    )
  }

  const sigColor = getSignalColor(alpha?.signal)

  return (
    <article style={{
      background: 'white', borderRadius: '8px',
      padding: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      <h3 style={{ margin: `0 0 ${compact ? '0.75rem' : '1rem'}`, fontSize: '14px', fontWeight: 600 }}>
        Alpha Engine Analysis
      </h3>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#666', fontSize: '12px' }}>
          Loading analysis...
        </div>
      ) : alpha ? (
        <div>
          {/* Signal + confidence header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                padding: '0.2rem 0.6rem', borderRadius: '4px',
                fontSize: '11px', fontWeight: 700,
                background: sigColor, color: 'white',
              }}>
                {alpha.signal.replace(/_/g, ' ')}
              </div>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#444' }}>
                {alpha.confidence}% confidence
              </span>
            </div>
            <span style={{ fontSize: '11px', color: '#888' }}>
              {alpha.risk ?? ''}{alpha.risk && alpha.timeframe ? ' · ' : ''}{alpha.timeframe ?? ''}
            </span>
          </div>

          {/* Confidence bar */}
          <div style={{ height: '5px', background: '#e9ecef', borderRadius: '4px', overflow: 'hidden', marginBottom: '0.75rem' }}>
            <div style={{
              height: '100%', width: `${alpha.confidence}%`,
              background: sigColor, borderRadius: '4px',
              transition: 'width 0.3s ease',
            }} />
          </div>

          {/* Thesis bullets — real engine data */}
          {alpha.thesis?.length > 0 ? (
            <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.1rem', fontSize: '11px', color: '#555', lineHeight: '1.6' }}>
              {alpha.thesis.map((point, i) => <li key={i}>{point}</li>)}
            </ul>
          ) : alpha.reasoning ? (
            <div style={{ fontSize: '11px', color: '#555', lineHeight: '1.5', marginBottom: '0.75rem' }}>
              {alpha.reasoning}
            </div>
          ) : null}

          {/* Entry zone + avoid-if — full only */}
          {!compact && (
            <>
              {alpha.entryZone && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: '11px', color: '#555',
                  padding: '0.5rem 0.75rem', background: '#f8f9fa',
                  borderRadius: '4px', marginBottom: '0.5rem',
                }}>
                  <span className="muted">Entry zone</span>
                  <span style={{ fontWeight: 600 }}>
                    ${alpha.entryZone[0].toFixed(2)} – ${alpha.entryZone[1].toFixed(2)}
                  </span>
                </div>
              )}
              {alpha.avoidIf?.length > 0 && (
                <div style={{ fontSize: '10px', color: '#888', lineHeight: '1.5' }}>
                  <span style={{ fontWeight: 600, color: '#c0392b' }}>Avoid if: </span>
                  {alpha.avoidIf.join(' · ')}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#999', fontSize: '12px' }}>
          Analysis unavailable
        </div>
      )}
    </article>
  )
}
