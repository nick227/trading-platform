import { useState } from 'react'
import { useAuth } from '../../app/AuthProvider'

export default function AccountTab() {
  const { user, updateUsername, resetPassword } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [status, setStatus] = useState('')

  const handleUsernameSave = async () => {
    await updateUsername(name)
    setStatus('Username updated.')
  }

  const handlePasswordReset = async () => {
    await resetPassword(currentPassword, nextPassword)
    setCurrentPassword('')
    setNextPassword('')
    setStatus('Password reset complete.')
  }

  return (
    <div className="profile-pane">
      <div className="card profile-card">
        <h3 className="profile-card-title">Account</h3>
        <img className="avatar-lg" src={user?.avatar} />
        <label className="muted" htmlFor="profile-name">
          Username
        </label>
        <input
          id="profile-name"
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-primary" onClick={handleUsernameSave}>
          Save Username
        </button>
      </div>

      <div className="card profile-card">
        <h3 className="profile-card-title">Reset Password</h3>
        <label className="muted" htmlFor="current-password">
          Current Password
        </label>
        <input
          id="current-password"
          type="password"
          className="form-input"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <label className="muted" htmlFor="next-password">
          New Password
        </label>
        <input
          id="next-password"
          type="password"
          className="form-input"
          value={nextPassword}
          onChange={(e) => setNextPassword(e.target.value)}
        />
        <button className="btn btn-ghost" onClick={handlePasswordReset}>
          Reset Password
        </button>
      </div>

      {status && (
        <p className="profile-status" role="status">
          {status}
        </p>
      )}
    </div>
  )
}
