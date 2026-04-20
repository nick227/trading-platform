import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function BotConsole() {
  const navigate = useNavigate()
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
      const body = await response.json()
      if (!response.ok) {
        setLastAction(`No trade: ${body.error}`)
        return
      }
      const { execution } = body
      setLastAction(`Queued: ${execution.ticker} ${execution.direction} × ${execution.quantity}`)
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
    try {
      const [runsRes, perfRes, signalRes] = await Promise.all([
        fetch('/api/bot/runs'),
        fetch('/api/performance/stats'),
        fetch('/api/bot/current-signal')
      ])
      setBotRuns(await runsRes.json())
      setPerformance(await perfRes.json())
      const signalBody = await signalRes.json()
      setCurrentSignal(signalBody.signal ?? null)  // unwrap { signal: {...} }
    } catch (error) {
      console.error('Failed to refresh bot data:', error)
    }
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
              <p>No bot runs yet. Start bot to begin automated trading.</p>
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
                      {new Date(run.startedAt).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontWeight: 600,
                      color: run.status === 'completed' ? '#0a7a47' :
                             run.status === 'failed'    ? '#c0392b' : '#17a2b8'
                    }}>
                      {run.status}
                    </div>
                    <div className="muted" style={{ fontSize: '12px' }}>
                      {run.executionCount} trades | P&L: ${Number(run.totalPnl ?? 0).toFixed(2)}
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
