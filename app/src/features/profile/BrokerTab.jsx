import { useState } from 'react'
import { useAuth } from '../../app/AuthProvider'

export default function BrokerTab() {
  const { alpacaApiKey, saveAlpacaApiKey, testAlpacaApiKey } = useAuth()
  const [key, setKey] = useState(alpacaApiKey)
  const [status, setStatus] = useState('')

  const handleSaveKey = async () => {
    await saveAlpacaApiKey(key)
    setStatus('Alpaca API key saved.')
  }

  const handleTestKey = async () => {
    const isValid = await testAlpacaApiKey(key)
    setStatus(isValid ? 'Alpaca connection test passed.' : 'Alpaca connection test failed.')
  }

  return (
    <div className="profile-pane">
      <div className="card profile-card">
        <h3 className="profile-card-title">Alpaca Broker</h3>
        <div className="broker-status">
          {alpacaApiKey ? <span className="chip chip-live">Key Set</span> : <span className="chip">No Key</span>}
        </div>
        <label className="muted" htmlFor="alpaca-key">
          API Key
        </label>
        <input
          id="alpaca-key"
          className="form-input"
          placeholder="Enter Alpaca API Key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <div className="profile-actions">
          <button className="btn btn-primary" onClick={handleSaveKey}>
            Save Key
          </button>
          <button className="btn btn-ghost" onClick={handleTestKey}>
            Test Key
          </button>
        </div>
      </div>

      {status && (
        <p className="profile-status" role="status">
          {status}
        </p>
      )}
    </div>
  )
}
