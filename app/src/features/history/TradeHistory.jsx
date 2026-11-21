import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getPage } from '../../api/client'
import { mapExecution } from '../../api/services/executionsService'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function fmtMoney(n) {
  return n === null || n === undefined ? '—' : currency.format(n)
}

function fmtSignedMoney(n) {
  if (n === null || n === undefined || n === 0) return '—'
  const sign = n > 0 ? '+' : '−'
  return `${sign}${currency.format(Math.abs(n))}`
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function getStatusBadge(status) {
  const s = String(status || '').toLowerCase()
  switch (s) {
    case 'filled':
      return <span className="chip chip-live">Filled</span>
    case 'partially_filled':
      return <span className="chip chip-warn">Partial Fill</span>
    case 'submitted':
    case 'queued':
    case 'processing':
    case 'pending_new':
    case 'accepted':
      return <span className="chip chip-warn">Pending</span>
    case 'cancelled':
    case 'canceled':
      return <span className="chip chip-neutral">Cancelled</span>
    case 'failed':
    case 'rejected':
    case 'expired':
      return <span className="chip chip-error">Rejected</span>
    default:
      return <span className="chip">{status || 'Unknown'}</span>
  }
}

export default function TradeHistory() {
  const [executions, setExecutions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all') // all | filled | pending | cancelled_rejected

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const page = await getPage('/executions', { limit: 50 })
      setExecutions((page.data || []).map(mapExecution))
      setNextCursor(page.pagination?.nextCursor || null)
    } catch (err) {
      setError(err.message || 'Failed to load trade history.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await getPage('/executions', { limit: 50, after: nextCursor })
      setExecutions(prev => [...prev, ...(page.data || []).map(mapExecution)])
      setNextCursor(page.pagination?.nextCursor || null)
    } catch (err) {
      setError(err.message || 'Failed to load more trade history.')
    } finally {
      setLoadingMore(false)
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'filled') return executions.filter(e => e.status === 'filled')
    if (filter === 'pending') {
      return executions.filter(e => ['queued', 'processing', 'submitted', 'pending_new', 'partially_filled'].includes(e.status))
    }
    if (filter === 'cancelled_rejected') {
      return executions.filter(e => ['cancelled', 'canceled', 'failed', 'rejected', 'expired'].includes(e.status))
    }
    return executions
  }, [executions, filter])

  return (
    <main className="page container trade-history-page">
      <header className="home-header mb-6">
        <div>
          <h1 className="home-title">Trade History</h1>
          <p className="home-sub">Authoritative paper-trading orders and broker execution records.</p>
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={loadData}
          disabled={loading}
          title="Refresh trade history"
        >
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </header>

      {/* Filter Tabs */}
      <div className="wrap mb-4 gap-2">
        <button
          type="button"
          className={filter === 'all' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
          onClick={() => setFilter('all')}
        >
          All ({executions.length})
        </button>
        <button
          type="button"
          className={filter === 'filled' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
          onClick={() => setFilter('filled')}
        >
          Filled ({executions.filter(e => e.status === 'filled').length})
        </button>
        <button
          type="button"
          className={filter === 'pending' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
          onClick={() => setFilter('pending')}
        >
          Pending / Open
        </button>
        <button
          type="button"
          className={filter === 'cancelled_rejected' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
          onClick={() => setFilter('cancelled_rejected')}
        >
          Cancelled & Rejected
        </button>
      </div>

      {error && (
        <div className="alert alert-error mb-4" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card card-pad-lg text-center text-muted">
          <p className="m-0">Loading trade history…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card card-pad-lg text-center text-muted">
          <p className="text-lg mb-2">No trade records found</p>
          <p className="text-sm mb-4">
            {filter === 'all'
              ? 'When your bots evaluate signals and place paper orders, they will appear here.'
              : 'No orders match this filter.'}
          </p>
          <Link to="/bots" className="btn btn-sm btn-primary">
            View My Bots
          </Link>
        </div>
      ) : (
        <div className="card card-pad-none overflow-x-auto">
          <table className="table w-full text-sm" data-testid="trade-history-table">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-left">Symbol</th>
                <th className="p-3 text-left">Bot</th>
                <th className="p-3 text-left">Side</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 text-right">Intent Price</th>
                <th className="p-3 text-right">Filled Price</th>
                <th className="p-3 text-left">Broker Status</th>
                <th className="p-3 text-right">Realized P/L</th>
                <th className="p-3 text-left">Submitted</th>
                <th className="p-3 text-left">Filled / Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const side = String(item.direction || item.side || '').toLowerCase()
                const isBuy = side === 'buy'
                const pnl = Number(item.pnl ?? 0)
                const botName = item.bot?.name || (item.botId ? `Bot ${item.botId.slice(0, 8)}` : 'Manual')

                return (
                  <tr key={item.id} className="border-b hover:bg-subtle">
                    <td className="p-3 font-600">
                      <Link to={`/assets/${item.ticker}`} className="text-primary hover:underline">
                        {item.ticker}
                      </Link>
                    </td>
                    <td className="p-3 text-xs">
                      {item.botId ? (
                        <Link to={`/bots/${item.botId}`} className="text-decoration-none">
                          <span className="font-500">{botName}</span>
                        </Link>
                      ) : (
                        <span className="muted">Manual Order</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={isBuy ? 'chip chip-live' : 'chip chip-error'}>
                        {isBuy ? 'BUY' : 'SELL'}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono">
                      {item.filledQuantity !== null && item.filledQuantity !== undefined
                        ? `${item.filledQuantity} / ${item.quantity}`
                        : item.quantity}
                    </td>
                    <td className="p-3 text-right font-mono text-muted">
                      {fmtMoney(item.price)}
                    </td>
                    <td className="p-3 text-right font-mono font-600">
                      {fmtMoney(item.filledPrice)}
                    </td>
                    <td className="p-3">
                      {getStatusBadge(item.status)}
                    </td>
                    <td className={`p-3 text-right font-mono font-600 ${pnl > 0 ? 'text-positive' : pnl < 0 ? 'text-negative' : 'muted'}`}>
                      {pnl !== 0 ? fmtSignedMoney(pnl) : '—'}
                    </td>
                    <td className="p-3 text-xs muted text-nowrap">
                      {fmtTime(item.submittedAt || item.createdAt)}
                    </td>
                    <td className="p-3 text-xs muted text-nowrap">
                      {fmtTime(item.filledAt || item.lastBrokerSyncAt)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {nextCursor && (
            <div className="p-3 text-center border-t">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading more…' : 'Load older records'}
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  )
}
