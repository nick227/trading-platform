import { useNavigate, useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import strategiesService from '../api/services/strategiesService'

export default function StrategyHistory() {
  const navigate = useNavigate()
  const { templateId } = useParams()
  const [strategy, setStrategy] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    const load = async () => {
      try {
        const [platform, historyPage] = await Promise.all([
          strategiesService.getPlatformStrategies(),
          strategiesService.getStrategyHistory(templateId, { limit: 200 })
        ])
        const found = Array.isArray(platform) ? platform.find(s => s.id === templateId) : null
        setStrategy(found ?? null)
        setHistory(Array.isArray(historyPage?.data) ? historyPage.data : [])
      } catch {
        setStrategy(null)
        setHistory([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [templateId])

  if (loading) {
    return (
      <div className="l-page">
        <div className="container">
          <div className="panel-empty">Loading strategy history…</div>
        </div>
      </div>
    )
  }

  if (!strategy) {
    return (
      <div className="l-page">
        <div className="container">
          <div className="panel-empty">
            <h2 className="m-0 mb-2">Strategy Not Found</h2>
            <p className="muted m-0 mb-3">The requested strategy could not be found.</p>
            <button className="btn btn-sm btn-primary" type="button" onClick={() => navigate('/bots')}>
              Back to Bots
            </button>
          </div>
        </div>
      </div>
    )
  }

  const filteredHistory = filter === 'all' ? history : history.filter(e => e.direction === filter)

  const totalPnl = history.reduce((sum, e) => sum + Number(e.pnl), 0)
  const winCount = history.filter(e => Number(e.pnl) > 0).length
  const winRate = history.length > 0 ? (winCount / history.length) * 100 : 0
  const pnlTone = totalPnl >= 0 ? 'text-positive' : 'text-negative'

  const formatDate = ts =>
    new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })

  return (
    <div className="l-page">
      <div className="container l-stack-lg">
        <header className="stack-sm">
          <button className="btn btn-xs btn-ghost" type="button" onClick={() => navigate('/bots')}>
            ← Back to Bots
          </button>
          <div className="stack-sm">
            <h1 className="hero m-0">{strategy.name} — Platform History</h1>
            <p className="muted text-md m-0">
              Aggregate execution history across all {strategy.subscriberCount} subscriber{strategy.subscriberCount !== 1 ? 's' : ''}.
              No per-user data is shown.
            </p>
          </div>
        </header>

        <section>
          <div className="l-grid-auto-200">
            <article className="card card-pad-sm text-center">
              <div className={`text-xl font-700 ${pnlTone}`}>
                {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
              </div>
              <div className="kpi-label">Aggregate P&amp;L</div>
            </article>
            <article className="card card-pad-sm text-center">
              <div className="text-xl font-700">{winRate.toFixed(0)}%</div>
              <div className="kpi-label">Win Rate</div>
            </article>
            <article className="card card-pad-sm text-center">
              <div className="text-xl font-700">{history.length}</div>
              <div className="kpi-label">Executions</div>
            </article>
            <article className="card card-pad-sm text-center">
              <div className="text-xl font-700">{strategy.subscriberCount}</div>
              <div className="kpi-label">Subscribers</div>
            </article>
          </div>
        </section>

        <section className="card card-pad-md">
          <div className="panel-header">
            <h2 className="panel-title">Executions</h2>
            <div className="wrap">
              {['all', 'BUY', 'SELL'].map(key => (
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
            <div className="panel-empty">No executions recorded yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Direction</th>
                    <th>Ticker</th>
                    <th className="text-right">Fill Price</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map(exec => {
                    const dirBadge = exec.direction === 'BUY'
                      ? 'badge badge-positive badge-xs'
                      : 'badge badge-negative badge-xs'
                    const pnlVal = Number(exec.pnl)
                    const fillPrice = exec.filledPrice ?? exec.price
                    const fillQty = exec.filledQuantity ?? exec.quantity

                    return (
                      <tr key={exec.id}>
                        <td>{formatDate(exec.filledAt ?? exec.createdAt)}</td>
                        <td><span className={dirBadge}>{exec.direction}</span></td>
                        <td className="font-600">{exec.ticker}</td>
                        <td className="text-right">${Number(fillPrice).toFixed(2)}</td>
                        <td className="text-right">{fillQty}</td>
                        <td className="text-right">${(Number(fillPrice) * Number(fillQty)).toFixed(2)}</td>
                        <td className="text-right font-600">
                          <span className={pnlVal >= 0 ? 'text-positive' : 'text-negative'}>
                            {pnlVal >= 0 ? '+' : ''}${pnlVal.toFixed(2)}
                          </span>
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
