import { useState } from 'react'
import { CARD_STYLE, SENTIMENT_COLORS } from './constants.js'

export default function LiveSignalsCard({ signals, loading, error }) {
  const [selected, setSelected] = useState(null)

  return (
    <article style={CARD_STYLE}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Live Signals</strong>
        <span style={{ fontSize: 12, color: '#7a7a7a' }}>
          {loading ? 'Loading...' : `${signals.length} active`}
        </span>
      </div>
      <div style={{ marginTop: '0.8rem', maxHeight: 320, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>Loading signals from Alpha Engine...</div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>{error}</div>
        ) : signals.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>No active signals available</div>
        ) : signals.map((signal, index) => (
          <div
            key={`signal-${signal.symbol}-${index}`}
            style={{
              borderBottom: '1px solid #eee',
              cursor: 'pointer',
              backgroundColor: selected?.symbol === signal.symbol ? '#f8f9fa' : 'transparent',
              padding: '0.5rem',
              borderRadius: 8,
              marginBottom: '0.3rem',
            }}
            onClick={() => setSelected(signal)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{signal.symbol}</div>
                <div className="muted" style={{ fontSize: 12 }}>{signal.strategy}</div>
              </div>
              <div style={{
                backgroundColor: signal.confidence > 0.8 ? SENTIMENT_COLORS.bullish : signal.confidence > 0.7 ? SENTIMENT_COLORS.warning : SENTIMENT_COLORS.danger,
                color: 'white', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
              }}>
                {(signal.confidence * 100).toFixed(0)}%
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', fontSize: 12 }}>
              <div><span className="muted">Entry:</span> {signal.entry}</div>
              <div><span className="muted">Stop:</span> {signal.stop}</div>
              <div><span className="muted">Target:</span> {signal.target}</div>
              <div><span className="muted">Type:</span> {signal.type}</div>
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}
