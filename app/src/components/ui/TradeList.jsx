export function TradeList({ trades }) {
  return (
    <div className="trade-list">
      {trades.map((trade) => (
        <article className="trade-row" key={trade.id}>
          <div>
            <div className="asset-symbol">{trade.side} {trade.symbol}</div>
            <div className="muted">{trade.time}</div>
          </div>
          <strong>{trade.amount}</strong>
        </article>
      ))}
    </div>
  )
}
