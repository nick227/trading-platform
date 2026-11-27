import { useCallback, useEffect, useState } from 'react'
import { get, post } from '../../api/client'
import Disclosure from '../../ui/Disclosure'
import { money, ratioPct } from '../../ui/format'

const STATUS_LABELS = {
  pending_approval: 'Awaiting approval',
  pending_veto: '1-session review window',
  approved: 'Approved · Paper order queued',
  auto_queued_paper: 'Auto-queued (un-vetoed paper)',
  cancelled: 'Cancelled / Vetoed',
  expired: 'Expired',
  executed: 'Executed (paper fill)'
}

export default function CopilotProposalsInbox({ onResolved = null }) {
  const [state, setState] = useState({ status: 'loading', actionable: [], recentResolved: [] })
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState(null)

  const load = useCallback(() => {
    get('/ai/copilot-proposals')
      .then((res) => {
        const payload = res?.data ?? res
        if (!payload || !Array.isArray(payload.actionable)) {
          setState({ status: 'unavailable', actionable: [], recentResolved: [] })
          return
        }
        setState({
          status: 'ready',
          actionable: payload.actionable,
          recentResolved: Array.isArray(payload.recentResolved) ? payload.recentResolved : []
        })
      })
      .catch(() => {
        setState({ status: 'unavailable', actionable: [], recentResolved: [] })
      })
  }, [])

  useEffect(() => { load() }, [load])

  if (state.status !== 'ready') return null
  if (state.actionable.length === 0 && state.recentResolved.length === 0) return null

  const handleDecision = async (proposalId, decision) => {
    setBusyId(proposalId)
    setActionError(null)
    try {
      await post(`/ai/copilot-proposals/${encodeURIComponent(proposalId)}/${decision}`, {})
      load()
      onResolved?.()
    } catch (err) {
      setActionError(err?.message || `Could not ${decision} proposal.`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section
      className="tl-section"
      aria-labelledby="copilot-inbox-heading"
      data-testid="copilot-proposals-inbox"
    >
      <div className="tl-section-head">
        <div>
          <h2 id="copilot-inbox-heading" className="tl-section-title">
            Needs your attention
            {state.actionable.length > 0 && <span className="tl-count">{state.actionable.length}</span>}
          </h2>
          <p className="tl-section-note">
            Simulated paper trade proposals from your Personal AI Trader. Deadlines follow official NYSE exchange sessions (never arbitrary 24-hour timers), and silence never authorizes real-money trades.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="tl-notice tl-notice--error" role="alert" style={{ marginBottom: '0.75rem' }}>
          {actionError}
        </div>
      )}

      {state.actionable.length > 0 ? (
        <div className="tl-ai-feed" data-testid="copilot-actionable-list">
          {state.actionable.map((prop) => (
            <article
              key={prop.id}
              className="tl-card tl-card-shell tl-card-shell--compact"
              data-testid={`copilot-proposal-${prop.id}`}
            >
              <div className="tl-section-head">
                <div>
                  <h3 style={{ margin: 0 }}>
                    <span className={prop.action === 'BUY' ? 'tl-pos' : 'tl-neg'}>{prop.action}</span>{' '}
                    {prop.quantity} {prop.symbol} · est. {money(prop.estimatedNotional)}
                  </h3>
                  <p className="tl-small tl-muted" style={{ margin: '0.2rem 0 0' }} data-testid={`copilot-deadline-${prop.id}`}>
                    <strong>NYSE deadline:</strong> {prop.deadlineLabel}
                    {prop.confidence != null && ` · Conviction ${ratioPct(prop.confidence, 0)}`}
                  </p>
                </div>
                <span className="tl-tag" data-testid={`copilot-status-${prop.id}`}>
                  {STATUS_LABELS[prop.status] || prop.status}
                </span>
              </div>

              <p className="tl-small" style={{ margin: '0.6rem 0' }}>{prop.thesis}</p>

              {(Array.isArray(prop.evidence) && prop.evidence.length > 0 || Array.isArray(prop.risks) && prop.risks.length > 0) && (
                <Disclosure label="Inspect supporting evidence & risk checks">
                  {Array.isArray(prop.evidence) && prop.evidence.length > 0 && (
                    <ul className="tl-backtest-notes">
                      {prop.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
                    </ul>
                  )}
                  {Array.isArray(prop.risks) && prop.risks.length > 0 && (
                    <p className="tl-small tl-muted" style={{ margin: '0.4rem 0 0' }}>
                      <strong>Risks watched:</strong> {prop.risks.join(' · ')}
                    </p>
                  )}
                </Disclosure>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="tl-btn tl-btn--primary tl-btn--sm"
                  disabled={busyId === prop.id}
                  onClick={() => handleDecision(prop.id, 'approve')}
                  data-testid={`copilot-approve-${prop.id}`}
                >
                  {busyId === prop.id ? 'Saving…' : 'Approve paper order'}
                </button>
                <button
                  type="button"
                  className="tl-btn tl-btn--sm"
                  disabled={busyId === prop.id}
                  onClick={() => handleDecision(prop.id, 'cancel')}
                  data-testid={`copilot-cancel-${prop.id}`}
                >
                  Cancel / Veto
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="tl-small tl-muted" data-testid="copilot-no-actionable">
          No pending trade proposals require your review right now.
        </p>
      )}

      {state.recentResolved.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <Disclosure label={`Inspect proposal audit history (${state.recentResolved.length})`}>
            <ul className="tl-backtest-notes" data-testid="copilot-resolved-list">
              {state.recentResolved.map((row) => (
                <li key={row.id} data-testid={`copilot-resolved-${row.id}`}>
                  <strong>{row.action} {row.quantity} {row.symbol}</strong> ({money(row.estimatedNotional)}) —{' '}
                  <span>{STATUS_LABELS[row.status] || row.status}</span>
                  {row.deadlineLabel ? ` · Deadline was ${row.deadlineLabel}` : ''}
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      )}
    </section>
  )
}
