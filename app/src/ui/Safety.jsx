import { useCallback, useEffect, useState } from 'react'
import { del, get, post } from '../api/client'
import Sheet from '../components/Sheet'
import { dateTime } from './format'

/**
 * Emergency stop (user-scoped, server-enforced): disables every bot, requests cancellation of
 * every open order, and makes the order worker refuse new orders until cleared. Clearing does
 * not resume bots. Separate from "Pause all", which only pauses bots.
 */
export function useEmergencyStop() {
  const [stop, setStop] = useState({ loading: true, active: false })
  const refresh = useCallback(async () => {
    try {
      const d = await get('/risk/kill-switch')
      setStop({ loading: false, ...d })
    } catch {
      setStop({ loading: false, active: false, unavailable: true })
    }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  const activate = async (reason) => {
    const r = await post('/risk/kill-switch', { reason })
    await refresh()
    return r
  }
  const clear = async () => {
    await del('/risk/kill-switch')
    await refresh()
  }
  return { stop, refresh, activate, clear }
}

export function EmergencyBanner({ stop, onClear }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  if (!stop?.active) return null
  return (
    <div className="tl-notice tl-notice--error tl-stop-banner" role="alert" data-testid="emergency-banner">
      <span>
        <strong>Emergency stop is on</strong>{stop.activatedAt ? ` since ${dateTime(stop.activatedAt)}` : ''}. All bots are paused and new orders are refused.
        {stop.reason ? <span className="tl-muted"> Reason: {stop.reason}</span> : null}
        {error && <span> {error}</span>}
      </span>
      <button type="button" className="tl-btn tl-btn--sm" disabled={busy} onClick={async () => {
        setBusy(true); setError(null)
        try { await onClear() } catch { setError('Couldn’t clear it — try again.') } finally { setBusy(false) }
      }}>{busy ? 'Clearing…' : 'Clear stop'}</button>
    </div>
  )
}

function StopSheet({ onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const confirm = async () => {
    setBusy(true); setError(null)
    try {
      await onConfirm(reason.trim() || 'Stopped from Home')
      onClose()
    } catch {
      setError('The emergency stop couldn’t be turned on. Try again, or pause bots individually.')
      setBusy(false)
    }
  }
  return (
    <Sheet title="Stop everything?" onClose={onClose} footer={
      <>
        <button type="button" className="tl-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="tl-btn tl-btn--danger-solid" onClick={confirm} disabled={busy}>{busy ? 'Stopping…' : 'Stop everything'}</button>
      </>
    }>
      <ul className="tl-stop-list">
        <li>Every bot is paused.</li>
        <li>Cancellation is requested for every open order.</li>
        <li>New orders are refused until you clear the stop.</li>
        <li>Clearing it doesn’t restart anything — you resume bots yourself.</li>
      </ul>
      <label className="tl-label" htmlFor="stop-reason" style={{ display: 'block', margin: '14px 0 6px' }}>Reason <span className="tl-muted">(kept in the audit log)</span></label>
      <input id="stop-reason" className="tl-input" style={{ maxWidth: 'none' }} placeholder="e.g. Reviewing a bot’s behaviour" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </Sheet>
  )
}

/** Home's safety line: risk summary + the emergency stop control. */
export function SafetyBar({ stop, onActivate, risk }) {
  const [open, setOpen] = useState(false)
  if (stop?.loading) return null
  return (
    <div className="tl-safety" data-testid="safety-bar">
      <span className="tl-safety-text">
        {risk ? (
          <>Risk check: <strong className={risk.tone}>{risk.label}</strong>{risk.detail ? <span className="tl-muted"> · {risk.detail}</span> : null}</>
        ) : (
          <span className="tl-muted">Every order passes the risk policy before it’s placed.</span>
        )}
      </span>
      {!stop?.active && !stop?.unavailable && (
        <button type="button" className="tl-btn tl-btn--sm tl-btn--danger" onClick={() => setOpen(true)}>Emergency stop</button>
      )}
      {open && <StopSheet onClose={() => setOpen(false)} onConfirm={onActivate} />}
    </div>
  )
}

/** Compact risk summary from the risk dashboard (same valuation as Home). */
export async function loadRiskSummary() {
  try {
    const pf = await get('/portfolios/default')
    if (!pf?.id) return null
    const d = await get('/risk/dashboard', { portfolioId: pf.id })
    const top = d?.scores?.exposure?.topRisks?.[0]
    const label = d?.overallLabel ?? null
    if (!label) return null
    return {
      label: label === 'good' ? 'healthy' : label,
      tone: label === 'good' ? 'tl-pos' : label === 'moderate' ? '' : 'tl-neg',
      detail: top ? `largest holding ${top.ticker} is ${top.concentration} of invested value` : null,
    }
  } catch {
    return null
  }
}
