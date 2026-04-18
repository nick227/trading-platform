import { useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useApp } from '../app/AppProvider'
import { getPrice } from '../services/prices.js'
import executionsService from '../api/services/executionsService.js'
import { STUB_USER_ID, STATUS } from '../api/constants.js'

// Real-time price fetching using price service
const fetchLatestPrice = async (symbol) => {
  return getPrice(symbol)
}

export default function OrderConfirm() {
  const navigate = useNavigate()
  const location = useLocation()
  const { state, dispatch } = useApp()
  
  // Get order data from navigation state or fallback to app state
  const order = location.state?.order || state.orders.find((item) => item.id === state.selectedOrderId)
  
  // Component state
  const [latestPrice, setLatestPrice] = useState(null)
  const [priceLoading, setPriceLoading] = useState(true)
  const [priceError, setPriceError] = useState(null)
  const [orderType, setOrderType] = useState('manual') // manual | bot
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionError, setExecutionError] = useState(null)
  const [executionStatus, setExecutionStatus] = useState(null) // queued | processing | filled | cancelled | failed
  const [executionId, setExecutionId] = useState(null)
  const pollRef = useRef(null)

  // User bank balance
  const bankBalance = 4200
  const bankConnected = true
  
  // Fetch latest price on component mount
  useEffect(() => {
    const getLatestPrice = async () => {
      if (!order?.asset) return
      
      try {
        setPriceLoading(true)
        setPriceError(null)
        const price = await fetchLatestPrice(order.asset)
        setLatestPrice(price)
      } catch (error) {
        setPriceError('Failed to fetch latest price')
      } finally {
        setPriceLoading(false)
      }
    }
    
    getLatestPrice()
    
    // Set up price refresh interval
    const interval = setInterval(getLatestPrice, 5000)
    return () => clearInterval(interval)
  }, [order?.asset])
  
  // Calculate order details with latest price
  const calculateOrderDetails = () => {
    if (!order || latestPrice === null) return null
    
    const price = order.fillType === 'LIMIT' ? order.limitPrice : 
                 order.fillType === 'STOP' ? order.stopPrice : 
                 latestPrice
    
    const quantity = order.quantity || Math.floor(order.amount / price)
    const totalValue = quantity * price
    
    return {
      price,
      quantity,
      totalValue,
      priceChange: latestPrice - order.price,
      priceChangePercent: ((latestPrice - order.price) / order.price * 100).toFixed(2)
    }
  }
  
  const orderDetails = calculateOrderDetails()
  
  // Validate order before execution
  const validateOrder = () => {
    if (!orderDetails) return false
    if (!bankConnected) {
      setExecutionError('Bank connection required for trading')
      return false
    }
    if (order.type === 'BUY' && orderDetails.totalValue > bankBalance) {
      setExecutionError('Insufficient funds for this order')
      return false
    }
    if (order.type === 'SELL' && orderDetails.quantity > 100) { // Mock max shares
      setExecutionError('Insufficient shares for this sale')
      return false
    }
    return true
  }
  
  // Poll execution status until terminal state
  const startStatusPolling = (id) => {
    pollRef.current = setInterval(async () => {
      const execution = await executionsService.getById(id)
      if (!execution) return

      setExecutionStatus(execution.status)

      const terminal = [STATUS.FILLED, STATUS.CANCELLED, STATUS.FAILED]
      if (terminal.includes(execution.status)) {
        clearInterval(pollRef.current)
        setIsExecuting(false)
        if (execution.status === STATUS.FILLED) {
          setTimeout(() => navigate('/orders'), 2000)
        } else {
          setExecutionError(
            execution.status === STATUS.FAILED
              ? 'Order failed after maximum retries.'
              : `Order ${execution.status}${execution.cancelReason ? `: ${execution.cancelReason}` : ''}`
          )
        }
      }
    }, 2000)
  }

  // Clean up polling on unmount
  useEffect(() => () => clearInterval(pollRef.current), [])

  // Handle bot creation navigation
  const handleCreateBot = () => {
    if (!order) return
    
    navigate('/bots/create', {
      state: {
        defaultConfig: {
          tickers: [order.asset],
          quantity: orderDetails.quantity,
          direction: order.type.toLowerCase()
        }
      }
    })
  }

  // Execute order
  const handleExecuteOrder = async () => {
    if (!validateOrder()) return

    setIsExecuting(true)
    setExecutionError(null)
    setExecutionStatus(null)

    try {
      const execution = await executionsService.create({
        userId:      STUB_USER_ID,
        portfolioId: 'prt_stub_demo',   // stub — replace with real portfolio selection
        strategyId:  'str_stub_demo',   // stub — replace with real strategy selection
        ticker:      order.asset,
        side:        order.type,        // 'BUY' | 'SELL'
        quantity:    orderDetails.quantity,
        price:       orderDetails.price
      })

      if (!execution) {
        setExecutionError('Failed to submit order. Please try again.')
        setIsExecuting(false)
        return
      }

      setExecutionId(execution.id)
      setExecutionStatus(execution.status)
      dispatch({ type: 'SELECT_ORDER', payload: execution.id })

      // Start polling for fill status
      startStatusPolling(execution.id)
    } catch {
      setExecutionError('Failed to submit order. Please try again.')
      setIsExecuting(false)
    }
  }
  
  if (!order) {
    return (
      <div className="page container" style={{ maxWidth: 600, margin: '0 auto', padding: '2rem 1rem 3rem' }}>
        <header style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 className="hero" style={{ marginBottom: '0.5rem' }}>Order Not Found</h1>
          <div className="muted">The order you're looking for doesn't exist</div>
        </header>
        
        <div style={{ textAlign: 'center' }}>
          <button
            className="primary pressable"
            onClick={() => navigate('/orders')}
            style={{ padding: '1rem 2rem' }}
          >
            Back to Orders
          </button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="page container" style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem 3rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 className="hero" style={{ marginBottom: '0.5rem' }}>Order Confirmation</h1>
        <div className="muted">Review your order details before execution</div>
      </header>

      {/* Price Update Alert */}
      {orderDetails && Math.abs(orderDetails.priceChange) > 0.5 && (
        <article style={{ 
          background: orderDetails.priceChange > 0 ? '#fff5f5' : '#f0f9f4',
          border: `1px solid ${orderDetails.priceChange > 0 ? '#fed7d7' : '#c6f6d5'}`,
          borderRadius: 8, 
          padding: '1rem', 
          marginBottom: '1.5rem',
          color: orderDetails.priceChange > 0 ? '#c0392b' : '#0a7a47'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
            Price Updated Since Order Creation
          </div>
          <div style={{ fontSize: '14px' }}>
            {order.asset} is now ${orderDetails.price.toFixed(2)} 
            ({orderDetails.priceChange > 0 ? '+' : ''}{orderDetails.priceChangePercent}%)
          </div>
        </article>
      )}

      {/* Order Details */}
      <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Order Details</h3>
          <div style={{ 
            padding: '0.25rem 0.75rem', 
            borderRadius: '20px', 
            fontSize: '12px', 
            fontWeight: 600,
            background: order.type === 'BUY' ? '#e8f5e8' : '#ffeaea',
            color: order.type === 'BUY' ? '#0a7a47' : '#c0392b'
          }}>
            {order.type}
          </div>
        </div>
        
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Asset:</span>
            <span style={{ fontWeight: 600 }}>{order.assetName || order.asset}</span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Order Type:</span>
            <span style={{ fontWeight: 600 }}>{order.fillType}</span>
          </div>
          
          {order.fillType === 'LIMIT' && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Limit Price:</span>
              <span style={{ fontWeight: 600 }}>${order.limitPrice.toFixed(2)}</span>
            </div>
          )}
          
          {order.fillType === 'STOP' && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Stop Price:</span>
              <span style={{ fontWeight: 600 }}>${order.stopPrice.toFixed(2)}</span>
            </div>
          )}
          
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Quantity:</span>
            <span style={{ fontWeight: 600 }}>
              {orderDetails ? orderDetails.quantity.toLocaleString() : '...'}
            </span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Price per Share:</span>
            <span style={{ fontWeight: 600 }}>
              {priceLoading ? 'Loading...' : orderDetails ? `$${orderDetails.price.toFixed(2)}` : '...'}
            </span>
          </div>
          
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            paddingTop: '1rem',
            borderTop: '1px solid #e9ecef'
          }}>
            <span className="muted" style={{ fontWeight: 600 }}>Total {order.type === 'BUY' ? 'Cost' : 'Proceeds'}:</span>
            <span style={{ fontSize: '18px', fontWeight: 700, color: order.type === 'BUY' ? '#c0392b' : '#0a7a47' }}>
              {orderDetails ? `$${orderDetails.totalValue.toFixed(2)}` : '...'}
            </span>
          </div>
        </div>
      </article>

      {/* Account Impact */}
      <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '18px', fontWeight: 600 }}>Account Impact</h3>
        
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Current Balance:</span>
            <span style={{ fontWeight: 600 }}>${bankBalance.toLocaleString()}</span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">{order.type === 'BUY' ? 'Order Cost' : 'Sale Proceeds'}:</span>
            <span style={{ fontWeight: 600, color: order.type === 'BUY' ? '#c0392b' : '#0a7a47' }}>
              {orderDetails ? `${order.type === 'BUY' ? '-' : '+'}$${orderDetails.totalValue.toFixed(2)}` : '...'}
            </span>
          </div>
          
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            paddingTop: '1rem',
            borderTop: '1px solid #e9ecef'
          }}>
            <span className="muted" style={{ fontWeight: 600 }}>Balance After {order.type === 'BUY' ? 'Order' : 'Sale'}:</span>
            <span style={{ fontSize: '16px', fontWeight: 700 }}>
              ${orderDetails ? (order.type === 'BUY' 
                ? bankBalance - orderDetails.totalValue 
                : bankBalance + orderDetails.totalValue
              ).toLocaleString() : '...'}
            </span>
          </div>
        </div>
      </article>

      {/* Error Messages */}
      {priceError && (
        <article style={{ 
          background: '#fef2f2', 
          border: '1px solid #fecaca', 
          borderRadius: 8, 
          padding: '1rem', 
          marginBottom: '1.5rem',
          color: '#dc2626'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Price Error</div>
          <div style={{ fontSize: '14px' }}>{priceError}</div>
        </article>
      )}

      {/* Quick Bot Creation */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '18px', fontWeight: 600 }}>Quick Actions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <button
            className="primary pressable"
            onClick={handleExecuteOrder}
            disabled={priceLoading || isExecuting || executionStatus === STATUS.FILLED || !orderDetails}
            style={{
              padding: '1rem',
              fontWeight: 600,
              opacity: (priceLoading || isExecuting || executionStatus === STATUS.FILLED || !orderDetails) ? 0.5 : 1
            }}
          >
            {executionStatus === STATUS.QUEUED     ? 'Order Queued...'     :
             executionStatus === STATUS.PROCESSING ? 'Awaiting Fill...'    :
             executionStatus === STATUS.FILLED     ? 'Order Filled'        :
             isExecuting                           ? 'Submitting...'       :
             `Confirm ${order.type} Order`}
          </button>
          
          <button
            className="ghost pressable"
            onClick={handleCreateBot}
            style={{ padding: '1rem', textAlign: 'left' }}
          >
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Create Bot Instead</div>
            <div style={{ fontSize: '14px', opacity: 0.8 }}>
              Create automated trading bot for {order?.asset}
            </div>
          </button>
        </div>
      </section>

      {executionError && (
        <article style={{ 
          background: '#fff5f5', 
          border: '1px solid #fed7d7', 
          borderRadius: 8, 
          padding: '1rem', 
          marginBottom: '1.5rem',
          color: '#c0392b'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Execution Error</div>
          <div style={{ fontSize: '14px' }}>{executionError}</div>
        </article>
      )}

      {executionStatus === STATUS.QUEUED && (
        <article style={{ background: '#f0f6ff', border: '1px solid #bee3f8', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', color: '#2b6cb0' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Order Queued</div>
          <div style={{ fontSize: '14px' }}>Your order is queued and will be submitted shortly.</div>
        </article>
      )}

      {executionStatus === STATUS.PROCESSING && (
        <article style={{ background: '#fffff0', border: '1px solid #fefcbf', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', color: '#975a16' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Order Submitted</div>
          <div style={{ fontSize: '14px' }}>Order is processing — waiting for broker confirmation...</div>
        </article>
      )}

      {executionStatus === STATUS.FILLED && (
        <article style={{ background: '#f0f9f4', border: '1px solid #c6f6d5', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', color: '#0a7a47' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Order Filled</div>
          <div style={{ fontSize: '14px' }}>Your order was executed successfully. Redirecting...</div>
        </article>
      )}

      {executionError && (
        <article style={{ 
          background: '#fff5f5', 
          border: '1px solid #fed7d7', 
          borderRadius: 8, 
          padding: '1rem', 
          marginBottom: '1.5rem',
          color: '#c0392b'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Execution Error</div>
          <div style={{ fontSize: '14px' }}>{executionError}</div>
        </article>
      )}

      <footer style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
        <button
          className="ghost pressable"
          onClick={() => navigate(-1)}
        >
          Cancel
        </button>
        
        <button
          className="primary pressable"
          onClick={handleExecuteOrder}
          disabled={priceLoading || isExecuting || executionStatus === STATUS.FILLED || !orderDetails}
          style={{
            padding: '1rem',
            fontWeight: 600,
            opacity: (priceLoading || isExecuting || executionStatus === STATUS.FILLED || !orderDetails) ? 0.5 : 1
          }}
        >
          {executionStatus === STATUS.QUEUED     ? 'Order Queued...'     :
           executionStatus === STATUS.PROCESSING ? 'Awaiting Fill...'    :
           executionStatus === STATUS.FILLED     ? 'Order Filled'        :
           isExecuting                           ? 'Submitting...'       :
           `Confirm ${order.type} Order`}
        </button>
      </footer>
    </div>
  )
}
