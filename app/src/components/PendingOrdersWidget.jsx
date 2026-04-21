import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider.jsx'
import { usePendingOrders } from '../hooks/usePendingOrders.js'
import { STATUS } from '../api/constants.js'

function formatTimeAgo(ts) {
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
  if (!Number.isFinite(t)) return '—'
  const secs = Math.floor((Date.now() - t) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function getExpectedExecutionTime(order) {
  const now = new Date()
  const marketOpen = new Date(now)
  marketOpen.setHours(9, 30, 0, 0) // 9:30 AM ET
  marketOpen.setMinutes(marketOpen.getMinutes() - now.getTimezoneOffset()) // Convert to ET
  
  const marketClose = new Date(now)
  marketClose.setHours(16, 0, 0, 0) // 4:00 PM ET
  marketClose.setMinutes(marketClose.getMinutes() - now.getTimezoneOffset())
  
  const isMarketOpen = now >= marketOpen && now <= marketClose
  
  if (order.status === 'processing') {
    return 'Executing now...'
  }
  
  if (order.status === 'queued') {
    if (isMarketOpen) {
      return 'Soon (next market window)'
    } else {
      // If market is closed, schedule for next open
      const nextOpen = new Date(marketOpen)
      if (now > marketClose) {
        nextOpen.setDate(nextOpen.getDate() + 1)
      }
      const timeUntilOpen = nextOpen - now
      const hours = Math.floor(timeUntilOpen / (1000 * 60 * 60))
      const minutes = Math.floor((timeUntilOpen % (1000 * 60 * 60)) / (1000 * 60))
      
      if (hours > 0) {
        return `In ${hours}h ${minutes}m (market open)`
      } else {
        return `In ${minutes}m (market open)`
      }
    }
  }
  
  return null
}

function statusLabel(status) {
  if (status === STATUS.QUEUED) return 'Queued'
  if (status === STATUS.PROCESSING) return 'Processing'
  return status ?? '—'
}

export default function PendingOrdersWidget() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const enabled = Boolean(user)
  const { pendingOrders, cancelOrder, isCanceling } = usePendingOrders({
    enabled,
    pollIntervalMs: 5000
  })

  const visible = useMemo(() => {
    return pendingOrders
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3)
  }, [pendingOrders])

  if (!enabled || pendingOrders.length === 0) return null

  return (
    <div className="container" style={{ padding: '1rem 0' }}>
      {/* Heading line */}
      <div style={{ 
        fontSize: '14px', 
        fontWeight: 600, 
        marginBottom: '0.75rem',
        textAlign: 'center'
      }}>
        Pending orders ({pendingOrders.length})
      </div>

      {/* Orders grid */}
      <div style={{ 
        display: 'grid', 
        gap: '0.75rem',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {visible.map(o => {
          const side = (o.side ?? '').toUpperCase()
          const qty = o.quantity ?? 0
          const price = o.price ?? 0
          const created = o.createdAt
          const expectedTime = getExpectedExecutionTime(o)
          return (
            <div key={o.id} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '1rem',
              padding: '0.5rem 0.75rem',
              background: '#f8f9fa',
              borderRadius: '20px',
              border: '1px solid #e9ecef'
            }}>
              <span style={{
                fontWeight: 700,
                color: side === 'BUY' ? '#0a7a47' : '#c0392b',
                minWidth: '40px',
                textAlign: 'center'
              }}>
                {side || '—'}
              </span>
              <span style={{ fontWeight: 600, minWidth: '60px' }}>{o.ticker}</span>
              <span className="muted" style={{ minWidth: '80px' }}>{qty} @ ${Number(price).toFixed(2)}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                <span className="muted" style={{ fontSize: '12px' }}>
                  {statusLabel(o.status)} • {formatTimeAgo(created)}
                </span>
                {expectedTime && (
                  <span style={{ 
                    fontSize: '11px', 
                    color: '#0a7a47', 
                    fontWeight: 500 
                  }}>
                    {expectedTime}
                  </span>
                )}
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => cancelOrder(o.id)}
                disabled={isCanceling(o.id)}
                style={{ 
                  fontSize: '11px', 
                  padding: '0.25rem 0.75rem',
                  borderRadius: '20px',
                  fontWeight: 600,
                  border: '1px solid #dee2e6',
                  background: 'white'
                }}
                aria-label={`Cancel ${o.ticker} order`}
              >
                {isCanceling(o.id) ? 'Canceling…' : 'Cancel'}
              </button>
            </div>
          )
        })}
      </div>

      {/* More orders indicator */}
      {pendingOrders.length > visible.length && (
        <div style={{ 
          textAlign: 'center',
          marginTop: '0.75rem'
        }}>
          <div className="muted" style={{ fontSize: '12px' }}>
            +{pendingOrders.length - visible.length} more pending orders
          </div>
        </div>
      )}
    </div>
  )
}
