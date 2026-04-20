import { useState, useEffect } from 'react'
import { useAuth } from '../../app/AuthProvider.jsx'

export default function BrokerTab() {
  const { brokerStatus, saveAlpacaKeys } = useAuth()

  const [apiKey,    setApiKey]    = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [paper,     setPaper]     = useState(brokerStatus?.paper ?? true)
  const [status,    setStatus]    = useState(null)  // { type: 'success'|'error', message }
  const [saving,    setSaving]    = useState(false)

  // Sync paper toggle if brokerStatus loads after mount
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

        <div className="broker-status" style={{ marginBottom: '1rem' }}>
          {connected
            ? <span className="chip chip-live">{brokerStatus.paper ? 'Paper Trading' : 'Live Trading'} — Connected</span>
            : <span className="chip">Not Connected</span>
          }
        </div>

        {/* Environment toggle */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button className={`pressable ${paper ? 'primary' : 'ghost'}`} onClick={() => setPaper(true)}
            style={{ padding: '0.4rem 0.9rem', fontSize: '13px' }}>
            Paper
          </button>
          <button className={`pressable ${!paper ? 'primary' : 'ghost'}`} onClick={() => setPaper(false)}
            style={{ padding: '0.4rem 0.9rem', fontSize: '13px' }}>
            Live
          </button>
        </div>

        {!paper && (
          <div style={{
            background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6,
            padding: '0.6rem 0.75rem', marginBottom: '1rem', fontSize: '13px', color: '#c0392b'
          }}>
            Live trading uses real money. Ensure your credentials are correct before saving.
          </div>
        )}

        <label className="muted" htmlFor="alpaca-key" style={{ display: 'block', marginBottom: '0.25rem' }}>
          API Key
        </label>
        <input
          id="alpaca-key"
          className="form-input"
          placeholder={connected ? '(leave blank to keep existing)' : 'PKXXXXXXXXXXXXXXXX'}
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          style={{ marginBottom: '0.75rem', width: '100%' }}
        />

        <label className="muted" htmlFor="alpaca-secret" style={{ display: 'block', marginBottom: '0.25rem' }}>
          API Secret{connected && <span style={{ fontSize: '11px' }}> (leave blank to keep existing)</span>}
        </label>
        <input
          id="alpaca-secret"
          className="form-input"
          type="password"
          placeholder={connected ? '••••••••••••••••' : 'Enter API secret'}
          value={apiSecret}
          onChange={e => setApiSecret(e.target.value)}
          style={{ marginBottom: '1rem', width: '100%' }}
        />

        <div className="profile-actions">
          <button className="btn btn-primary pressable" onClick={handleSave} disabled={saving}
            style={{ opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Verifying…' : connected ? 'Update Credentials' : 'Connect Alpaca'}
          </button>
        </div>
      </div>

      {status && (
        <p className="profile-status" role="status"
          style={{ color: status.type === 'error' ? '#c0392b' : '#0a7a47', marginTop: '0.75rem' }}>
          {status.message}
        </p>
      )}
    </div>
  )
}
