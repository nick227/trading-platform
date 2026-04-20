import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'

// ── Shared input style ────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%',
  padding: '0.75rem',
  border: '1px solid #e9ecef',
  borderRadius: '8px',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box'
}

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

  const card = (
    <div style={{
      width: '100%',
      maxWidth: '400px',
      background: 'white',
      borderRadius: '16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
      overflow: 'hidden'
    }}>

      {/* Mode toggle — only for login/register, not alpaca step */}
      {mode !== 'alpaca' && (
        <div style={{ display: 'flex', background: '#f8f9fa', borderBottom: '1px solid #e9ecef' }}>
          {['login', 'register'].map(m => (
            <button key={m}
              onClick={() => { setMode(m); setError(null) }}
              style={{
                flex: 1, padding: '1rem', border: 'none', cursor: 'pointer',
                background: mode === m ? 'white' : 'transparent',
                color:      mode === m ? '#111'  : '#7a7a7a',
                fontWeight: mode === m ? 600     : 400,
                transition: 'all 0.2s ease',
                textTransform: 'capitalize'
              }}
            >
              {m === 'login' ? 'Login' : 'Register'}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 700, color: '#111', marginBottom: '0.5rem' }}>
            {mode === 'login'    ? 'Welcome back'   :
             mode === 'register' ? 'Create account' :
                                   'Connect Alpaca'}
          </h1>
          <p style={{ margin: 0, fontSize: '14px', color: '#7a7a7a', lineHeight: 1.4 }}>
            {mode === 'login'    ? 'Sign in to access your portfolio and trading bots'          :
             mode === 'register' ? 'Get started with algorithmic trading and portfolio management' :
                                   'Link your Alpaca paper trading account to place orders'}
          </p>
        </div>

        {error && (
          <div style={{
            background: '#fff0f0', border: '1px solid #fcc', borderRadius: '8px',
            padding: '0.75rem', marginBottom: '1rem', fontSize: '14px', color: '#c0392b',
            textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        {/* ── Login form ── */}
        {mode === 'login' && (
          <form onSubmit={handleLoginSubmit} style={{ marginBottom: '1rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#111', marginBottom: '0.5rem' }}>
                Email Address
              </label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email" required autoComplete="email"
                style={inputStyle} disabled={loading} />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#111', marginBottom: '0.5rem' }}>
                Password
              </label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password" required autoComplete="current-password"
                style={inputStyle} disabled={loading} />
            </div>
            <button type="submit" className="primary pressable"
              style={{ width: '100%', padding: '0.875rem', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
              disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        {/* ── Register form ── */}
        {mode === 'register' && (
          <form onSubmit={handleRegisterSubmit} style={{ marginBottom: '1rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#111', marginBottom: '0.5rem' }}>
                Full Name
              </label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                placeholder="Enter your full name" required autoComplete="name"
                style={inputStyle} disabled={loading} />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#111', marginBottom: '0.5rem' }}>
                Email Address
              </label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email" required autoComplete="email"
                style={inputStyle} disabled={loading} />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#111', marginBottom: '0.5rem' }}>
                Password
              </label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Min 8 characters" required autoComplete="new-password"
                style={inputStyle} disabled={loading} />
            </div>
            <button type="submit" className="primary pressable"
              style={{ width: '100%', padding: '0.875rem', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
              disabled={loading}>
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
        )}

        {/* ── Alpaca credentials step (post-register) ── */}
        {mode === 'alpaca' && (
          <form onSubmit={handleAlpacaSubmit} style={{ marginBottom: '1rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#111', marginBottom: '0.5rem' }}>
                Alpaca API Key
              </label>
              <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value.trim())}
                placeholder="PK..." autoComplete="off" style={inputStyle} disabled={loading} />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#111', marginBottom: '0.5rem' }}>
                Alpaca API Secret
              </label>
              <input type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value.trim())}
                placeholder="Secret key" autoComplete="off" style={inputStyle} disabled={loading} />
            </div>
            <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '14px', cursor: 'pointer' }}>
              <input type="checkbox" id="paper" checked={paper} onChange={e => setPaper(e.target.checked)} />
              <label htmlFor="paper" style={{ cursor: 'pointer' }}>Paper trading account</label>
            </div>
            <button type="submit" className="primary pressable"
              style={{ width: '100%', padding: '0.875rem', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', marginBottom: '0.75rem' }}
              disabled={loading}>
              {loading ? 'Verifying…' : 'Connect & Continue'}
            </button>
            <button type="button" className="ghost pressable"
              style={{ width: '100%', padding: '0.75rem', border: '1px solid #e9ecef', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' }}
              onClick={() => navigate('/')}>
              Skip for now
            </button>
          </form>
        )}
      </div>
    </div>
  )

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
      padding: '1rem'
    }}>
      {card}
    </div>
  )
}
