// Displays recent executions for the selected ticker from bootstrap data.
// bootstrapData may supply recentExecutions, recentTrades, or executions — handle all shapes.

function getExecutions(bootstrapData) {
  return bootstrapData?.recentExecutions
    ?? bootstrapData?.recentTrades
    ?? bootstrapData?.executions
    ?? null
}

export default function RecentExecutions({ selectedStock, bootstrapData }) {
  const executions = getExecutions(bootstrapData)

  if (!selectedStock) return null

  return (
    <article style={{
      background: 'white', borderRadius: '8px', padding: '1rem',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '14px', fontWeight: 600 }}>
        Recent Trades — {selectedStock.symbol}
      </h3>

      {!executions || executions.length === 0 ? (
        <div style={{ fontSize: '12px', color: '#666', textAlign: 'center', padding: '1rem' }}>
          No recent trades for {selectedStock.symbol}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {executions.slice(0, 5).map((ex, i) => {
            const side  = (ex.side ?? ex.direction ?? '').toUpperCase()
            const price = ex.price ?? ex.fillPrice ?? 0
            const qty   = ex.quantity ?? ex.qty ?? 0
            const date  = ex.createdAt ?? ex.timestamp ?? ex.date
            return (
              <div key={ex.id ?? i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.5rem', background: '#f8f9fa', borderRadius: '4px', fontSize: '11px',
              }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <div style={{
                    padding: '0.1rem 0.4rem', borderRadius: '3px', fontWeight: 700, fontSize: '10px',
                    background: side === 'BUY' ? '#e8f5e8' : '#ffeaea',
                    color:      side === 'BUY' ? '#0a7a47' : '#c0392b',
                  }}>
                    {side || '—'}
                  </div>
                  <span style={{ fontWeight: 600 }}>{qty} shares @ ${price.toFixed(2)}</span>
                </div>
                <span className="muted">
                  {date ? new Date(date).toLocaleDateString() : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}
