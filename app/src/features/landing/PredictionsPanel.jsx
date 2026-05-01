import { useNavigate } from 'react-router-dom'
import { fmtAsOf } from '../assets/utils.js'
import { fmtHorizon } from '../../utils/predictions.js'
import { CARD_STYLE, SENTIMENT_COLORS } from './constants.js'

export default function PredictionsPanel({ cards, loading, error }) {
  const navigate = useNavigate()

  return (
    <article style={CARD_STYLE}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <strong>Predictions</strong>
        <span style={{ fontSize: 12, color: '#7a7a7a' }}>
          {loading ? 'Loading...' : cards.length ? `${cards.length} shown` : '—'}
        </span>
      </div>

      {error && !loading && cards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '1.25rem', color: '#666' }}>{error}</div>
      ) : (
        <div style={{ marginTop: '0.9rem', maxHeight: 340, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.7rem' }}>
            {loading && cards.length === 0 && [0, 1, 2].map((i) => (
              <div key={i} style={{ border: '1px solid #eee', borderRadius: 16, padding: '1rem', background: 'linear-gradient(180deg, #fafafa, #ffffff)' }}>
                <div style={{ height: 12, width: '55%', background: '#f1f3f5', borderRadius: 8 }} />
                <div style={{ height: 18, width: '90%', background: '#f1f3f5', borderRadius: 8, marginTop: 10 }} />
                <div style={{ height: 10, width: '70%', background: '#f1f3f5', borderRadius: 8, marginTop: 12 }} />
              </div>
            ))}

            {cards.map((card) => {
              const tone    = SENTIMENT_COLORS[card.direction] ?? SENTIMENT_COLORS.neutral
              const confPct = card.confidence == null ? null : Math.round(card.confidence * 100)
              const asOf    = fmtAsOf(card.timestamp)
              const mode    = card.mode ? String(card.mode).toUpperCase() : null
              const horizon = fmtHorizon(card.horizon)
              return (
                <div key={card.id} style={{ border: '1px solid #eee', borderRadius: 16, padding: '1rem', background: 'linear-gradient(180deg, #ffffff, #fbfbfd)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: tone }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 16 }}>{card.ticker}</strong>
                      <span style={{ backgroundColor: tone, color: 'white', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                        {card.direction === 'bullish' ? 'BULLISH' : card.direction === 'bearish' ? 'BEARISH' : 'NEUTRAL'}
                      </span>
                      {confPct != null && <span style={{ fontSize: 11, fontWeight: 700, color: tone }}>{confPct}% conf</span>}
                    </div>
                    <button className="ghost pressable" onClick={() => navigate(`/orders?ticker=${encodeURIComponent(card.ticker)}`)} style={{ padding: '0.4rem 0.7rem', fontSize: 12 }}>
                      Open
                    </button>
                  </div>
                  <div style={{ marginTop: '0.55rem', lineHeight: 1.25 }}>
                    <strong style={{ fontSize: 14 }}>{card.headline}</strong>
                    {asOf && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>As of {asOf}</div>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.7rem' }}>
                    {card.rankScore != null && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>Rank {card.rankScore >= 0 ? '+' : ''}{card.rankScore.toFixed(2)}</span>}
                    {mode    && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>Mode {mode}</span>}
                    {horizon && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>Horizon {horizon}</span>}
                    {card.strategyId && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f1f3f5', color: '#333' }}>Strategy {String(card.strategyId).slice(0, 10)}</span>}
                  </div>
                  {card.backingLines.length > 0 && (
                    <div style={{ marginTop: '0.75rem', fontSize: 12, color: '#444', lineHeight: 1.35 }}>
                      {card.backingLines.slice(0, 2).map((line) => (
                        <div key={line} style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <span style={{ color: tone, fontWeight: 900 }}>•</span>
                          <span style={{ flex: 1 }}>{line}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </article>
  )
}
