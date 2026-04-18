import { useApp } from '../../app/AppProvider'

export default function ActivityTab() {
  const { state } = useApp()

  return (
    <div className="list">
      {state.trades.map((trade) => (
        <div key={trade.id} className="row">
          <span>{trade.side} {trade.symbol}</span>
          <span className="muted">{trade.time}</span>
          <strong>{trade.amount}</strong>
        </div>
      ))}
    </div>
  )
}
