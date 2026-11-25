import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { get } from '../../api/client'
import { useAuth } from '../../app/AuthProvider'
import { getTradingMode, isSimulated } from '../../components/ModeBadge'
import BrokerTab from '../profile/BrokerTab'
import { EmergencyBanner, useEmergencyStop } from '../../ui/Safety'
import { money, sessionDate } from '../../ui/format'

function initials(user) {
  const name = String(user?.fullName ?? user?.name ?? user?.email ?? '').trim()
  if (!name) return '•'
  const parts = name.includes('@') ? [name[0]] : name.split(/\s+/).slice(0, 2).map((p) => p[0])
  return parts.join('').toUpperCase()
}

/** Account: who you are, how to sign out, and what kind of trading account you're using. */
export default function AccountPage() {
  const { user, logout, brokerStatus, brokerStatusLoading, brokerStatusError } = useAuth()
  const navigate = useNavigate()
  const mode = getTradingMode(brokerStatus, { loading: brokerStatusLoading, error: brokerStatusError })
  const simulated = isSimulated(brokerStatus)
  const [valuation, setValuation] = useState(null)
  const [signingOut, setSigningOut] = useState(false)
  const { stop, clear } = useEmergencyStop()

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
    <main className="tl-page tl-account-page">
      <EmergencyBanner stop={stop} onClear={clear} />
      <header className="tl-header">
        <div>
          <h1 className="tl-title">Account</h1>
          <p className="tl-lede">Your profile and simulation environment settings.</p>
        </div>
      </header>

      <section className="tl-section" aria-labelledby="profile-title">
        <div className="tl-section-head"><h2 className="tl-section-title" id="profile-title">Profile</h2></div>
        <div className="tl-account-card">
          <div className="tl-account-card__identity">
            <div className="tl-account-card__avatar">
              {initials(user)}
            </div>
            <div>
              <div className="tl-account-card__name">{user?.fullName || user?.name || 'TradeLoom User'}</div>
              <div className="tl-account-card__email">{user?.email || '—'}</div>
            </div>
          </div>

          <div className="tl-account-card__footer">
            <button
              type="button"
              className="tl-btn tl-btn--sm"
              onClick={signOut}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </section>

      <section className="tl-section" aria-labelledby="trading-title">
        <div className="tl-section-head"><h2 className="tl-section-title" id="trading-title">Trading account</h2></div>
        {mode === 'checking' ? (
          <span className="tl-skel" style={{ height: 60, marginTop: 16 }} />
        ) : simulated ? (
          <div className="tl-account-card" data-testid="simulator-status">
            <div className="tl-account-card__mode">
              <span style={{ fontWeight: 640, fontSize: 15, color: 'var(--tl-ink)' }}>Simulated Account</span>
              <span className="tl-tag tl-tag--sim">Simulated</span>
            </div>
            <p className="tl-small tl-muted" style={{ margin: '0 0 16px', lineHeight: 1.5 }}>
              {brokerStatus.mode === 'paper_daily'
                ? <>Bots trade simulated money in an isolated simulator: they act once per trading day on that day’s close (latest: {sessionDate(brokerStatus.session, { year: true })}). No broker is connected or needed, and live trading is disabled.</>
                : <>Bots trade simulated money in an isolated simulator: fills replay the {sessionDate(brokerStatus.session, { year: true })} close. No broker is connected or needed, and live trading is disabled.</>}
            </p>
            <dl className="tl-facts tl-facts--left tl-account-card__facts">
              <dt>Portfolio equity</dt><dd>{valuation ? money(valuation.equity) : valuation === false ? 'Unavailable' : '…'}</dd>
              <dt>Cash available</dt><dd>{valuation ? money(valuation.cash) : valuation === false ? 'Unavailable' : '…'}</dd>
              <dt>Starting cash</dt><dd>{valuation ? money(valuation.startingCash) : '…'}</dd>
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
