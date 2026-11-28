import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../app/AuthProvider.jsx'
import { fetchReconcileStatus, triggerReconcile } from '../../api/profileClient.js'

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

  // Reconciliation state
  const [reconcileStatus, setReconcileStatus] = useState(null)
  const [reconciling, setReconciling] = useState(false)
  const [reconcileNotice, setReconcileNotice] = useState(null)

  const connected = Boolean(brokerStatus?.connected)

  const loadReconcileStatus = useCallback(async () => {
    try {
      const data = await fetchReconcileStatus()
      setReconcileStatus(data)
    } catch {
      // quiet fallback
    }
  }, [])

  useEffect(() => {
    if (connected) {
      loadReconcileStatus()
    }
  }, [connected, loadReconcileStatus])

  const handleReconcile = async () => {
    setReconciling(true)
    setReconcileNotice(null)
    try {
      const res = await triggerReconcile()
      await loadReconcileStatus()
      await refreshBrokerStatus().catch(() => {})
      setReconcileNotice({
        type: 'success',
        message: `Reconciliation complete. Scanned ${res.scannedOrders ?? 0} orders (imported ${res.imported ?? 0}). Status: ${res.inSync ? 'In Sync' : 'Drift Detected'}.`
      })
    } catch (err) {
      setReconcileNotice({
        type: 'error',
        message: err.message || 'Reconciliation failed.'
      })
    } finally {
      setReconciling(false)
    }
  }

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

  return (
    <div style={{
      marginTop: 16,
      padding: '20px 24px',
      background: 'var(--tl-surface)',
      border: '1px solid var(--tl-line)',
      borderRadius: 'var(--tl-radius)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 640, color: 'var(--tl-ink)' }}>Alpaca Broker Connection</h3>
        <button
          className="tl-btn tl-btn--sm tl-btn--quiet"
          onClick={() => refreshBrokerStatus().catch(() => {})}
          disabled={saving || disconnecting}
          title="Refresh status"
        >
          {saving || disconnecting ? '...' : '↻'}
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        {connected ? (
          <span className="tl-tag tl-tag--sim">{brokerStatus.paper ? 'Paper Trading' : 'Live Trading'} — Connected</span>
        ) : (
          <span className="tl-tag">Not Connected</span>
        )}
      </div>

      {connected && (
        <section
          style={{
            marginBottom: 20,
            padding: '16px 18px',
            background: 'var(--tl-surface-2)',
            borderRadius: 'var(--tl-radius-sm)',
            border: '1px solid var(--tl-line)',
          }}
          aria-labelledby="verified-balances-label"
        >
          <h4 id="verified-balances-label" style={{
            margin: '0 0 12px',
            fontSize: '11.5px',
            fontWeight: 600,
            color: 'var(--tl-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            {brokerStatus.paper !== false ? 'Verified Alpaca Paper Balances' : 'Alpaca Account Balances (Live Execution Disabled)'}
          </h4>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '12px 16px',
            marginBottom: 14,
          }}>
            <div>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--tl-muted)', marginBottom: 2 }}>Paper Equity</span>
              <span style={{ fontWeight: 640, fontSize: 15, fontVariantNumeric: 'tabular-nums', color: 'var(--tl-ink)' }}>{fmtMoney(brokerStatus.equity)}</span>
            </div>
            <div>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--tl-muted)', marginBottom: 2 }}>Cash Balance</span>
              <span style={{ fontWeight: 640, fontSize: 15, fontVariantNumeric: 'tabular-nums', color: 'var(--tl-ink)' }}>{fmtMoney(brokerStatus.cash)}</span>
            </div>
            <div>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--tl-muted)', marginBottom: 2 }}>Paper Buying Power</span>
              <span style={{ fontWeight: 640, fontSize: 15, fontVariantNumeric: 'tabular-nums', color: 'var(--tl-ink)' }}>{fmtMoney(brokerStatus.buyingPower)}</span>
            </div>
            <div>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--tl-muted)', marginBottom: 2 }}>Account Number</span>
              <span style={{ fontWeight: 540, fontSize: 14, fontVariantNumeric: 'tabular-nums', color: 'var(--tl-ink)' }}>{brokerStatus.accountNumber || '—'}</span>
            </div>
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 10,
            borderTop: '1px solid var(--tl-line)',
            fontSize: 12.5,
            color: 'var(--tl-muted)',
          }}>
            <span>Last Synchronized: {fmtTime(brokerStatus.lastVerifiedAt)}</span>
            <button
              type="button"
              className="tl-btn tl-btn--sm tl-btn--quiet tl-btn--danger"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect Account'}
            </button>
          </div>
        </section>
      )}

      {connected && (
        <section
          style={{
            marginBottom: 20,
            padding: '16px 18px',
            background: 'var(--tl-surface-2)',
            borderRadius: 'var(--tl-radius-sm)',
            border: '1px solid var(--tl-line)',
          }}
          aria-labelledby="reconciliation-status-label"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h4 id="reconciliation-status-label" style={{
              margin: 0,
              fontSize: '11.5px',
              fontWeight: 600,
              color: 'var(--tl-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              Broker Ledger & Position Reconciliation
            </h4>
            <button
              type="button"
              className="tl-btn tl-btn--sm tl-btn--primary"
              onClick={handleReconcile}
              disabled={reconciling || saving || disconnecting}
            >
              {reconciling ? 'Reconciling…' : 'Reconcile Activity Now'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            {reconcileStatus?.inSync ? (
              <span className="tl-tag tl-tag--sim">
                ✓ Ledger In Sync (0 Mismatches)
              </span>
            ) : (
              <span className="tl-tag" style={{ background: 'var(--tl-negative-surface, rgba(211, 47, 47, 0.1))', color: 'var(--tl-negative, #d32f2f)' }}>
                ⚠ Position Drift ({reconcileStatus?.mismatchCount || 0} mismatches)
              </span>
            )}
            <span style={{ fontSize: 12.5, color: 'var(--tl-muted)' }}>
              Source: <strong style={{ color: 'var(--tl-ink)' }}>{reconcileStatus?.positionSource?.toUpperCase() || 'DB'}</strong>
            </span>
            {reconcileStatus?.lastSyncedAt && (
              <span style={{ fontSize: 12.5, color: 'var(--tl-muted)', marginLeft: 'auto' }}>
                Last Reconciled: {fmtTime(reconcileStatus.lastSyncedAt)}
              </span>
            )}
          </div>

          {reconcileStatus?.mismatchDetails && reconcileStatus.mismatchDetails.length > 0 && (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--tl-line)', color: 'var(--tl-muted)' }}>
                    <th style={{ padding: '6px 8px' }}>Symbol</th>
                    <th style={{ padding: '6px 8px' }}>Local Trade Qty</th>
                    <th style={{ padding: '6px 8px' }}>Broker Actual Qty</th>
                    <th style={{ padding: '6px 8px' }}>Broker Avg Price</th>
                  </tr>
                </thead>
                <tbody>
                  {reconcileStatus.mismatchDetails.map((m, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--tl-line)', color: 'var(--tl-ink)' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{m.symbol}</td>
                      <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums' }}>{m.localQty}</td>
                      <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums' }}>{m.brokerQty}</td>
                      <td style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(m.brokerAvgPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {reconcileNotice && (
            <div className={`tl-notice ${reconcileNotice.type === 'error' ? 'tl-notice--error' : 'tl-notice--success'}`} style={{ marginTop: 12 }}>
              {reconcileNotice.message}
            </div>
          )}
        </section>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 16 }}>
        <button
          type="button"
          className={`tl-btn tl-btn--sm ${paper ? 'tl-btn--primary' : ''}`}
          onClick={() => setPaper(true)}
        >
          Paper
        </button>
        <button
          type="button"
          className="tl-btn tl-btn--sm"
          disabled
          title="Live execution is disabled during platform simulation verification"
        >
          Live (Disabled)
        </button>
      </div>

      {!paper && (
        <div className="tl-notice tl-notice--warn" style={{ marginBottom: 16 }}>
          Live trading uses real money. Ensure your credentials are correct before saving.
        </div>
      )}

      {paper && !connected && (
        <p className="tl-small tl-muted" style={{ margin: '0 0 16px' }}>
          Enter your Alpaca paper trading API keys. Paper trading uses simulated funds hosted by Alpaca (<code>https://paper-api.alpaca.markets</code>) so you can test bots with zero financial risk.
        </p>
      )}

      <div className="tl-field" style={{ marginBottom: 14 }}>
        <label className="tl-label" htmlFor="alpaca-key">
          API Key
        </label>
        <input
          id="alpaca-key"
          className="tl-input"
          placeholder={connected ? '(leave blank to keep existing)' : 'PKXXXXXXXXXXXXXXXX'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>

      <div className="tl-field" style={{ marginBottom: 18 }}>
        <label className="tl-label" htmlFor="alpaca-secret">
          API Secret{connected && <span className="tl-muted tl-small"> (leave blank to keep existing)</span>}
        </label>
        <input
          id="alpaca-secret"
          className="tl-input"
          type="password"
          placeholder={connected ? '••••••••••••••••' : 'Enter API secret'}
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
        />
      </div>

      <div>
        <button className="tl-btn tl-btn--primary" type="button" onClick={handleSave} disabled={saving || disconnecting}>
          {saving ? 'Verifying…' : connected ? 'Update Credentials' : 'Connect Alpaca'}
        </button>
      </div>

      {status && (
        <div className={`tl-notice ${status.type === 'error' ? 'tl-notice--error' : 'tl-notice--success'}`} style={{ marginTop: 14 }} role="status">
          {status.message}
        </div>
      )}
    </div>
  )
}
