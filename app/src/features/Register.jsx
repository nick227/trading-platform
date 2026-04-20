import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'

export default function Register() {
  const { register, saveAlpacaKeys } = useAuth()
  const navigate = useNavigate()

  const [step,       setStep]       = useState('account') // 'account' | 'alpaca'
  const [fullName,   setFullName]   = useState('')
  const [email,      setEmail]      = useState('')
  const [password,   setPassword]   = useState('')
  const [apiKey,     setApiKey]     = useState('')
  const [apiSecret,  setApiSecret]  = useState('')
  const [paper,      setPaper]      = useState(true)
  const [error,      setError]      = useState(null)
  const [loading,    setLoading]    = useState(false)

  const handleRegister = async (e) => {
    e.preventDefault()
    setError(null)
    if (!fullName || !email || !password) { setError('All fields are required'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }

    setLoading(true)
    try {
      await register(email, password, fullName)
      setStep('alpaca')
    } catch (err) {
      setError(err.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const handleAlpacaKeys = async (e) => {
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

  const skipAlpaca = () => navigate('/')

  if (step === 'alpaca') {
    return (
      <div className="auth">
        <h1 className="hero">Connect Alpaca</h1>
        <p style={{ textAlign: 'center', color: '#666', fontSize: '14px', margin: 0 }}>
          Connect your Alpaca paper trading account to place orders.
        </p>

        <form onSubmit={handleAlpacaKeys} style={{ display: 'contents' }}>
          <input
            placeholder="Alpaca API Key"
            value={apiKey}
            onChange={e => setApiKey(e.target.value.trim())}
            autoComplete="off"
            disabled={loading}
          />
          <input
            type="password"
            placeholder="Alpaca API Secret"
            value={apiSecret}
            onChange={e => setApiSecret(e.target.value.trim())}
            autoComplete="off"
            disabled={loading}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '14px', cursor: 'pointer' }}>
            <input type="checkbox" checked={paper} onChange={e => setPaper(e.target.checked)} />
            Paper trading account
          </label>

          {error && (
            <div style={{ color: '#c0392b', fontSize: '14px', textAlign: 'center' }}>
              {error}
            </div>
          )}

          <button type="submit" className="pressable primary" disabled={loading}>
            {loading ? 'Verifying…' : 'Connect & Continue'}
          </button>
        </form>

        <button className="btn btn-ghost" onClick={skipAlpaca}>
          Skip for now
        </button>
      </div>
    )
  }

  return (
    <div className="auth">
      <h1 className="hero">Create account</h1>

      <form onSubmit={handleRegister} style={{ display: 'contents' }}>
        <input
          placeholder="Full name"
          value={fullName}
          onChange={e => setFullName(e.target.value)}
          autoComplete="name"
          disabled={loading}
        />
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          disabled={loading}
        />
        <input
          type="password"
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          disabled={loading}
        />

        {error && (
          <div style={{ color: '#c0392b', fontSize: '14px', textAlign: 'center' }}>
            {error}
          </div>
        )}

        <button type="submit" className="pressable primary" disabled={loading}>
          {loading ? 'Creating account…' : 'Create Account'}
        </button>
      </form>

      <button className="btn btn-ghost" onClick={() => navigate('/auth')}>
        Already registered? Login
      </button>
    </div>
  )
}
