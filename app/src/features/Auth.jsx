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
    <div className="tl-auth-screen">
      <div className="tl-auth-panel">
        {/* Brand header */}
        <div className="tl-auth-panel__brand">
          <div className="tl-auth-panel__identity">
            <svg  viewBox="0 0 32 32" fill="none" aria-hidden="true">
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

        <div className="tl-auth-panel__body">
          <div className="tl-auth-panel__intro">
            <h1 className="tl-auth-panel__title">
              {mode === 'login'    ? 'Sign in' :
               mode === 'register' ? 'Create your account' :
                                     'Connect Alpaca account'}
            </h1>
            <p className="tl-auth-panel__help">
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
                  
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <div className="tl-field" >
                <label className="tl-label" htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  className="tl-input"
                  
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
                  
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Jane Doe"
                  required
                  autoComplete="name"
                  disabled={loading}
                />
              </div>

              <div className="tl-field" >
                <label className="tl-label" htmlFor="reg-email">Email Address</label>
                <input
                  id="reg-email"
                  className="tl-input"
                  
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <div className="tl-field" >
                <label className="tl-label" htmlFor="reg-password">Password</label>
                <input
                  id="reg-password"
                  className="tl-input"
                  
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
                  
                  type="text"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value.trim())}
                  placeholder="PK..."
                  autoComplete="off"
                  disabled={loading}
                />
              </div>

              <div className="tl-field" >
                <label className="tl-label" htmlFor="alpaca-secret">Secret Key</label>
                <input
                  id="alpaca-secret"
                  className="tl-input"
                  
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
