import { useState, useEffect } from 'react'
import { useAuth } from '../../app/AuthProvider.jsx'

export default function BrokerTab() {
  const { brokerStatus, saveAlpacaKeys } = useAuth()

  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [paper, setPaper] = useState(brokerStatus?.paper ?? true)
  const [status, setStatus] = useState(null) // { type: 'success'|'error', message }
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (brokerStatus?.paper !== undefined) setPaper(brokerStatus.paper)
  }, [brokerStatus?.paper])

  const handleSave = async () => {
    if (!apiKey || !apiSecret) {
      setStatus({ type: 'error', message: 'API key and secret are required.' })
      return
    }

    setSaving(true)
    setStatus(null)

    try {
      await saveAlpacaKeys(apiKey, apiSecret, paper)
      setApiKey('')
      setApiSecret('')
      setStatus({ type: 'success', message: `Alpaca ${paper ? 'paper' : 'live'} account connected.` })
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Failed to save. Check your credentials.' })
    } finally {
      setSaving(false)
    }
  }

  const connected = brokerStatus?.connected

  return (
    <div className="profile-pane">
      <div className="card profile-card">
        <h3 className="profile-card-title">Alpaca Broker</h3>

        <div className="mb-4">
          {connected ? (
            <span className="chip chip-live">{brokerStatus.paper ? 'Paper Trading' : 'Live Trading'} — Connected</span>
          ) : (
            <span className="chip">Not Connected</span>
          )}
        </div>

        <div className="wrap mb-4">
          <button
            type="button"
            className={paper ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
            onClick={() => setPaper(true)}
          >
            Paper
          </button>
          <button
            type="button"
            className={!paper ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
            onClick={() => setPaper(false)}
          >
            Live
          </button>
        </div>

        {!paper && (
          <div className="alert alert-warn mb-4">
            Live trading uses real money. Ensure your credentials are correct before saving.
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="alpaca-key">
            API Key
          </label>
          <input
            id="alpaca-key"
            className="field-input"
            placeholder={connected ? '(leave blank to keep existing)' : 'PKXXXXXXXXXXXXXXXX'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="alpaca-secret">
            API Secret{connected && <span className="muted text-xs"> (leave blank to keep existing)</span>}
          </label>
          <input
            id="alpaca-secret"
            className="field-input"
            type="password"
            placeholder={connected ? '••••••••••••••••' : 'Enter API secret'}
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
          />
        </div>

        <div className="profile-actions">
          <button className="btn btn-sm btn-primary" type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Verifying…' : connected ? 'Update Credentials' : 'Connect Alpaca'}
          </button>
        </div>
      </div>

      {status && (
        <p className={`profile-status mt-3 ${status.type === 'error' ? 'text-negative' : 'text-positive'}`} role="status">
          {status.message}
        </p>
      )}
    </div>
  )
}

