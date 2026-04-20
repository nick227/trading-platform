export default function OwnershipPanel({ selectedStock, bootstrapData, loading }) {
  const ownership = bootstrapData?.userOwnership
  if (!ownership) return null

  return (
    <article style={{
      background: ownership.currentShares > 0 ? '#f0f9f4' : '#f8f9fa',
      borderRadius: '8px', padding: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '14px', fontWeight: 600 }}>Your Position</h3>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '1rem', color: '#666', fontSize: '12px' }}>
          Loading position...
        </div>
      ) : ownership.currentShares > 0 ? (
        <div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: '0.5rem', fontSize: '12px', marginBottom: '0.75rem',
          }}>
            <div>
              <div className="muted" style={{ fontSize: '10px', marginBottom: '0.25rem' }}>Shares</div>
              <div style={{ fontWeight: 700, color: '#0a7a47' }}>{ownership.currentShares}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: '10px', marginBottom: '0.25rem' }}>Avg Cost</div>
              <div style={{ fontWeight: 600 }}>${ownership.avgCost?.toFixed(2)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: '10px', marginBottom: '0.25rem' }}>Realized PnL</div>
              <div style={{ fontWeight: 600, color: (ownership.realizedPnL ?? 0) >= 0 ? '#0a7a47' : '#c0392b' }}>
                ${ownership.realizedPnL?.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: '10px', marginBottom: '0.25rem' }}>Total Trades</div>
              <div style={{ fontWeight: 600 }}>{ownership.lifetimeTradeCount}</div>
            </div>
          </div>

          {ownership.lastTrade && (
            <div style={{ fontSize: '11px', color: '#666', padding: '0.5rem', background: 'rgba(0,0,0,0.02)', borderRadius: '4px' }}>
              <div className="muted" style={{ fontSize: '10px', marginBottom: '0.25rem' }}>Last Trade</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  {ownership.lastTrade.direction.toUpperCase()} {ownership.lastTrade.quantity} @ ${ownership.lastTrade.price}
                </span>
                <span>{new Date(ownership.lastTrade.timestamp).toLocaleDateString()}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: '12px', color: '#666', textAlign: 'center', padding: '1rem' }}>
          You haven't traded {selectedStock?.symbol} yet
        </div>
      )}
    </article>
  )
}
