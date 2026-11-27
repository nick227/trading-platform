import { useEffect, useState } from 'react'
import { listPaperStrategyBacktests, runPaperStrategyBacktest } from './researchPartnerApi'

const describeError = error => error?.serverMessage || error?.message || 'Historical replay failed'

export default function PaperStrategyBacktestPanel({ partnerId, strategy, onRunsChange }) {
  const [startSession, setStartSession] = useState('')
  const [endSession, setEndSession] = useState('')
  const [runs, setRuns] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let alive = true
    listPaperStrategyBacktests(partnerId, strategy.id)
      .then(rows => { if (alive) setRuns(rows) })
      .catch(err => { if (alive) setError(describeError(err)) })
    return () => { alive = false }
  }, [partnerId, strategy.id])
  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await runPaperStrategyBacktest(partnerId, strategy.id, {
        expectedVersion: strategy.currentVersion, startSession, endSession
      })
      const updated = await listPaperStrategyBacktests(partnerId, strategy.id)
      setRuns(updated)
      onRunsChange?.(updated)
      setNotice('Historical replay saved. No orders were placed.')
    } catch (err) { setError(describeError(err)) }
    finally { setBusy(false) }
  }
  return <section className="rp-backtest-panel" aria-label={'Backtest ' + strategy.name}>
    <h4>Historical paper replay</h4>
    <p className="tl-section-note">Completed-session signals; simulated fills at the next exchange-session open.</p>
    {error && <p role="alert" className="tl-notice tl-notice--error">{error}</p>}
    {notice && <p role="status" className="tl-section-note">{notice}</p>}
    <form className="rp-form" onSubmit={submit}>
      <label htmlFor={'rp-backtest-start-' + strategy.id}>Start date</label>
      <input id={'rp-backtest-start-' + strategy.id} type="date" required
        value={startSession} onChange={e => setStartSession(e.target.value)} />
      <label htmlFor={'rp-backtest-end-' + strategy.id}>End date</label>
      <input id={'rp-backtest-end-' + strategy.id} type="date" required
        value={endSession} onChange={e => setEndSession(e.target.value)} />
      <button className="tl-btn tl-btn--primary" type="submit" disabled={busy}>
        {busy ? 'Evaluating…' : 'Run historical replay'}
      </button>
    </form>
    {runs.map(run => <article key={run.id} className="rp-backtest-result">
      <p><strong>{run.startSession} – {run.endSession}</strong> · Strategy v{run.version}</p>
      <div className="rp-backtest-metrics">
        <span>Return <strong>{run.result.returnPct}%</strong></span>
        <span>Max drawdown <strong>{run.result.maxDrawdownPct}%</strong></span>
        <span>Simulated fills <strong>{run.result.fillCount}</strong></span>
        <span>Ending equity <strong>{Number(run.result.endingEquity).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</strong></span>
      </div>
      <p className="tl-small tl-muted">Historical simulation · Zero slippage and fees assumed · No brokerage orders · Not predictive of future performance</p>
    </article>)}
  </section>
}
