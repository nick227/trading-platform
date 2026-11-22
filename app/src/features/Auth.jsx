import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'

export default function Auth() {
  const { login, register, saveAlpacaKeys } = useAuth()
  const navigate  = useNavigate()

  const [mode,     setMode]     = useState('login')  // 'login' | 'register' | 'alpaca'
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // Account fields
  const [fullName, setFullName] = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')

  // Alpaca fields
  const [apiKey,    setApiKey]    = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [paper,     setPaper]     = useState(true)

  const handleLoginSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!email || !password) { setError('Email and password are required'); return }
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleRegisterSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!fullName || !email || !password) { setError('All fields are required'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await register(email, password, fullName)
      setMode('alpaca')
      setError(null)
    } catch (err) {
      setError(err.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const handleAlpacaSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!apiKey || !apiSecret) { setError('Both API key and secret are required'); return }
    setLoading(true)
    try {
      await saveAlpacaKeys(apiKey, apiSecret, paper)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Failed to save Alpaca credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--tl-surface-2)',
      padding: '24px',
      fontFamily: 'var(--tl-font)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'var(--tl-surface)',
        borderRadius: 'var(--tl-radius-lg)',
        border: '1px solid var(--tl-line)',
        boxShadow: 'var(--tl-shadow-md)',
        overflow: 'hidden',
      }}>
        {/* Brand header */}
        <div style={{
          padding: '24px 24px 16px',
          borderBottom: '1px solid var(--tl-line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 680, fontSize: '18px', color: 'var(--tl-ink)', letterSpacing: '-0.02em' }}>
            <svg style={{ width: 22, height: 22, color: 'var(--tl-accent)', flex: 'none' }} viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2.2" />
              <path d="M11 16.2l3.2 3.2L21 12.6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>TradeLoom</span>
          </div>

          {mode !== 'alpaca' && (
            <div className="tl-seg" role="tablist">
              <button
                type="button"
                role="tab"
                aria-pressed={mode === 'login'}
                onClick={() => { setMode('login'); setError(null) }}
              >
                Login
              </button>
              <button
                type="button"
                role="tab"
                aria-pressed={mode === 'register'}
                onClick={() => { setMode('register'); setError(null) }}
              >
                Register
              </button>
            </div>
          )}
        </div>

        <div style={{ padding: '24px' }}>
          <div style={{ marginBottom: '20px' }}>
            <h1 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: 640, color: 'var(--tl-ink)', letterSpacing: '-0.015em' }}>
              {mode === 'login'    ? 'Sign in' :
               mode === 'register' ? 'Create your account' :
                                     'Connect Alpaca account'}
            </h1>
            <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--tl-muted)', lineHeight: 1.45 }}>
              {mode === 'login'    ? 'Enter your credentials to access your portfolio.' :
               mode === 'register' ? 'Get started with autonomous trading bots and portfolio tracking.' :
                                     'Link your Alpaca paper trading account to place orders.'}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="tl-notice tl-notice--error"
              style={{ marginBottom: '16px' }}
            >
              {error}
            </div>
          )}

          {/* ── Login form ── */}
          {mode === 'login' && (
            <form onSubmit={handleLoginSubmit}>
              <div className="tl-field">
                <label className="tl-label" htmlFor="login-email">Email Address</label>
                <input
                  id="login-email"
                  className="tl-input"
                  style={{ maxWidth: '100%' }}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <div className="tl-field" style={{ marginTop: '14px' }}>
                <label className="tl-label" htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  className="tl-input"
                  style={{ maxWidth: '100%' }}
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                className="tl-btn tl-btn--primary tl-btn--block"
                style={{ marginTop: '20px', height: '40px' }}
                disabled={loading}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {/* ── Register form ── */}
          {mode === 'register' && (
            <form onSubmit={handleRegisterSubmit}>
              <div className="tl-field">
                <label className="tl-label" htmlFor="reg-name">Full Name</label>
                <input
                  id="reg-name"
                  className="tl-input"
                  style={{ maxWidth: '100%' }}
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Jane Doe"
                  required
                  autoComplete="name"
                  disabled={loading}
                />
              </div>

              <div className="tl-field" style={{ marginTop: '14px' }}>
                <label className="tl-label" htmlFor="reg-email">Email Address</label>
                <input
                  id="reg-email"
                  className="tl-input"
                  style={{ maxWidth: '100%' }}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <div className="tl-field" style={{ marginTop: '14px' }}>
                <label className="tl-label" htmlFor="reg-password">Password</label>
                <input
                  id="reg-password"
                  className="tl-input"
                  style={{ maxWidth: '100%' }}
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoComplete="new-password"
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                className="tl-btn tl-btn--primary tl-btn--block"
                style={{ marginTop: '20px', height: '40px' }}
                disabled={loading}
              >
                {loading ? 'Creating account…' : 'Create account'}
              </button>
            </form>
          )}

          {/* ── Alpaca step ── */}
          {mode === 'alpaca' && (
            <form onSubmit={handleAlpacaSubmit}>
              <div className="tl-field">
                <label className="tl-label" htmlFor="alpaca-key">Alpaca API Key ID</label>
                <input
                  id="alpaca-key"
                  className="tl-input"
                  style={{ maxWidth: '100%' }}
                  type="text"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value.trim())}
                  placeholder="PK..."
                  autoComplete="off"
                  disabled={loading}
                />
              </div>

              <div className="tl-field" style={{ marginTop: '14px' }}>
                <label className="tl-label" htmlFor="alpaca-secret">Secret Key</label>
                <input
                  id="alpaca-secret"
                  className="tl-input"
                  style={{ maxWidth: '100%' }}
                  type="password"
                  value={apiSecret}
                  onChange={e => setApiSecret(e.target.value.trim())}
                  placeholder="Secret key"
                  autoComplete="off"
                  disabled={loading}
                />
              </div>

              <label style={{
                marginTop: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '13.5px',
                color: 'var(--tl-ink-2)',
                cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  id="paper"
                  checked={paper}
                  onChange={e => setPaper(e.target.checked)}
                  style={{ accentColor: 'var(--tl-accent)' }}
                />
                <span>Paper trading account (recommended)</span>
              </label>

              <button
                type="submit"
                className="tl-btn tl-btn--primary tl-btn--block"
                style={{ marginTop: '20px', height: '40px' }}
                disabled={loading}
              >
                {loading ? 'Verifying…' : 'Connect & Continue'}
              </button>

              <button
                type="button"
                className="tl-btn tl-btn--block"
                style={{ marginTop: '8px', height: '36px' }}
                onClick={() => navigate('/')}
              >
                Skip for now
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
