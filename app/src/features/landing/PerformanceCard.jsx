import { CARD_STYLE, SENTIMENT_COLORS } from './constants.js'

export default function PerformanceCard({ stats, loading }) {
  return (
    <article style={CARD_STYLE}>
      <strong>Performance Today</strong>
      <div style={{ marginTop: '0.8rem' }}>
        <div className="muted">Daily P&L</div>
        <div style={{ fontSize: '1.8rem', fontWeight: 700, color: stats?.totalReturn > 0 ? SENTIMENT_COLORS.bullish : SENTIMENT_COLORS.bearish }}>
          ${loading ? '...' : stats ? stats.totalReturn.toFixed(2) : '0.00'}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
          <div>
            <div className="muted">Win Rate</div>
            <div style={{ fontWeight: 600 }}>
              {loading ? '...' : stats ? (stats.winRate / 100).toFixed(3) : '0.000'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted">Total Trades</div>
            <div style={{ fontWeight: 600 }}>
              {loading ? '...' : stats ? stats.totalTrades : '0'}
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
