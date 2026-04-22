export default function OwnershipPanel({ selectedStock, bootstrapData, loading }) {
  const ownership = bootstrapData?.userOwnership
  if (!ownership) return null

  const cardClassName =
    ownership.currentShares > 0
      ? 'card card-pad-sm card-tint-positive'
      : 'card card-pad-sm card-tint-neutral'

  return (
    <article className={cardClassName}>
      <h3 className="m-0 mb-3 text-sm font-600">Your Position</h3>

      {loading ? (
        <div className="centered p-4 text-sm text-muted">Loading position...</div>
      ) : ownership.currentShares > 0 ? (
        <div>
          <div className="mini-kpis mb-3">
            <div>
              <div className="meta-label">Shares</div>
              <div className="font-700 text-positive">{ownership.currentShares}</div>
            </div>
            <div>
              <div className="meta-label">Avg Cost</div>
              <div className="font-600">${ownership.avgCost?.toFixed(2)}</div>
            </div>
            <div>
              <div className="meta-label">Realized PnL</div>
              <div className={`font-600 ${(ownership.realizedPnL ?? 0) >= 0 ? 'text-positive' : 'text-negative'}`}>
                ${ownership.realizedPnL?.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="meta-label">Total Trades</div>
              <div className="font-600">{ownership.lifetimeTradeCount}</div>
            </div>
          </div>

          {ownership.lastTrade && (
            <div className="subcard subcard-sm text-xs text-muted">
              <div className="meta-label mb-1">Last Trade</div>
              <div className="row text-xs">
                <span>
                  {ownership.lastTrade.direction.toUpperCase()} {ownership.lastTrade.quantity} @ ${ownership.lastTrade.price}
                </span>
                <span>{new Date(ownership.lastTrade.timestamp).toLocaleDateString()}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="centered p-4 text-sm text-muted">You haven't traded {selectedStock?.symbol} yet</div>
      )}
    </article>
  )
}
