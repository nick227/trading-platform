import { useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useApp } from '../app/AppProvider'
import { get } from '../api/client.js'
import executionsService from '../api/services/executionsService.js'
import { STATUS } from '../api/constants.js'
import { isMarketClosed } from '../utils/market.js'
import { calculateOrderPreview } from '../utils/orderPreview.js'

export default function OrderConfirm() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { state, dispatch } = useApp()

  const order = location.state?.order
    || state.orders?.find(item => item.id === state.selectedOrderId)

  // ── Live price using worker quote source (consistent with Orders.jsx) ───────────────────────
  const [latestPrice,  setLatestPrice]  = useState(null)
  const [priceLoading, setPriceLoading] = useState(true)
  const [priceError,   setPriceError]   = useState(null)
  const [lastGoodQuote, setLastGoodQuote] = useState(null)
  const [lastQuoteTime, setLastQuoteTime] = useState(null)
  
  // Use refs to avoid effect restarts when visibility/focus changes
  const visibilityRef = useRef(true)
  const focusRef = useRef(true)

  // Track page visibility and window focus (update refs, don't restart effect)
  useEffect(() => {
    const handleVisibilityChange = () => {
      visibilityRef.current = !document.hidden
    }
    
    const handleFocus = () => { focusRef.current = true }
    const handleBlur = () => { focusRef.current = false }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // Determine polling interval based on visibility state and market hours (reads refs)
  const getPollingInterval = () => {
    if (!focusRef.current) return null // Pause when window is blurred
    if (!visibilityRef.current) return 20000 // 20 seconds when tab is hidden
    if (isMarketClosed()) return 60000 // 60 seconds when market is closed
    return 3000 // 3 seconds when market is open and tab is visible
  }

  // ── Live bank balance ────────────────────────────────────────────────────────
  const [bankBalance,   setBankBalance]   = useState(0)
  const [bankConnected, setBankConnected] = useState(false)

  // ── Execution state ──────────────────────────────────────────────────────────
  const [isExecuting,      setIsExecuting]      = useState(false)
  const [executionError,   setExecutionError]   = useState(null)
  const [executionStatus,  setExecutionStatus]  = useState(null)
  const [executionId,      setExecutionId]      = useState(null)
  const [executionDetails, setExecutionDetails] = useState(null)
  const [portfolioId,      setPortfolioId]      = useState(null)
  const [submitAttempted,  setSubmitAttempted]  = useState(false)
  const [auditTimeline,   setAuditTimeline]     = useState([])
  const pollRef = useRef(null)

  // Load current ownership data for sell validation
  const [currentShares, setCurrentShares] = useState(0)
  useEffect(() => {
    if (!order?.asset) return
    
    get(`/bootstrap/${order.asset}`)
      .then(data => {
        if (data?.userOwnership?.currentShares) {
          setCurrentShares(data.userOwnership.currentShares)
        }
      })
      .catch(() => {})
  }, [order?.asset])

  // ── Load portfolio ID and live bank balance on mount ─────────────────────────
  useEffect(() => {
    get('/portfolios/default')
      .then(result => setPortfolioId(result?.id ?? result?.data?.id ?? null))
      .catch(() => {})

    get('/alpaca/account')
      .then(account => {
        if (account) {
          setBankBalance(account.buyingPower ?? 0)
          setBankConnected(true)
        }
      })
      .catch(() => {})
  }, [])

  // ── Refresh live price using worker quote source ─────────────────────────────
  useEffect(() => {
    if (!order?.asset) return

    const controller = new AbortController()
    let timeoutId = null
    
    const fetchQuote = async () => {
      try {
        setPriceLoading(true)
        setPriceError(null)
        const response = await fetch(`/api/market/quote/${order.asset}`)
        if (!response.ok) throw new Error('Quote fetch failed')
        const quote = await response.json()
        if (!controller.signal.aborted) {
          setLatestPrice(quote.price)
          setLastGoodQuote(quote)
          setLastQuoteTime(Date.now())
          setPriceError(null)
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setPriceError('Failed to fetch latest price')
          console.warn('Live quote fetch failed:', err)
        }
      } finally {
        if (!controller.signal.aborted) setPriceLoading(false)
      }
      
      // Schedule next fetch based on visibility state
      const interval = getPollingInterval()
      if (interval && !controller.signal.aborted) {
        timeoutId = setTimeout(fetchQuote, interval)
      }
    }

    // Initial fetch
    fetchQuote()

    return () => {
      controller.abort()
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [order?.asset])

  // ── Clean up poll on unmount ─────────────────────────────────────────────────
  useEffect(() => () => clearInterval(pollRef.current), [])

  // ── Derived order details (memoised) ────────────────────────────────────────
  const orderDetails = useMemo(() => {
    if (!order || latestPrice == null) return null
    const price = order.fillType === 'LIMIT' ? order.limitPrice
                : order.fillType === 'STOP'  ? order.stopPrice
                : latestPrice
    const preview = calculateOrderPreview({
      orderType: order.type,
      quantity:  order.quantity,
      amount:    order.amount,
      price,
      bankBalance,
      currentShares,
    })
    if (!preview) return null
    return {
      ...preview,
      priceChange:        latestPrice - order.price,
      priceChangePercent: ((latestPrice - order.price) / order.price * 100).toFixed(2),
    }
  }, [order, latestPrice, bankBalance, currentShares])

  // ── Order validation ─────────────────────────────────────────────────────────
  const validateOrder = () => {
    if (!orderDetails) return false
    if (!bankConnected) { setExecutionError('Bank connection required for trading'); return false }
    if (order.type === 'BUY' && orderDetails.totalValue > bankBalance) {
      setExecutionError('Insufficient buying power'); return false
    }
    if (order.type === 'SELL' && orderDetails.quantity > currentShares) {
      setExecutionError(`Insufficient shares. You own ${currentShares} shares but trying to sell ${orderDetails.quantity}`); return false
    }
    return true
  }

  // ── Execution status polling with audit timeline ───────────────────────────
  const startStatusPolling = (id) => {
    pollRef.current = setInterval(async () => {
      const execution = await executionsService.getById(id)
      if (!execution) return
      
      // Update audit timeline with status changes
      if (execution.status !== executionStatus) {
        const timestamp = new Date()
        setAuditTimeline(prev => [...prev, {
          timestamp: timestamp.toISOString(),
          status: execution.status,
          label: getStatusLabel(execution.status)
        }])
      }
      
      setExecutionStatus(execution.status)
      const terminal = [STATUS.FILLED, STATUS.CANCELLED, STATUS.FAILED]
      if (terminal.includes(execution.status)) {
        clearInterval(pollRef.current)
        setIsExecuting(false)
        setExecutionDetails(execution)
        if (execution.status === STATUS.FILLED) {
          // Broadcast fill so Portfolio (and any other subscriber) invalidates its cache.
          dispatch({ type: 'ORDER_FILLED', payload: Date.now() })
        }
        if (execution.status === STATUS.FAILED) {
          setExecutionError(execution.failReason || execution.cancelReason || 'Order failed after maximum retries.')
        }
      }
    }, 2000)
  }

  // ── Status label helper ───────────────────────────────────────────────────────
  const getStatusLabel = (status) => {
    switch (status) {
      case STATUS.QUEUED: return 'Queued'
      case STATUS.PROCESSING: return 'Processing'
      case STATUS.PARTIALLY_FILLED: return 'Partially Filled'
      case STATUS.FILLED: return 'Filled'
      case STATUS.CANCELLED: return 'Cancelled'
      case STATUS.FAILED: return 'Failed'
      default: return status
    }
  }

  // ── Execute order ────────────────────────────────────────────────────────────
  const handleExecuteOrder = async () => {
    if (!validateOrder() || submitAttempted) return
    
    setSubmitAttempted(true)
    setIsExecuting(true)
    setExecutionError(null)
    setExecutionStatus(null)
    
    // Add initial audit timeline entry
    const startTime = new Date()
    setAuditTimeline([{
      timestamp: startTime.toISOString(),
      status: 'initiated',
      label: 'Order Initiated'
    }])

    if (!portfolioId) {
      setExecutionError('No portfolio found. Please refresh and try again.')
      setIsExecuting(false)
      setSubmitAttempted(false)
      return
    }

    try {
      // Add queued entry
      setAuditTimeline(prev => [...prev, {
        timestamp: new Date().toISOString(),
        status: STATUS.QUEUED,
        label: 'Queued'
      }])
      
      const execution = await executionsService.create({
        portfolioId,
        ticker:      order.asset,
        side:        order.type,
        quantity:    orderDetails.quantity,
        price:       orderDetails.price,
      })
      if (!execution) {
        setExecutionError('Failed to submit order. Please try again.')
        setIsExecuting(false)
        setSubmitAttempted(false)
        return
      }
      
      // Add submitted entry
      setAuditTimeline(prev => [...prev, {
        timestamp: new Date().toISOString(),
        status: STATUS.PROCESSING,
        label: 'Submitted to Broker'
      }])
      
      setExecutionId(execution.id)
      setExecutionStatus(execution.status)
      dispatch({ type: 'SELECT_ORDER', payload: execution.id })
      startStatusPolling(execution.id)
    } catch {
      setExecutionError('Failed to submit order. Please try again.')
      setIsExecuting(false)
      setSubmitAttempted(false)
    }
  }

  // ── Cancel order ─────────────────────────────────────────────────────────────
  const handleCancelOrder = async () => {
    if (!executionId) return
    
    try {
      await executionsService.cancel(executionId)
      setAuditTimeline(prev => [...prev, {
        timestamp: new Date().toISOString(),
        status: 'cancelling',
        label: 'Cancel Requested'
      }])
    } catch (err) {
      setExecutionError('Failed to cancel order. Please try again.')
    }
  }

  const handleCreateBot = () => {
    if (!order) return
    navigate('/bots/create', {
      state: {
        defaultConfig: {
          tickers:   [order.asset],
          quantity:  orderDetails?.quantity,
          direction: order.type.toLowerCase(),
        },
      },
    })
  }

  const submitLabel =
    executionStatus === STATUS.QUEUED     ? 'Order Queued...'   :
    executionStatus === STATUS.PROCESSING ? 'Submitted to Broker...'  :
    executionStatus === STATUS.PARTIALLY_FILLED ? 'Partially Filled...' :
    executionStatus === STATUS.FILLED     ? 'Order Filled'      :
    isExecuting                           ? 'Submitting...'     :
    `Confirm ${order?.type ?? ''} Order`

  const isTerminal = !!(executionStatus
    && [STATUS.FILLED, STATUS.CANCELLED, STATUS.FAILED].includes(executionStatus))

  const canCancel = !!(executionStatus
    && [STATUS.QUEUED, STATUS.PROCESSING].includes(executionStatus))

  const submitDisabled = priceLoading || isExecuting || executionStatus === STATUS.FILLED || !orderDetails || submitAttempted

  if (!order) {
    return (
      <div className="page container" style={{ maxWidth: 600, margin: '0 auto', padding: '2rem 1rem 3rem' }}>
        <header style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 className="hero" style={{ marginBottom: '0.5rem' }}>Order Not Found</h1>
          <div className="muted">The order you're looking for doesn't exist</div>
        </header>
        <div style={{ textAlign: 'center' }}>
          <button className="primary pressable" onClick={() => navigate('/orders')} style={{ padding: '1rem 2rem' }}>
            Back to Orders
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page container" style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem 3rem' }}>
      <header>
        <h1 className="hero" style={{ marginBottom: '0.5rem' }}>Order Confirmation</h1>
        <div className="muted">Review your order details before execution</div>
      </header>

      {/* Market closed warning */}
      {isMarketClosed() && (
        <article style={{ background: '#fff3cd', border: '2px solid #f39c12', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem', color: '#856404' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '16px' }}>Market Currently Closed</div>
          <div style={{ fontSize: '14px', marginBottom: '1rem' }}>
            Orders placed now will be queued and executed when the market opens at 9:30 AM ET.
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="primary pressable" onClick={handleExecuteOrder} disabled={submitDisabled}
              style={{ opacity: submitDisabled ? 0.5 : 1 }}>
              Queue for Market Open
            </button>
          <button className="ghost pressable" onClick={handleCreateBot}
              style={{ opacity: submitDisabled ? 0.5 : 1 }}>
            Create Bot Instead
          </button>


          </div>
        </article>
      )}

      {/* Price movement alert */}
      {orderDetails && Math.abs(orderDetails.priceChange) > 0.5 && (
        <article style={{
          background: orderDetails.priceChange > 0 ? '#fff5f5' : '#f0f9f4',
          border: `1px solid ${orderDetails.priceChange > 0 ? '#fed7d7' : '#c6f6d5'}`,
          borderRadius: 8, marginBottom: '1.5rem',
          color: orderDetails.priceChange > 0 ? '#c0392b' : '#0a7a47',
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Price Updated Since Order Creation</div>
          <div style={{ fontSize: '14px' }}>
            {order.asset} is now ${orderDetails.price.toFixed(2)}
            ({orderDetails.priceChange > 0 ? '+' : ''}{orderDetails.priceChangePercent}%)
          </div>
        </article>
      )}

      {/* Order details */}
      <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Order Details</h3>
          <div style={{
            padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
            background: order.type === 'BUY' ? '#e8f5e8' : '#ffeaea',
            color:      order.type === 'BUY' ? '#0a7a47' : '#c0392b',
          }}>
            {order.type}
          </div>
        </div>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Asset:</span><span style={{ fontWeight: 600 }}>{order.assetName || order.asset}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Order Type:</span><span style={{ fontWeight: 600 }}>{order.fillType}</span>
          </div>
          {order.fillType === 'LIMIT' && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Limit Price:</span><span style={{ fontWeight: 600 }}>${order.limitPrice?.toFixed(2)}</span>
            </div>
          )}
          {order.fillType === 'STOP' && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Stop Price:</span><span style={{ fontWeight: 600 }}>${order.stopPrice?.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Quantity:</span>
            <span style={{ fontWeight: 600 }}>{orderDetails ? orderDetails.quantity.toLocaleString() : '...'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Price per Share:</span>
            <span style={{ fontWeight: 600 }}>{priceLoading ? 'Loading...' : orderDetails ? `$${orderDetails.price.toFixed(2)}` : '...'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '1rem', borderTop: '1px solid #e9ecef' }}>
            <span className="muted" style={{ fontWeight: 600 }}>Total {order.type === 'BUY' ? 'Cost' : 'Proceeds'}:</span>
            <span style={{ fontSize: '18px', fontWeight: 700, color: order.type === 'BUY' ? '#c0392b' : '#0a7a47' }}>
              {orderDetails ? `$${orderDetails.totalValue.toFixed(2)}` : '...'}
            </span>
          </div>
        </div>
      </article>

      {/* Account impact */}
      <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '18px', fontWeight: 600 }}>Account Impact</h3>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Current Balance:</span><span style={{ fontWeight: 600 }}>${bankBalance.toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">{order.type === 'BUY' ? 'Order Cost' : 'Sale Proceeds'}:</span>
            <span style={{ fontWeight: 600, color: order.type === 'BUY' ? '#c0392b' : '#0a7a47' }}>
              {orderDetails ? `${order.type === 'BUY' ? '-' : '+'}$${orderDetails.totalValue.toFixed(2)}` : '...'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '1rem', borderTop: '1px solid #e9ecef' }}>
            <span className="muted" style={{ fontWeight: 600 }}>Balance After {order.type === 'BUY' ? 'Order' : 'Sale'}:</span>
            <span style={{ fontSize: '16px', fontWeight: 700 }}>
              {orderDetails ? `$${orderDetails.afterBalance.toLocaleString()}` : '...'}
            </span>
          </div>
        </div>
      </article>

      {/* Price fetch error */}
      {priceError && (
        <article style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: '1.5rem', color: '#dc2626' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Price Error</div>
          <div style={{ fontSize: '14px' }}>{priceError}</div>
        </article>
      )}

      {/* Status banners with richer states */}
      {executionStatus === STATUS.QUEUED && (
        <article style={{ background: '#f0f6ff', border: '1px solid #bee3f8', borderRadius: 8, marginBottom: '1.5rem', color: '#2b6cb0' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Order Queued</div>
          <div style={{ fontSize: '14px' }}>Your order is queued and will be submitted to the broker shortly.</div>
          {canCancel && (
            <button className="ghost pressable" onClick={handleCancelOrder} 
              style={{ marginTop: '0.75rem', padding: '0.25rem 0.75rem', fontSize: '12px', border: '1px solid #2b6cb0', color: '#2b6cb0' }}>
              Cancel Order
            </button>
          )}
        </article>
      )}
      {executionStatus === STATUS.PROCESSING && (
        <article style={{ background: '#fffff0', border: '1px solid #fefcbf', borderRadius: 8, marginBottom: '1.5rem', color: '#975a16' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Submitted to Broker</div>
          <div style={{ fontSize: '14px' }}>Order submitted and awaiting broker confirmation...</div>
          {canCancel && (
            <button className="ghost pressable" onClick={handleCancelOrder} 
              style={{ marginTop: '0.75rem', padding: '0.25rem 0.75rem', fontSize: '12px', border: '1px solid #975a16', color: '#975a16' }}>
              Cancel Order
            </button>
          )}
        </article>
      )}
      {executionStatus === STATUS.PARTIALLY_FILLED && (
        <article style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: '1.5rem', color: '#166534' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Partially Filled</div>
          <div style={{ fontSize: '14px' }}>Order is partially filled. Remaining shares are still active.</div>
        </article>
      )}

      {/* Audit timeline */}
      {auditTimeline.length > 0 && (
        <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '18px', fontWeight: 600 }}>Order Timeline</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {auditTimeline.map((entry, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: entry.status === 'initiated' ? '#3b82f6' :
                             entry.status === STATUS.QUEUED ? '#f59e0b' :
                             entry.status === STATUS.PROCESSING ? '#8b5cf6' :
                             entry.status === STATUS.FILLED ? '#10b981' :
                             entry.status === STATUS.CANCELLED ? '#ef4444' :
                             entry.status === STATUS.FAILED ? '#ef4444' :
                             entry.status === 'cancelling' ? '#f59e0b' : '#6b7280'
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>{entry.label}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>
                    {new Date(entry.timestamp).toLocaleTimeString('en-US', {
                      hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York'
                    })} ET
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>
      )}

      {/* Filled — success card */}
      {executionStatus === STATUS.FILLED && executionDetails && (
        <article style={{
          background: 'linear-gradient(135deg, #f0f9f4, #e8f5e8)', border: '2px solid #0a7a47',
          borderRadius: 12, padding: '2rem', marginBottom: '1.5rem', color: '#0a7a47', textAlign: 'center',
        }}>
          <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '1rem' }}>✓ Order Filled</div>
          <div style={{ background: 'rgba(255,255,255,0.8)', borderRadius: 8, padding: '1.5rem', marginBottom: '1.5rem', fontSize: '14px' }}>
            <div style={{ marginBottom: '0.75rem' }}>
              <span className="muted">{order.type} {(executionDetails.quantity ?? orderDetails?.quantity)?.toLocaleString()} {order.asset}</span>
              <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '0.25rem' }}>
                @ ${(executionDetails.price ?? orderDetails?.price ?? latestPrice)?.toFixed(2)}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '12px' }}>
              <div>
                <div className="muted">Total {order.type === 'BUY' ? 'Cost' : 'Proceeds'}:</div>
                <div style={{ fontWeight: 600 }}>
                  ${((executionDetails.quantity ?? orderDetails?.quantity) * (executionDetails.price ?? orderDetails?.price ?? latestPrice)).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="muted">Time:</div>
                <div style={{ fontWeight: 600 }}>
                  {new Date(executionDetails.updatedAt || executionDetails.createdAt || new Date()).toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York',
                  })} ET
                </div>
              </div>
              <div>
                <div className="muted">Order ID:</div>
                <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>#{executionId?.slice(-6) || '...'}</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
            <button className="primary pressable" onClick={() => navigate('/orders')}    style={{ padding: '0.75rem', fontWeight: 600 }}>Back to Orders</button>
            <button className="ghost pressable"   onClick={() => navigate('/portfolio')} style={{ padding: '0.75rem', fontWeight: 600 }}>View Portfolio</button>
            <button className="ghost pressable"   onClick={() => navigate('/portfolio')} style={{ padding: '0.75rem', fontWeight: 600 }}>View Activity</button>
            <button className="ghost pressable"   onClick={() => navigate('/orders', { state: { resetForm: true } })} style={{ padding: '0.75rem', fontWeight: 600 }}>Buy/Sell Again</button>
          </div>
        </article>
      )}

      {/* Failed — single error card (was duplicated before) */}
      {executionError && (
        <article style={{
          background: 'linear-gradient(135deg, #fff5f5, #fee2e2)', border: '2px solid #c0392b',
          borderRadius: 12, padding: '2rem', marginBottom: '1.5rem', color: '#c0392b', textAlign: 'center',
        }}>
          <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '1rem' }}>Order Failed</div>
          <div style={{ background: 'rgba(255,255,255,0.8)', borderRadius: 8, padding: '1.5rem', marginBottom: '1.5rem', fontSize: '14px' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Reason:</div>
            <div style={{ fontSize: '16px', marginBottom: '1rem' }}>{executionError}</div>
            {(executionError.includes('Insufficient') || executionError.includes('funds')) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '12px' }}>
                <div><div className="muted">Requested:</div><div style={{ fontWeight: 600, color: '#c0392b' }}>${orderDetails?.totalValue?.toFixed(2) || '...'}</div></div>
                <div><div className="muted">Available:</div><div style={{ fontWeight: 600, color: '#0a7a47' }}>${bankBalance.toLocaleString()}</div></div>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            <button className="primary pressable" onClick={() => navigate(-1)}           style={{ padding: '0.75rem', fontWeight: 600 }}>Edit Order</button>
            <button className="ghost pressable"   onClick={() => navigate('/orders')}    style={{ padding: '0.75rem', fontWeight: 600 }}>Back to Orders</button>
            <button className="ghost pressable"   onClick={() => navigate('/portfolio')} style={{ padding: '0.75rem', fontWeight: 600 }}>View Portfolio</button>
          </div>
        </article>
      )}

      {/* Footer — hidden once terminal */}
      {!isTerminal && (
        <footer style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button className="ghost pressable" onClick={() => navigate(-1)}>Cancel</button>
          <button className="primary pressable" onClick={handleExecuteOrder} disabled={submitDisabled}
            style={{ fontWeight: 600, opacity: submitDisabled ? 0.5 : 1 }}>
            {submitLabel}
          </button>
        </footer>
      )}
    </div>
  )
}
