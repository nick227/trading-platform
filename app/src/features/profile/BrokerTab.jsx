import { useState, useEffect } from 'react'
import { useAuth } from '../../app/AuthProvider.jsx'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function fmtMoney(n) {
  return n === null || n === undefined ? '—' : currency.format(n)
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function BrokerTab() {
  const { brokerStatus, saveAlpacaKeys, refreshBrokerStatus, disconnectBroker } = useAuth()

  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [paper, setPaper] = useState(brokerStatus?.paper ?? true)
  const [status, setStatus] = useState(null) // { type: 'success'|'error', message }
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

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

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect your Alpaca account? Your bots will pause and broker operations will be disabled until you reconnect.')) {
      return
    }

    setDisconnecting(true)
    setStatus(null)
    try {
      await disconnectBroker()
      setApiKey('')
      setApiSecret('')
      setStatus({ type: 'success', message: 'Alpaca broker account disconnected.' })
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Failed to disconnect broker account.' })
    } finally {
      setDisconnecting(false)
    }
  }

  const connected = Boolean(brokerStatus?.connected)

  return (
    <div className="profile-pane">
      <div className="card profile-card">
        <div className="profile-card-header flex row w-full">
          <h3 className="profile-card-title">Alpaca Broker Connection</h3>
          <button
            className="btn btn-xs btn-ghost"
            onClick={() => refreshBrokerStatus().catch(() => {})}
            disabled={saving || disconnecting}
            title="Refresh status"
          >
            {saving || disconnecting ? '...' : '↻'}
          </button>
        </div>

        <div className="mb-4">
          {connected ? (
            <span className="chip chip-live">{brokerStatus.paper ? 'Paper Trading' : 'Live Trading'} — Connected</span>
          ) : (
            <span className="chip">Not Connected</span>
          )}
        </div>

        {connected && (
          <section className="card card-pad-sm mb-4 bg-subtle" aria-labelledby="verified-balances-label">
            <h4 id="verified-balances-label" className="text-xs font-600 muted uppercase tracking-wide mb-3">
              Verified Alpaca Paper Balances
            </h4>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <span className="muted text-xs block">Paper Equity</span>
                <span className="font-600 font-mono text-base">{fmtMoney(brokerStatus.equity)}</span>
              </div>
              <div>
                <span className="muted text-xs block">Cash Balance</span>
                <span className="font-600 font-mono text-base">{fmtMoney(brokerStatus.cash)}</span>
              </div>
              <div>
                <span className="muted text-xs block">Paper Buying Power</span>
                <span className="font-600 font-mono text-base">{fmtMoney(brokerStatus.buyingPower)}</span>
              </div>
              <div>
                <span className="muted text-xs block">Account Number</span>
                <span className="font-mono text-sm">{brokerStatus.accountNumber || '—'}</span>
              </div>
            </div>
            <div className="text-xs muted flex justify-between items-center pt-2 border-t">
              <span>Last Synchronized: {fmtTime(brokerStatus.lastVerifiedAt)}</span>
              <button
                type="button"
                className="btn btn-xs btn-ghost text-negative"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect Account'}
              </button>
            </div>
          </section>
        )}

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

        {paper && !connected && (
          <p className="muted text-xs mb-4">
            Enter your Alpaca paper trading API keys. Paper trading uses simulated funds hosted by Alpaca (<code>https://paper-api.alpaca.markets</code>) so you can test bots with zero financial risk.
          </p>
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

        <div className="profile-actions flex gap-2">
          <button className="btn btn-sm btn-primary" type="button" onClick={handleSave} disabled={saving || disconnecting}>
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
