const EMPTY_STYLE = {
  background: 'white', borderRadius: '8px', padding: '1.5rem',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'center', color: '#666',
}
const CARD_STYLE = {
  background: 'white', borderRadius: '8px', padding: '1rem',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'auto',
}
const ROW = { display: 'flex', justifyContent: 'space-between' }

export default function TickerStatsPanel({ selectedStock, bootstrapData, loading }) {
  if (!selectedStock) {
    return (
      <article style={EMPTY_STYLE}>
        <div style={{ fontSize: '14px' }}>Select a stock to view statistics</div>
      </article>
    )
  }

  const stats = bootstrapData?.stats
  const quote = bootstrapData?.quote

  return (
    <article style={CARD_STYLE}>
      <h3 style={{ margin: '0 0 1rem', fontSize: '14px', fontWeight: 600 }}>Key Statistics</h3>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>Loading statistics...</div>
      ) : (
        <div style={{ fontSize: '11px', lineHeight: '1.5' }}>
          {/* Price Performance */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '0.5rem', fontWeight: 600 }}>Price Performance</div>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {quote?.price && (
                <div style={ROW}>
                  <span className="muted">Current Price:</span>
                  <span style={{ fontWeight: 600 }}>${quote.price.toFixed(2)}</span>
                </div>
              )}
              {quote?.dayChangePct != null && (
                <div style={ROW}>
                  <span className="muted">Day Change:</span>
                  <span style={{ color: quote.dayChangePct >= 0 ? '#0a7a47' : '#c0392b', fontWeight: 600 }}>
                    {quote.dayChangePct >= 0 ? '+' : ''}{(quote.dayChangePct * 100).toFixed(2)}%
                  </span>
                </div>
              )}
              {stats?.high52 && stats?.low52 && (
                <div style={ROW}>
                  <span className="muted">52W Range:</span>
                  <span>${stats.low52.toFixed(2)} – ${stats.high52.toFixed(2)}</span>
                </div>
              )}
              {stats?.ath && quote?.price && (
                <div style={ROW}>
                  <span className="muted">From ATH:</span>
                  <span style={{ color: '#666' }}>{((quote.price / stats.ath - 1) * 100).toFixed(1)}%</span>
                </div>
              )}
            </div>
          </div>

          {/* Volume */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '0.5rem', fontWeight: 600 }}>Volume & Liquidity</div>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {quote?.volume    && <div style={ROW}><span className="muted">Volume:</span>     <span>{(quote.volume / 1e6).toFixed(2)}M</span></div>}
              {stats?.avgVolume && <div style={ROW}><span className="muted">Avg Volume:</span> <span>{(stats.avgVolume / 1e6).toFixed(2)}M</span></div>}
              {selectedStock?.pe && <div style={ROW}><span className="muted">P/E Ratio:</span> <span>{selectedStock.pe}</span></div>}
            </div>
          </div>

          {/* Market Metrics */}
          {stats && (
            <div>
              <div style={{ fontSize: '10px', color: '#666', marginBottom: '0.5rem', fontWeight: 600 }}>Market Metrics</div>
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {stats.marketCap  && <div style={ROW}><span className="muted">Market Cap:</span>    <span>${(stats.marketCap / 1e9).toFixed(2)}B</span></div>}
                {stats.ath        && <div style={ROW}><span className="muted">All-Time High:</span> <span>${stats.ath.toFixed(2)}</span></div>}
                {stats.ipoDate    && <div style={ROW}><span className="muted">IPO Date:</span>      <span>{new Date(stats.ipoDate).toLocaleDateString()}</span></div>}
                {stats.yearsListed && <div style={ROW}><span className="muted">Years Listed:</span> <span>{stats.yearsListed}</span></div>}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  )
}
