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
    <article className="card card-pad-sm">
      <h3 className="m-0 mb-3 text-sm font-600">
        Recent Trades — {selectedStock.symbol}
      </h3>

      {!executions || executions.length === 0 ? (
        <div className="centered p-4 text-sm text-muted">No recent trades for {selectedStock.symbol}</div>
      ) : (
        <div className="data-rows">
          {executions.slice(0, 5).map((ex, i) => {
            const side  = (ex.side ?? ex.direction ?? '').toUpperCase()
            const price = ex.price ?? ex.fillPrice ?? 0
            const qty   = ex.quantity ?? ex.qty ?? 0
            const date  = ex.createdAt ?? ex.timestamp ?? ex.date
            const sideBadgeClass =
              side === 'BUY'
                ? 'badge badge-xs badge-positive'
                : side === 'SELL'
                  ? 'badge badge-xs badge-negative'
                  : 'badge badge-xs badge-neutral'
            return (
              <div key={ex.id ?? i} className="subcard subcard-sm l-row text-xs">
                <div className="hstack">
                  <span className={sideBadgeClass}>{side || '—'}</span>
                  <span className="font-600">{qty} shares @ ${price.toFixed(2)}</span>
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
