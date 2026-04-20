import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'

export default function Login() {
  const { login } = useAuth()
  const navigate  = useNavigate()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(null)
  const [loading,  setLoading]  = useState(false)

  const handleLogin = async (e) => {
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

  return (
    <div className="auth">
      <h1 className="hero">Welcome back</h1>

      <form onSubmit={handleLogin} style={{ display: 'contents' }}>
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
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={loading}
        />

        {error && (
          <div style={{ color: '#c0392b', fontSize: '14px', textAlign: 'center' }}>
            {error}
          </div>
        )}

        <button type="submit" className="pressable primary" disabled={loading}>
          {loading ? 'Logging in…' : 'Login'}
        </button>
      </form>

      <button className="btn btn-ghost" onClick={() => navigate('/register')}>
        Need an account? Register
      </button>
    </div>
  )
}
