import { useNavigate, useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useApp } from '../app/AppProvider'

export default function BotHistory() {
  const navigate = useNavigate()
  const { botId } = useParams()
  const { state } = useApp()
  const [bot, setBot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState([])
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    const foundBot = state.bots.find((b) => b.id === botId)
    setBot(foundBot)

    const mockHistory = [
      {
        id: '1',
        timestamp: '2024-01-15T10:30:00Z',
        type: 'BUY',
        asset: 'AAPL',
        price: 185.42,
        quantity: 50,
        status: 'completed',
        pnl: null,
        confidence: 0.82,
      },
      {
        id: '2',
        timestamp: '2024-01-15T14:22:00Z',
        type: 'SELL',
        asset: 'AAPL',
        price: 187.15,
        quantity: 50,
        status: 'completed',
        pnl: 86.5,
        confidence: 0.78,
      },
      {
        id: '3',
        timestamp: '2024-01-16T09:45:00Z',
        type: 'BUY',
        asset: 'AAPL',
        price: 186.8,
        quantity: 75,
        status: 'completed',
        pnl: null,
        confidence: 0.91,
      },
      {
        id: '4',
        timestamp: '2024-01-16T11:30:00Z',
        type: 'SELL',
        asset: 'AAPL',
        price: 184.92,
        quantity: 75,
        status: 'completed',
        pnl: -141.0,
        confidence: 0.73,
      },
      {
        id: '5',
        timestamp: '2024-01-17T13:15:00Z',
        type: 'BUY',
        asset: 'AAPL',
        price: 188.25,
        quantity: 60,
        status: 'pending',
        pnl: null,
        confidence: 0.85,
      },
    ]

    setHistory(mockHistory)
    setLoading(false)
  }, [botId, state.bots])

  if (loading) {
    return (
      <div className="l-page">
        <div className="container">
          <div className="panel-empty">Loading bot history…</div>
        </div>
      </div>
    )
  }

  if (!bot) {
    return (
      <div className="l-page">
        <div className="container">
          <div className="panel-empty">
            <h2 className="m-0 mb-2">Bot Not Found</h2>
            <p className="muted m-0 mb-3">The requested bot could not be found.</p>
            <button className="btn btn-sm btn-primary" type="button" onClick={() => navigate('/bots')}>
              Back to Bots
            </button>
          </div>
        </div>
      </div>
    )
  }

  const filteredHistory = filter === 'all' ? history : history.filter((item) => item.type === filter)

  const realizedTrades = history.filter((item) => item.pnl !== null)
  const totalPnL = realizedTrades.reduce((sum, item) => sum + item.pnl, 0)
  const winRate =
    realizedTrades.length === 0 ? 0 : (realizedTrades.filter((item) => item.pnl > 0).length / realizedTrades.length) * 100

  const formatDate = (timestamp) =>
    new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  const pnlTone = totalPnL >= 0 ? 'text-positive' : 'text-negative'

  return (
    <div className="l-page">
      <div className="container l-stack-lg">
        <header className="stack-sm">
          <button className="btn btn-xs btn-ghost" type="button" onClick={() => navigate(`/bots/${botId}`)}>
            ← Back to Bot Details
          </button>

          <div className="stack-sm">
            <h1 className="hero m-0">{bot.name} — Execution History</h1>
            <p className="muted text-md m-0">Complete trading history and performance metrics.</p>
          </div>
        </header>

        <section>
          <div className="l-grid-auto-200">
            <article className="card card-pad-sm text-center">
              <div className={`text-xl font-700 ${pnlTone}`}>{totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}</div>
              <div className="kpi-label">Total P&amp;L</div>
            </article>
            <article className="card card-pad-sm text-center">
              <div className="text-xl font-700">{winRate.toFixed(0)}%</div>
              <div className="kpi-label">Win Rate</div>
            </article>
            <article className="card card-pad-sm text-center">
              <div className="text-xl font-700">{history.length}</div>
              <div className="kpi-label">Trades</div>
            </article>
          </div>
        </section>

        <section className="card card-pad-md">
          <div className="panel-header">
            <h2 className="panel-title">Trades</h2>
            <div className="wrap">
              {['all', 'BUY', 'SELL'].map((key) => (
                <button
                  key={key}
                  type="button"
                  className={filter === key ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
                  onClick={() => setFilter(key)}
                >
                  {key === 'all' ? 'All' : key}
                </button>
              ))}
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="panel-empty">No trades found.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Asset</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">P&amp;L</th>
                    <th className="text-center">Status</th>
                    <th className="text-center">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((trade) => {
                    const typeBadge = trade.type === 'BUY' ? 'badge badge-positive badge-xs' : 'badge badge-negative badge-xs'
                    const statusBadge =
                      trade.status === 'completed' ? 'badge badge-positive badge-xs' : 'badge badge-warning badge-xs'
                    const confidenceTone =
                      trade.confidence >= 0.8 ? 'dot-positive' : trade.confidence >= 0.6 ? 'dot-muted' : 'dot-negative'

                    return (
                      <tr key={trade.id}>
                        <td>{formatDate(trade.timestamp)}</td>
                        <td>
                          <span className={typeBadge}>{trade.type}</span>
                        </td>
                        <td className="font-600">{trade.asset}</td>
                        <td className="text-right">${trade.price.toFixed(2)}</td>
                        <td className="text-right">{trade.quantity}</td>
                        <td className="text-right">${(trade.price * trade.quantity).toFixed(2)}</td>
                        <td className="text-right font-600">
                          {trade.pnl !== null ? (
                            <span className={trade.pnl >= 0 ? 'text-positive' : 'text-negative'}>
                              {trade.pnl >= 0 ? '+' : ''}
                              ${trade.pnl.toFixed(2)}
                            </span>
                          ) : (
                            <span className="muted">&mdash;</span>
                          )}
                        </td>
                        <td className="text-center">
                          <span className={statusBadge}>{trade.status}</span>
                        </td>
                        <td className="text-center">
                          <div className="hstack justify-center">
                            <span className={`dot ${confidenceTone}`} />
                            <span className="text-xs font-600">{(trade.confidence * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
