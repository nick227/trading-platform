import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getPage } from '../../api/client'
import { mapExecution } from '../../api/services/executionsService'

export default function ActivityTab() {
  const [executions, setExecutions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState(null)
  const [status, setStatus] = useState(null) // { type: 'success'|'error', message }

  useEffect(() => {
    loadExecutions()
  }, [])

  const loadExecutions = async () => {
    setLoading(true)
    setStatus(null)
    try {
      const page = await getPage('/executions', { limit: 50 })
      setExecutions((page.data || []).map(mapExecution))
      setHasMore(page.pagination?.hasMore || false)
      setNextCursor(page.pagination?.nextCursor || null)
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Failed to load activity.' })
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await getPage('/executions', { limit: 50, after: nextCursor })
      setExecutions(prev => [...prev, ...(page.data || []).map(mapExecution)])
      setHasMore(page.pagination?.hasMore || false)
      setNextCursor(page.pagination?.nextCursor || null)
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Failed to load more activity.' })
    } finally {
      setLoadingMore(false)
    }
  }

  const formatDate = (timestamp) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'filled': return 'chip-live'
      case 'pending_new':
      case 'accepted':
      case 'queued': return 'chip-warn'
      case 'canceled':
      case 'rejected':
      case 'expired': return 'chip-error'
      default: return ''
    }
  }

  return (
    <div className="profile-pane">
      <div className="card profile-card">
        <div className="profile-card-header">
          <h3 className="profile-card-title">Recent Activity</h3>
          <button 
            className="btn btn-xs btn-ghost" 
            onClick={loadExecutions} 
            disabled={loading}
            title="Refresh"
          >
            {loading ? '...' : '↻'}
          </button>
        </div>

        {loading ? (
          <p className="muted">Loading activity...</p>
        ) : executions.length === 0 ? (
          <div className="text-center py-4">
            <p className="muted mb-2">No recent activity.</p>
            <Link to="/bots/create" className="btn btn-sm btn-primary">
              Start Trading
            </Link>
          </div>
        ) : (
          <>
            <div className="list">
              {executions.map((execution) => (
                <div key={execution.id} className="row">
                  <div>
                    <strong>
                      <Link to={`/assets/${execution.ticker}`} className="text-decoration-none">
                        {execution.direction.toUpperCase()} {execution.ticker}
                      </Link>
                    </strong>
                    <div className="muted text-xs">
                      {execution.quantity} shares @ ${execution.price?.toFixed(2)}
                    </div>
                  </div>
                  <span className="muted">{formatDate(execution.createdAt)}</span>
                  <span className={`chip ${getStatusColor(execution.status)}`}>
                    {execution.status}
                  </span>
                </div>
              ))}
            </div>
            {hasMore && (
              <div className="text-center mt-3">
                <button 
                  className="btn btn-sm btn-ghost" 
                  onClick={loadMore} 
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {status && (
        <p className={`profile-status mt-3 ${status.type === 'error' ? 'text-negative' : 'text-positive'}`} role="status">
          {status.message}
        </p>
      )}
    </div>
  )
}
