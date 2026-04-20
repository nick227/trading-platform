# MVP POC Plan - Single User Operator Mode

## Goal
**Fastest path to you using the app individually with real paper trades and bot performance tracking**

## Current State Analysis
- You have Alpha Engine connected via `:8090`
- You have Alpaca client implementation
- You have MySQL database already
- You need: **Real paper trades + bot performance tracking**

## Strategic Decision: Stay on MySQL

**Why MySQL is smartest now:**
- Zero migration delay - no rewriting schema, connectors, envs
- Stable enough for current scale
- Lets you focus on truth metrics (profitability, signal quality)
- Future migration remains possible if needed

## Single User Operator Mode

### Configuration
```json
// config/operator.json
{
  "mode": "single_user_operator",
  "paperTrading": true,
  "defaultTradeSize": 25,
  "minConfidence": 0.72,
  "maxDailyTrades": 3,
  "allowedSymbols": ["SPY", "QQQ", "AAPL", "TSLA", "NVDA"]
}
```

#### 1.2 Real Alpaca Integration
```javascript
// server/src/routes/alpaca.js - Direct paper trading
export default async function alpacaRoutes(app) {
  app.post('/trade', async (request, reply) => {
    const { ticker, quantity = 1, side = 'buy' } = request.body
    
    const alpacaClient = new AlpacaClient({
      apiKey: process.env.ALPACA_PAPER_API_KEY,
      apiSecret: process.env.ALPACA_PAPER_API_SECRET,
      paper: true
    })
    
    const order = await alpacaClient.submitOrder({
      ticker,
      side,
      qty: quantity,
      type: 'market'
    })
    
    return { order, status: 'success' }
  })
  
  app.get('/positions', async (request, reply) => {
    const alpacaClient = new AlpacaClient({
      apiKey: process.env.ALPACA_PAPER_API_KEY,
      apiSecret: process.env.ALPACA_PAPER_API_SECRET,
      paper: true
    })
    
    const positions = await alpacaClient.getPositions()
    return { positions }
  })
  
  app.get('/account', async (request, reply) => {
    const alpacaClient = new AlpacaClient({
      apiKey: process.env.ALPACA_PAPER_API_KEY,
      apiSecret: process.env.ALPACA_PAPER_API_SECRET,
      paper: true
    })
    
    const account = await alpacaClient.getAccount()
    return { account }
  })
}
```

## MySQL Schema for MVP

### Essential Tables
```sql
-- Single operator user
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role ENUM('operator', 'admin') DEFAULT 'operator',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Broker credentials (encrypted)
CREATE TABLE broker_accounts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  provider ENUM('alpaca') DEFAULT 'alpaca',
  paper BOOLEAN DEFAULT TRUE,
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT NOT NULL,
  status ENUM('active', 'error', 'disabled') DEFAULT 'active',
  last_verified_at TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Bot execution runs
CREATE TABLE bot_runs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  status ENUM('running', 'completed', 'failed') DEFAULT 'running',
  signal_count INT DEFAULT 0,
  execution_count INT DEFAULT 0,
  total_pnl DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Individual trade executions
CREATE TABLE executions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  bot_run_id INT NULL,
  symbol VARCHAR(10) NOT NULL,
  side ENUM('buy', 'sell') NOT NULL,
  quantity DECIMAL(10,4) NOT NULL,
  signal_score DECIMAL(3,2),
  alpaca_order_id VARCHAR(50),
  status ENUM('submitted', 'filled', 'cancelled', 'failed') DEFAULT 'submitted',
  fill_price DECIMAL(10,4),
  commission DECIMAL(8,2) DEFAULT 0,
  pnl DECIMAL(10,2) DEFAULT 0,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  filled_at TIMESTAMP NULL,
  FOREIGN KEY (bot_run_id) REFERENCES bot_runs(id)
);

-- Daily performance snapshots
CREATE TABLE daily_snapshots (
  id INT PRIMARY KEY AUTO_INCREMENT,
  snapshot_date DATE UNIQUE NOT NULL,
  equity DECIMAL(12,2) NOT NULL,
  cash DECIMAL(12,2) NOT NULL,
  positions_value DECIMAL(12,2) NOT NULL,
  day_pnl DECIMAL(10,2) DEFAULT 0,
  total_trades INT DEFAULT 0,
  winning_trades INT DEFAULT 0,
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 2.2 Alpha Engine Bot Integration
```javascript
// server/src/services/autoBot.js
import alphaEngineService from '../api/services/alphaEngineService.js'
import { logBotExecution } from './botLogger.js'

export async function runAutoBot() {
  try {
    // Get top signal from Alpha Engine
    const signals = await alphaEngineService.getActiveSignals()
    const topSignal = signals[0]
    
    if (!topSignal || topSignal.confidence < 0.7) {
      console.log('No high-confidence signals available')
      return null
    }
    
    // Execute trade
    const alpacaClient = new AlpacaClient({
      apiKey: process.env.ALPACA_PAPER_API_KEY,
      apiSecret: process.env.ALPACA_PAPER_API_SECRET,
      paper: true
    })
    
    const order = await alpacaClient.submitOrder({
      ticker: topSignal.symbol,
      side: topSignal.direction,
      qty: 1, // Conservative for testing
      type: 'market'
    })
    
    // Wait for fill and log result
    await new Promise(resolve => setTimeout(resolve, 2000))
    const result = await alpacaClient.getOrder(order.alpacaOrderId)
    
    const execution = logBotExecution(topSignal, order, result)
    
    console.log(`Bot executed: ${topSignal.symbol} ${topSignal.direction} - PnL: $${execution.pnl}`)
    return execution
    
  } catch (error) {
    console.error('Auto bot execution failed:', error)
    return null
  }
}
```

### Phase 3: Simple UI (Day 3)

#### 3.1 Bot Control Panel
```javascript
// app/src/features/BotControl.jsx
export default function BotControl() {
  const [isRunning, setIsRunning] = useState(false)
  const [performance, setPerformance] = useState(null)
  const [lastExecution, setLastExecution] = useState(null)
  
  const startBot = async () => {
    setIsRunning(true)
    const response = await fetch('/api/bot/start', { method: 'POST' })
    const { execution } = await response.json()
    setLastExecution(execution)
    setIsRunning(false)
    refreshPerformance()
  }
  
  const refreshPerformance = async () => {
    const response = await fetch('/api/bot/performance')
    const data = await response.json()
    setPerformance(data)
  }
  
  return (
    <div style={{ padding: '2rem' }}>
      <h2>Trading Bot Control</h2>
      
      <div style={{ marginBottom: '2rem' }}>
        <button 
          onClick={startBot}
          disabled={isRunning}
          style={{
            padding: '1rem 2rem',
            backgroundColor: isRunning ? '#ccc' : '#1f8a4c',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: isRunning ? 'not-allowed' : 'pointer'
          }}
        >
          {isRunning ? 'Bot Running...' : 'Execute Bot Trade'}
        </button>
      </div>
      
      {performance && (
        <div style={{ marginBottom: '2rem' }}>
          <h3>Performance</h3>
          <p>Total Trades: {performance.totalTrades}</p>
          <p>Win Rate: {performance.winRate.toFixed(1)}%</p>
          <p>Total P&L: ${performance.totalPNL.toFixed(2)}</p>
        </div>
      )}
      
      {lastExecution && (
        <div>
          <h3>Last Execution</h3>
          <p>Symbol: {lastExecution.signal.symbol}</p>
          <p>Direction: {lastExecution.signal.direction}</p>
          <p>P&L: ${lastExecution.pnl.toFixed(2)}</p>
        </div>
      )}
    </div>
  )
}
```

## Integration with Existing UI Flow

### Current UI Architecture
- **Portfolio.jsx** - Main portfolio view with holdings and stats
- **Orders.jsx** - Order placement with stock selection and order form
- **OrderConfirmation** - Order confirmation flow (missing, need to create)

### MVP Integration Strategy

**Enhance existing components rather than replace:**

1. **Portfolio.jsx** - Add bot status and performance widgets
2. **Orders.jsx** - Wire real Alpaca execution instead of mock
3. **OrderConfirmation** - Create missing confirmation screen
4. **Bot Console** - Add as new section in Portfolio

### Enhanced Portfolio Integration

```javascript
// app/src/features/Portfolio.jsx - Enhanced with bot data
export default function Portfolio() {
  const navigate = useNavigate()
  const { holdings, stats, recentActivity, loading, error, refetch } = usePortfolio()
  const [botStatus, setBotStatus] = useState('idle')
  const [todayPNL, setTodayPNL] = useState(0)
  
  // Add bot status fetching
  useEffect(() => {
    const fetchBotData = async () => {
      const [statusRes, pnlRes] = await Promise.all([
        fetch('/api/bot/status'),
        fetch('/api/performance/today')
      ])
      setBotStatus((await statusRes.json()).status)
      setTodayPNL((await pnlRes.json()).pnl)
    }
    
    fetchBotData()
    const interval = setInterval(fetchBotData, 30000)
    return () => clearInterval(interval)
  }, [])
  
  // Add Bot Console section before holdings
  const BotConsoleSection = () => (
    <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Bot Console</h3>
        <button className="ghost pressable" onClick={() => navigate('/bot')} style={{ fontSize: '14px' }}>Full Console</button>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: botStatus === 'running' ? '#0a7a47' : '#666' }}>
            {botStatus === 'running' ? '🤖' : '⏸️'}
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '0.25rem' }}>Status</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: todayPNL >= 0 ? '#0a7a47' : '#c0392b' }}>
            ${todayPNL.toFixed(2)}
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '0.25rem' }}>Today P&L</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <button className="primary pressable" onClick={handleRunOnce} style={{ padding: '0.5rem 1rem', fontSize: '12px' }}>
            Run Once
          </button>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '0.25rem' }}>Manual Trade</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <button className="ghost pressable" onClick={handleStartBot} style={{ padding: '0.5rem 1rem', fontSize: '12px' }}>
            {botStatus === 'running' ? 'Stop' : 'Start'}
          </button>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '0.25rem' }}>Auto Bot</div>
        </div>
      </div>
    </article>
  )
  
  return (
    <div className="page container" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: '0' }}>
        <PortfolioHeader user={user} stats={stats} onRefresh={refetch} />
      </header>

      {/* Bot Console Section */}
      <BotConsoleSection />

      {/* Rest of existing Portfolio sections... */}
      <section style={{ marginBottom: '0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
          {/* Existing stat cards... */}
        </div>
      </section>

      {/* Existing holdings and activity sections... */}
    </div>
  )
}
```

### Enhanced Orders.jsx Integration

**Wire existing Orders.jsx to real Alpaca execution:**

```javascript
// app/src/features/Orders.jsx - Enhanced handleProceedToConfirmation
const handleProceedToConfirmation = async () => {
  // Calculate actual quantity based on notional or shares
  const quantity = orderQuantity ? parseFloat(orderQuantity) : Math.floor(parseFloat(orderAmount) / selectedStock.price)
  
  const orderData = {
    id: Date.now(),
    type: orderType,
    asset: selectedStock.symbol,
    assetName: selectedStock.name,
    quantity,
    amount: parseFloat(orderAmount) || (parseFloat(orderQuantity) * selectedStock.price),
    price: selectedStock.price,
    fillType,
    limitPrice: fillType === 'LIMIT' ? parseFloat(limitPrice) : null,
    stopPrice: fillType === 'STOP' ? parseFloat(stopPrice) : null,
    commission: orderDetails.commission,
    timestamp: new Date().toISOString()
  }
  
  // Submit to Alpaca via our API
  try {
    const response = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: selectedStock.symbol,
        side: orderType.toLowerCase(),
        quantity,
        orderType: fillType.toLowerCase(),
        limitPrice: fillType === 'LIMIT' ? parseFloat(limitPrice) : undefined,
        stopPrice: fillType === 'STOP' ? parseFloat(stopPrice) : undefined
      })
    })
    
    if (!response.ok) {
      throw new Error('Trade execution failed')
    }
    
    const { execution } = await response.json()
    orderData.alpacaOrderId = execution.alpaca_order_id
    orderData.executionId = execution.id
    
    dispatch({ type: 'SELECT_ORDER', payload: orderData.id })
    navigate('/orders/confirm', { state: { order: orderData } })
    
  } catch (error) {
    console.error('Trade execution error:', error)
    // Show error in UI
    alert(`Trade execution failed: ${error.message}`)
  }
}
```

### Create OrderConfirmation.jsx

```javascript
// app/src/features/OrderConfirmation.jsx
import { useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'

export default function OrderConfirmation() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const order = state?.order
  const [orderStatus, setOrderStatus] = useState('submitted')
  const [execution, setExecution] = useState(null)
  
  if (!order) {
    navigate('/orders')
    return null
  }
  
  useEffect(() => {
    // Poll for order status updates
    const checkStatus = async () => {
      try {
        const response = await fetch(`/api/execution/${order.executionId}`)
        const { execution: execData } = await response.json()
        setExecution(execData)
        setOrderStatus(execData.status)
        
        if (execData.status === 'filled' || execData.status === 'cancelled' || execData.status === 'failed') {
          // Stop polling when final
          return
        }
      } catch (error) {
        console.error('Status check failed:', error)
      }
    }
    
    const interval = setInterval(checkStatus, 2000)
    checkStatus() // Initial check
    
    return () => clearInterval(interval)
  }, [order.executionId])
  
  const handleViewPortfolio = () => {
    navigate('/portfolio')
  }
  
  const handleNewOrder = () => {
    navigate('/orders')
  }
  
  return (
    <div className="page container" style={{ maxWidth: 800, margin: '0 auto', padding: '2rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <div style={{ 
          width: '80px', 
          height: '80px', 
          borderRadius: '50%', 
          background: orderStatus === 'filled' ? '#e8f5e8' : 
                     orderStatus === 'cancelled' ? '#fff5f5' : 
                     '#f8f9fa',
          margin: '0 auto 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '32px'
        }}>
          {orderStatus === 'filled' ? '✓' : 
           orderStatus === 'cancelled' ? '✕' : 
           orderStatus === 'failed' ? '!' : '⏳'}
        </div>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '24px', fontWeight: 700 }}>
          {orderStatus === 'filled' ? 'Order Filled' :
           orderStatus === 'cancelled' ? 'Order Cancelled' :
           orderStatus === 'failed' ? 'Order Failed' :
           'Order Submitted'}
        </h1>
        <p className="muted">
          {order.asset} - {order.type} {order.quantity} shares @ ${order.price.toFixed(2)}
        </p>
      </div>
      
      <article style={{ background: 'white', borderRadius: 16, padding: '2rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
        <h2 style={{ margin: '0 0 1.5rem', fontSize: '18px', fontWeight: 600 }}>Order Details</h2>
        
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f0f0f0' }}>
            <span className="muted">Symbol</span>
            <span style={{ fontWeight: 600 }}>{order.asset}</span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f0f0f0' }}>
            <span className="muted">Side</span>
            <span style={{ fontWeight: 600, color: order.type === 'BUY' ? '#0a7a47' : '#c0392b' }}>
              {order.type}
            </span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f0f0f0' }}>
            <span className="muted">Quantity</span>
            <span style={{ fontWeight: 600 }}>{order.quantity} shares</span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f0f0f0' }}>
            <span className="muted">Price</span>
            <span style={{ fontWeight: 600 }}>${order.price.toFixed(2)}</span>
          </div>
          
          {execution?.fill_price && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f0f0f0' }}>
              <span className="muted">Fill Price</span>
              <span style={{ fontWeight: 600 }}>${execution.fill_price.toFixed(2)}</span>
            </div>
          )}
          
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f0f0f0' }}>
            <span className="muted">Total Value</span>
            <span style={{ fontWeight: 600 }}>${order.amount.toFixed(2)}</span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid #f0f0f0' }}>
            <span className="muted">Commission</span>
            <span style={{ fontWeight: 600 }}>${order.commission.toFixed(2)}</span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0' }}>
            <span className="muted">Order ID</span>
            <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '12px' }}>
              {order.alpacaOrderId || 'Pending...'}
            </span>
          </div>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '2rem' }}>
          <button className="ghost pressable" onClick={handleViewPortfolio} style={{ padding: '1rem' }}>
            View Portfolio
          </button>
          <button className="primary pressable" onClick={handleNewOrder} style={{ padding: '1rem' }}>
            Place New Order
          </button>
        </div>
      </article>
    </div>
  )
}
```

### Bot Console as Standalone Page

```javascript
// app/src/features/BotConsole.jsx - Full page version
export default function BotConsole() {
  const [isRunning, setIsRunning] = useState(false)
  const [currentSignal, setCurrentSignal] = useState(null)
  const [lastAction, setLastAction] = useState(null)
  const [botRuns, setBotRuns] = useState([])
  const [performance, setPerformance] = useState(null)
  
  const startBot = async () => {
    setIsRunning(true)
    try {
      const response = await fetch('/api/bot/start', { method: 'POST' })
      const { botRun } = await response.json()
      setLastAction(`Bot started: Run #${botRun.id}`)
      refreshData()
    } catch (error) {
      setLastAction(`Error: ${error.message}`)
    } finally {
      setIsRunning(false)
    }
  }
  
  const runOnce = async () => {
    setIsRunning(true)
    try {
      const response = await fetch('/api/bot/run-once', { method: 'POST' })
      const { execution, signal } = await response.json()
      setLastAction(`Manual execution: ${signal.symbol} ${signal.direction}`)
      refreshData()
    } catch (error) {
      setLastAction(`Error: ${error.message}`)
    } finally {
      setIsRunning(false)
    }
  }
  
  const stopBot = async () => {
    try {
      await fetch('/api/bot/stop', { method: 'POST' })
      setLastAction('Bot stopped')
      refreshData()
    } catch (error) {
      setLastAction(`Error: ${error.message}`)
    }
  }
  
  const refreshData = async () => {
    const [runsRes, perfRes, signalRes] = await Promise.all([
      fetch('/api/bot/runs'),
      fetch('/api/performance/stats'),
      fetch('/api/bot/current-signal')
    ])
    setBotRuns(await runsRes.json())
    setPerformance(await perfRes.json())
    setCurrentSignal(await signalRes.json())
  }
  
  useEffect(() => {
    refreshData()
    const interval = setInterval(refreshData, 10000)
    return () => clearInterval(interval)
  }, [])
  
  return (
    <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '28px', fontWeight: 700 }}>Bot Console</h1>
        <p className="muted">Automated trading with Alpha Engine signals</p>
      </header>
      
      {/* Performance Summary */}
      {performance && (
        <section style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div className="muted" style={{ fontSize: '12px', marginBottom: '0.5rem' }}>Total Trades</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>{performance.total_trades}</div>
            </div>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div className="muted" style={{ fontSize: '12px', marginBottom: '0.5rem' }}>Win Rate</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: performance.win_rate >= 50 ? '#0a7a47' : '#c0392b' }}>
                {performance.win_rate?.toFixed(1)}%
              </div>
            </div>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div className="muted" style={{ fontSize: '12px', marginBottom: '0.5rem' }}>Total P&L</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: performance.total_pnl >= 0 ? '#0a7a47' : '#c0392b' }}>
                ${performance.total_pnl?.toFixed(2)}
              </div>
            </div>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div className="muted" style={{ fontSize: '12px', marginBottom: '0.5rem' }}>Status</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: isRunning ? '#0a7a47' : '#666' }}>
                {isRunning ? 'Running' : 'Stopped'}
              </div>
            </div>
          </div>
        </section>
      )}
      
      {/* Bot Controls */}
      <section style={{ marginBottom: '2rem' }}>
        <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
          <h2 style={{ margin: '0 0 1.5rem', fontSize: '20px', fontWeight: 600 }}>Bot Controls</h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
            <button 
              onClick={startBot}
              disabled={isRunning}
              className="primary pressable"
              style={{ padding: '1rem', fontWeight: 600 }}
            >
              {isRunning ? 'Starting...' : 'Start Bot'}
            </button>
            <button 
              onClick={runOnce}
              disabled={isRunning}
              className="pressable"
              style={{ padding: '1rem', fontWeight: 600, backgroundColor: '#17a2b8', color: 'white' }}
            >
              {isRunning ? 'Running...' : 'Run Once'}
            </button>
            <button 
              onClick={stopBot}
              className="ghost pressable"
              style={{ padding: '1rem', fontWeight: 600, backgroundColor: '#dc3545', color: 'white' }}
            >
              Stop Bot
            </button>
          </div>
          
          {currentSignal && (
            <div style={{ background: '#f8f9fa', padding: '1rem', borderRadius: '8px' }}>
              <h4 style={{ margin: '0 0 0.5rem' }}>Current Signal</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', fontSize: '14px' }}>
                <div>
                  <div className="muted">Symbol</div>
                  <div style={{ fontWeight: 600 }}>{currentSignal.symbol}</div>
                </div>
                <div>
                  <div className="muted">Direction</div>
                  <div style={{ fontWeight: 600, color: currentSignal.direction === 'buy' ? '#0a7a47' : '#c0392b' }}>
                    {currentSignal.direction}
                  </div>
                </div>
                <div>
                  <div className="muted">Confidence</div>
                  <div style={{ fontWeight: 600 }}>{currentSignal.confidence}%</div>
                </div>
                <div>
                  <div className="muted">Score</div>
                  <div style={{ fontWeight: 600 }}>{currentSignal.score?.toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}
          
          {lastAction && (
            <div style={{ background: '#e7f5ff', padding: '1rem', borderRadius: '8px', marginTop: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem' }}>Last Action</h4>
              <p style={{ margin: 0 }}>{lastAction}</p>
            </div>
          )}
        </article>
      </section>
      
      {/* Bot Runs History */}
      <section>
        <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
          <h2 style={{ margin: '0 0 1.5rem', fontSize: '20px', fontWeight: 600 }}>Recent Bot Runs</h2>
          
          {botRuns.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
              <div style={{ fontSize: '48px', marginBottom: '1rem' }}>🤖</div>
              <p>No bot runs yet. Start the bot to begin automated trading.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {botRuns.slice(0, 20).map(run => (
                <div key={run.id} style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  padding: '1rem',
                  background: '#f8f9fa',
                  borderRadius: '8px',
                  border: '1px solid #e9ecef'
                }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Run #{run.id}</div>
                    <div className="muted" style={{ fontSize: '12px' }}>
                      {new Date(run.started_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ 
                      fontWeight: 600, 
                      color: run.status === 'completed' ? '#0a7a47' : 
                             run.status === 'failed' ? '#c0392b' : '#17a2b8'
                    }}>
                      {run.status}
                    </div>
                    <div className="muted" style={{ fontSize: '12px' }}>
                      {run.execution_count} trades | P&L: ${run.total_pnl?.toFixed(2) || '0'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  )
}
```

### 4. Performance
```javascript
// app/src/features/Performance.jsx
export default function Performance() {
  const [stats, setStats] = useState(null)
  const [recentTrades, setRecentTrades] = useState([])
  const [dailySnapshots, setDailySnapshots] = useState([])
  
  useEffect(() => {
    refreshData()
  }, [])
  
  const refreshData = async () => {
    const [statsRes, tradesRes, snapshotsRes] = await Promise.all([
      fetch('/api/performance/stats'),
      fetch('/api/executions/recent'),
      fetch('/api/performance/daily')
    ])
    
    setStats(await statsRes.json())
    setRecentTrades(await tradesRes.json())
    setDailySnapshots(await snapshotsRes.json())
  }
  
  return (
    <div style={{ padding: '2rem' }}>
      <h2>Performance</h2>
      
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
            <h4>Total Trades</h4>
            <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{stats.total_trades}</p>
          </div>
          <div style={{ padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
            <h4>Win Rate</h4>
            <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{stats.win_rate?.toFixed(1)}%</p>
          </div>
          <div style={{ padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
            <h4>Realized P&L</h4>
            <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: stats.realized_pnl >= 0 ? '#1f8a4c' : '#dc3545' }}>
              ${stats.realized_pnl?.toFixed(2)}
            </p>
          </div>
          <div style={{ padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
            <h4>Open P&L</h4>
            <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: stats.open_pnl >= 0 ? '#1f8a4c' : '#dc3545' }}>
              ${stats.open_pnl?.toFixed(2)}
            </p>
          </div>
        </div>
      )}
      
      <div style={{ marginBottom: '2rem' }}>
        <h3>Recent Trades</h3>
        {recentTrades.map(trade => (
          <div key={trade.id} style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
            <span>{trade.symbol} {trade.side} {trade.quantity}@{trade.fill_price}</span>
            <span style={{ float: 'right', color: trade.pnl >= 0 ? '#1f8a4c' : '#dc3545' }}>
              P&L: ${trade.pnl?.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      
      <div>
        <h3>Daily Performance</h3>
        {dailySnapshots.map(snapshot => (
          <div key={snapshot.id} style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
            <span>{snapshot.snapshot_date}</span>
            <span style={{ float: 'right', color: snapshot.day_pnl >= 0 ? '#1f8a4c' : '#dc3545' }}>
              P&L: ${snapshot.day_pnl?.toFixed(2)} | {snapshot.total_trades} trades
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

## 5-Day Implementation Plan (Updated for UI Integration)

### Day 1: Manual Paper Trade via Orders.jsx
- Set up MySQL tables for executions
- Create `/api/trade` endpoint
- **Enhance Orders.jsx** to call real Alpaca API
- **Create OrderConfirmation.jsx** screen
- Test: Manual paper trade executes through existing UI flow

### Day 2: Bot Console Integration
- Integrate Alpha Engine signals
- Create `/api/bot/run-once` endpoint
- **Add Bot Console section to Portfolio.jsx**
- **Create standalone BotConsole.jsx** page
- Test: Bot executes Alpha Engine signal

### Day 3: Persistent Tracking
- Store all executions in MySQL
- Add P&L calculations
- **Enhance Portfolio.jsx** with performance widgets
- **Update HoldingsTable** with real Alpaca positions
- Test: Trade history and metrics visible

### Day 4: Real-time Dashboard Updates
- Create `/api/account` and `/api/positions` endpoints
- **Enhance PortfolioHeader** with real account data
- **Update ActivityFeed** with real executions
- Test: Account status and positions visible

### Day 5: Bot Automation & Performance
- Add daily snapshot generation
- **Create Performance.jsx** standalone page
- **Add bot scheduling controls**
- Test: Run daily and observe results

## UI Integration Success Metrics

**By end of week:**
- ✅ **Orders.jsx** places real paper trades
- ✅ **OrderConfirmation.jsx** shows live order status
- ✅ **Portfolio.jsx** displays bot controls and performance
- ✅ **BotConsole.jsx** provides full bot management
- ✅ All executions stored in MySQL with real P&L

## Success Metrics

**By end of week:**
- ✅ Manual paper trade button works
- ✅ Bot executes Alpha Engine signal automatically
- ✅ All executions stored in MySQL
- ✅ Dashboard shows P&L and win rate
- ✅ Can run daily and review results each morning

## What Success Looks Like

You wake up and see:
```
Bot placed 3 paper trades yesterday
+1.8% simulated return
2 wins / 1 loss
Current positions: SPY (+$45), AAPL (-$12)
```

That's real progress.

## Environment Setup

```bash
# .env (server side)
DATABASE_URL=mysql://user:password@localhost:3306/trading_platform
ALPACA_PAPER_API_KEY=your-paper-key
ALPACA_PAPER_API_SECRET=your-paper-secret
ALPHA_ENGINE_URL=http://127.0.0.1:8090
BROKER_ENCRYPTION_KEY=your-32-byte-encryption-key

# .env (frontend)
VITE_API_URL=http://localhost:3001
```

## Backend Architecture

**Keep current stack:**
- Frontend app → Fastify API → MySQL → Alpaca Paper
- Alpha Engine bridge at `:8090`
- No auth complexity (single operator mode)

## What to Postpone

- Supabase migration discussions
- Multi-user architecture
- Stripe billing integration
- Complex authentication systems
- Enterprise security features

**These are Phase 2 problems.**

## Strategic Focus

**You are discovering:**
- What dashboards matter
- What controls matter
- What metrics matter
- Whether signals are useful
- What feels trustworthy

**Build the machine first. Then wrap users around it.**

## Honest Founder Truth

Many builders waste months making a multi-tenant shell around an unproven core.

**Do the opposite:**
1. Prove the trading bot works profitably
2. Prove the signals add value
3. Prove the UI is usable daily
4. Then productize it

Your highest-leverage product right now is not a SaaS platform.

**It's a personal profitable operator console.**

Build that first. Then scale.
