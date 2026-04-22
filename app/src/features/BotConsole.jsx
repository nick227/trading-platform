import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const statusBadge = (status) => {
  if (status === 'completed') return 'badge badge-positive badge-xs'
  if (status === 'failed') return 'badge badge-negative badge-xs'
  return 'badge badge-soft badge-xs'
}

const actionAlert = (text) => {
  if (!text) return ''
  if (text.startsWith('Error')) return 'alert alert-error'
  if (text.startsWith('No trade')) return 'alert alert-warn'
  return 'alert alert-success'
}

export default function BotConsole() {
  const navigate = useNavigate()
  const [isRunning, setIsRunning] = useState(false)
  const [currentSignal, setCurrentSignal] = useState(null)
  const [lastAction, setLastAction] = useState(null)
  const [botRuns, setBotRuns] = useState([])
  const [performance, setPerformance] = useState(null)

  const refreshData = async () => {
    try {
      const [runsRes, perfRes, signalRes] = await Promise.all([
        fetch('/api/bot/runs'),
        fetch('/api/performance/stats'),
        fetch('/api/bot/current-signal'),
      ])
      setBotRuns(await runsRes.json())
      setPerformance(await perfRes.json())
      const signalBody = await signalRes.json()
      setCurrentSignal(signalBody.signal ?? null)
    } catch (error) {
      console.error('Failed to refresh bot data:', error)
    }
  }

  useEffect(() => {
    refreshData()
    const interval = setInterval(refreshData, 10000)
    return () => clearInterval(interval)
  }, [])

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
      setLastAction(`Queued: ${execution.ticker} ${execution.direction} x ${execution.quantity}`)
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

  const summary = useMemo(() => {
    if (!performance) return null

    const winTone = performance.win_rate >= 50 ? 'text-positive' : 'text-negative'
    const pnlTone = performance.total_pnl >= 0 ? 'text-positive' : 'text-negative'
    const runBadge = isRunning ? 'badge badge-positive badge-xs' : 'badge badge-neutral badge-xs'

    return {
      winTone,
      pnlTone,
      runBadge,
    }
  }, [performance, isRunning])

  return (
    <div className="l-page">
      <div className="container l-stack-lg">
        <header className="stack-sm">
          <button className="btn btn-xs btn-ghost" type="button" onClick={() => navigate('/bots')}>
            ← Back to Bots
          </button>
          <h1 className="hero m-0">Bot Console</h1>
          <p className="muted text-md m-0">Automated trading with Alpha Engine signals</p>
        </header>

        {summary && (
          <section className="kpi-grid-4">
            <article className="card card-pad-md">
              <div className="kpi">
                <div className="kpi-label">Total Trades</div>
                <div className="kpi-value">{performance.total_trades}</div>
              </div>
            </article>

            <article className="card card-pad-md">
              <div className="kpi">
                <div className="kpi-label">Win Rate</div>
                <div className={`kpi-value ${summary.winTone}`}>{performance.win_rate?.toFixed(1)}%</div>
              </div>
            </article>

            <article className="card card-pad-md">
              <div className="kpi">
                <div className="kpi-label">Total P&amp;L</div>
                <div className={`kpi-value ${summary.pnlTone}`}>${performance.total_pnl?.toFixed(2)}</div>
              </div>
            </article>

            <article className="card card-pad-md">
              <div className="kpi">
                <div className="kpi-label">Status</div>
                <div className="kpi-value">
                  <span className={summary.runBadge}>{isRunning ? 'Running' : 'Stopped'}</span>
                </div>
              </div>
            </article>
          </section>
        )}

        <section className="card card-pad-md">
          <div className="panel-header">
            <h2 className="panel-title">Bot Controls</h2>
          </div>

          <div className="stack-lg">
            <div className="l-grid-3">
              <button className="btn btn-sm btn-primary" type="button" onClick={startBot} disabled={isRunning}>
                {isRunning ? 'Starting…' : 'Start Bot'}
              </button>
              <button className="btn btn-sm btn-ghost" type="button" onClick={runOnce} disabled={isRunning}>
                {isRunning ? 'Running…' : 'Run Once'}
              </button>
              <button className="btn btn-sm btn-ghost text-negative" type="button" onClick={stopBot}>
                Stop Bot
              </button>
            </div>

            {currentSignal && (
              <div className="subcard">
                <div className="panel-header">
                  <h3 className="panel-title">Current Signal</h3>
                  <span className={currentSignal.direction === 'buy' ? 'badge badge-positive badge-xs' : 'badge badge-negative badge-xs'}>
                    {currentSignal.direction}
                  </span>
                </div>

                <div className="kpi-grid-4">
                  <div className="kpi">
                    <div className="kpi-label">Symbol</div>
                    <div className="kpi-value">{currentSignal.symbol}</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Confidence</div>
                    <div className="kpi-value">{currentSignal.confidence}%</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Score</div>
                    <div className="kpi-value">{currentSignal.score?.toFixed(2)}</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi-label">Updated</div>
                    <div className="kpi-value">{new Date().toLocaleTimeString()}</div>
                  </div>
                </div>
              </div>
            )}

            {lastAction && (
              <div className={actionAlert(lastAction)}>
                <div className="alert-title">Last Action</div>
                <div className="text-sm">{lastAction}</div>
              </div>
            )}
          </div>
        </section>

        <section className="card card-pad-md">
          <div className="panel-header">
            <h2 className="panel-title">Recent Bot Runs</h2>
          </div>

          {botRuns.length === 0 ? (
            <div className="panel-empty">
              <div className="text-xl mb-2">🤖</div>
              <div className="text-sm">No bot runs yet. Start the bot to begin automated trading.</div>
            </div>
          ) : (
            <div className="stack-sm">
              {botRuns.slice(0, 20).map((run) => (
                <div key={run.id} className="subcard subcard-sm">
                  <div className="l-row">
                    <div className="stack-sm">
                      <div className="hstack">
                        <div className="text-sm font-600">Run #{run.id}</div>
                        <span className={statusBadge(run.status)}>{run.status}</span>
                      </div>
                      <div className="text-xs muted">{new Date(run.startedAt).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-600">
                        {run.executionCount} trades · P&amp;L: ${Number(run.totalPnl ?? 0).toFixed(2)}
                      </div>
                      <div className="text-xs muted">Run details coming soon</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

