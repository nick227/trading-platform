import { useEffect, useState } from 'react'
import PaperStrategyBacktestPanel from './PaperStrategyBacktestPanel'
import PaperForwardPanel from './PaperForwardPanel'
import { getPaperForwardAccount, listPaperStrategyBacktests } from './researchPartnerApi'

const describeError = error => error?.serverMessage || error?.message || 'The strategy review could not be loaded'
const isMissing = error => [error?.status, error?.statusCode, error?.response?.status].includes(404)

/**
 * A guided journey over existing, owner-scoped services. Historical replay is
 * evidence, never authorization; paper activation has its own explicit consent.
 */
export default function PaperStrategyTestingJourney({ partnerId, strategy, onClose }) {
  const [stage, setStage] = useState('historical')
  const [runs, setRuns] = useState([])
  const [activation, setActivation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [retryKey, setRetryKey] = useState(0)
  const [error, setError] = useState('')
  const [acknowledgedGap, setAcknowledgedGap] = useState(false)

  useEffect(() => {
    let live = true
    setStage('historical')
    setRuns([])
    setActivation(null)
    setError('')
    setAcknowledgedGap(false)
    setLoading(true)
    Promise.all([
      listPaperStrategyBacktests(partnerId, strategy.id),
      getPaperForwardAccount(partnerId, strategy.id).catch(error => {
        if (isMissing(error)) return null
        throw error
      })
    ]).then(([backtests, account]) => {
      if (!live) return
      const versionRuns = backtests.filter(run => run.version === strategy.currentVersion)
      setRuns(versionRuns)
      setActivation(account)
      setStage(account ? 'paper' : versionRuns.length ? 'review' : 'historical')
    }).catch(err => { if (live) setError(describeError(err)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [partnerId, strategy.id, strategy.currentVersion, retryKey])

  const latest = runs[0]
  const hasResults = Boolean(latest)
  const canAdvance = !error && (hasResults || acknowledgedGap)
  return <section className="rp-testing-journey" aria-label={'Testing and paper simulation for ' + strategy.name}>
    <header className="rp-testing-header">
      <div>
        <h4>Test and activate · {strategy.name}</h4>
        <p className="tl-section-note">Approved strategy version {strategy.currentVersion}. No live orders or brokerage connections.</p>
      </div>
      <button type="button" className="tl-btn tl-btn--secondary" onClick={onClose}>Close</button>
    </header>
    <ol className="rp-testing-progress" aria-label="Testing progress">
      {[
        ['historical','Historical test'],
        ['review','Results review'],
        ['paper','Paper simulation']
      ].map(([id,label],i)=><li key={id} aria-current={stage===id?'step':undefined}
        className={stage===id?'is-current':''}>{i+1}. {label}</li>)}
    </ol>
    {error && <div role="alert" className="tl-notice tl-notice--error">
      <p>{error}. Historical evidence status is unknown until the request succeeds.</p>
      <button type="button" className="tl-btn tl-btn--secondary" onClick={()=>setRetryKey(key=>key+1)}>Retry loading tests</button>
    </div>}
    {loading ? <p role="status">Loading strategy testing history…</p> : error ? null : <>
      {stage==='historical' && <>
        <h5>Test your rules against historical data</h5>
        <p className="tl-section-note">This is a historical simulation using available completed market sessions, not a prediction or live trading result.</p>
        <PaperStrategyBacktestPanel partnerId={partnerId} strategy={strategy}
          onRunsChange={rows => { setRuns(rows.filter(run => run.version===strategy.currentVersion)); setStage('review') }} />
        <button type="button" className="tl-btn tl-btn--secondary"
          onClick={()=>setStage('review')}>Review testing evidence</button>
      </>}
      {stage==='review' && <>
        <h5>Review the evidence before paper activation</h5>
        {hasResults ? <div className="rp-testing-summary" aria-label="Latest historical test summary">
          <p><strong>Period:</strong> {latest.startSession} – {latest.endSession}</p>
          <p><strong>Historical return:</strong> {Number.isFinite(latest.result?.returnPct) ? latest.result.returnPct+'%' : 'Unavailable'}</p>
          <p><strong>Maximum drawdown:</strong> {Number.isFinite(latest.result?.maxDrawdownPct) ? latest.result.maxDrawdownPct+'%' : 'Unavailable'}</p>
          <p><strong>Simulated fills:</strong> {latest.result?.fillCount ?? 'Unavailable'}</p>
          <p className="tl-section-note">This replay assumes zero fees and slippage. Results do not establish future performance or automated trading readiness.</p>
        </div> : <div className="rp-testing-gap">
          <strong>No historical test is saved for this approved version.</strong>
          <p>Without historical evidence, drawdown, trading frequency and performance for this strategy are unknown.</p>
          <label className="rp-testing-acknowledgment">
            <input type="checkbox" checked={acknowledgedGap} onChange={event=>setAcknowledgedGap(event.target.checked)} />
            I understand that I am continuing without historical testing evidence.
          </label>
        </div>}
        <div className="rp-testing-actions">
          <button type="button" className="tl-btn tl-btn--secondary"
            onClick={()=>setStage('historical')}>Run or review historical tests</button>
          <button type="button" className="tl-btn tl-btn--primary"
            disabled={!canAdvance} onClick={()=>setStage('paper')}>Continue to paper simulation</button>
        </div>
      </>}
      {stage==='paper' && <>
        <h5>Manually simulate future completed sessions</h5>
        <p className="tl-section-note">Paper activation is separate from definition approval and historical testing. Activation creates a simulated account only; each completed session must still be processed manually.</p>
        {activation && activation.version !== strategy.currentVersion && <p className="tl-section-note" role="status">This paper account is pinned to strategy version {activation.version}, not the current approved version {strategy.currentVersion}.</p>}
        <PaperForwardPanel partnerId={partnerId} strategy={strategy} />
        <button type="button" className="tl-btn tl-btn--secondary" onClick={()=>setStage('review')}>
          Review historical evidence
        </button>
      </>}
    </>}
  </section>
}
