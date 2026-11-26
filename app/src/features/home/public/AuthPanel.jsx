import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../app/AuthProvider'

/** Existing session-backed registration and login. Preserve the required fullName contract. */
export default function AuthPanel() {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('register')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (mode === 'register' && password.length < 8) {
      setError('Choose a password of at least 8 characters.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'register') await register(email.trim(), password, fullName.trim())
      else await login(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err?.serverMessage || err?.message || 'Unable to continue. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tl-public-panel tl-public-panel--entry" id="get-started" aria-label="Get started">
      <div className="tl-public-auth-tabs" role="group" aria-label="Account action">
        <button type="button" aria-pressed={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError('') }}>Create account</button>
        <button type="button" aria-pressed={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError('') }}>Sign in</button>
      </div>
      <h2>{mode === 'register' ? 'Start with a free account' : 'Welcome back'}</h2>
      <p>{mode === 'register' ? 'Create an account to explore automated paper trading. No deposit or subscription required.' : 'Access your bots and simulated portfolios.'}</p>
      <form onSubmit={submit} className="tl-public-auth-form">
        {mode === 'register' && <label>Full name<input autoComplete="name" name="fullName" type="text" required maxLength="120" disabled={busy} value={fullName} onChange={e => setFullName(e.target.value)} /></label>}
        <label>Email address<input autoComplete="email" name="email" type="email" required disabled={busy} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <div className="tl-public-password">
          <label htmlFor="tl-public-password">Password</label>
          <div className="tl-public-password__field">
            <input id="tl-public-password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} name="password" type={showPassword ? 'text' : 'password'} required minLength={mode === 'register' ? 8 : undefined} disabled={busy} value={password} onChange={e => setPassword(e.target.value)} />
            <button type="button" className="tl-public-password__toggle" aria-pressed={showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(visible => !visible)}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        {error && <p className="tl-public-form-error" role="alert">{error}</p>}
        <button className="tl-public-button tl-public-button--primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create free account' : 'Sign in'}</button>
      </form>
      <p className="tl-public-form-footnote">Simulated trading only. No deposits, brokerage orders, or paid subscription at registration.</p>
    </div>
  )
}
