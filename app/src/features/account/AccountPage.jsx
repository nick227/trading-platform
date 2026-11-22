import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { get } from '../../api/client'
import { useAuth } from '../../app/AuthProvider'
import { getTradingMode, isSimulated } from '../../components/ModeBadge'
import BrokerTab from '../profile/BrokerTab'
import { money, sessionDate } from '../../ui/format'

/** Account: who you are, how to sign out, and what kind of trading account you're using. */
export default function AccountPage() {
  const { user, logout, brokerStatus, brokerStatusLoading, brokerStatusError } = useAuth()
  const navigate = useNavigate()
  const mode = getTradingMode(brokerStatus, { loading: brokerStatusLoading, error: brokerStatusError })
  const simulated = isSimulated(brokerStatus)
  const [valuation, setValuation] = useState(null)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (!simulated) return
    get('/account/valuation').then(setValuation).catch(() => setValuation(false))
  }, [simulated])

  const signOut = async () => {
    setSigningOut(true)
    await logout()
    navigate('/auth', { replace: true })
  }

  return (
    <main className="tl-page" style={{ maxWidth: 'calc(680px + 2 * var(--tl-gutter))' }}>
      <header className="tl-header">
        <div>
          <h1 className="tl-title">Account</h1>
        </div>
      </header>

      <section className="tl-section" aria-labelledby="profile-title">
        <div className="tl-section-head"><h2 className="tl-section-title" id="profile-title">Profile</h2></div>
        <dl className="tl-facts tl-facts--left" style={{ marginTop: 16 }}>
          <dt>Name</dt><dd>{user?.fullName || user?.name || '—'}</dd>
          <dt>Email</dt><dd>{user?.email || '—'}</dd>
        </dl>
        <div className="tl-detail-actions">
          <button type="button" className="tl-btn" onClick={signOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
        </div>
      </section>

      <section className="tl-section" aria-labelledby="trading-title">
        <div className="tl-section-head"><h2 className="tl-section-title" id="trading-title">Trading account</h2></div>
        {mode === 'checking' ? (
          <span className="tl-skel" style={{ height: 60, marginTop: 16 }} />
        ) : simulated ? (
          <div data-testid="simulator-status">
            <p style={{ margin: '16px 0 6px' }}><strong>Simulated account</strong> <span className="tl-tag tl-tag--sim" style={{ marginLeft: 6 }}>Simulated</span></p>
            <p className="tl-small tl-muted" style={{ margin: 0 }}>
              Bots trade simulated money in an isolated simulator: fills replay the {sessionDate(brokerStatus.session, { year: true })} close. No broker is connected or needed, and live trading is disabled.
            </p>
            <dl className="tl-facts tl-facts--left" style={{ marginTop: 14 }}>
              <dt>Portfolio value</dt><dd>{valuation ? money(valuation.equity) : valuation === false ? 'Unavailable' : '…'}</dd>
              <dt>Cash</dt><dd>{valuation ? money(valuation.cash) : valuation === false ? 'Unavailable' : '…'}</dd>
              <dt>Started with</dt><dd>{valuation ? money(valuation.startingCash) : '…'}</dd>
            </dl>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {mode === 'live-disabled' && <div className="tl-notice tl-notice--warn" role="status" style={{ marginBottom: 12 }}>Your connected account is a live account. Live trading is disabled, so bots won’t run on it.</div>}
            <BrokerTab />
          </div>
        )}
      </section>
    </main>
  )
}
