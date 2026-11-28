import { useCallback, useEffect, useState } from 'react'
import { get, put } from '../../api/client'
import { moneyWhole } from '../../ui/format'

const DEFAULT_SECTORS = ['Technology', 'Healthcare', 'Financials']

export default function PersonalAiTraderCard({ compact = false, onUpdated = null, onStatusChange = null }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [editing, setEditing] = useState(false)
  const [riskProfile, setRiskProfile] = useState('balanced')
  const [sectors, setSectors] = useState(DEFAULT_SECTORS)
  const [approvalMode, setApprovalMode] = useState('paper_veto_1s')
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const syncDraftFromData = useCallback((payload) => {
    const mandate = payload?.bot?.personalMandate
    if (mandate) {
      setRiskProfile(mandate.riskProfile || 'balanced')
      setSectors(Array.isArray(mandate.sectors) && mandate.sectors.length ? mandate.sectors : DEFAULT_SECTORS)
      setApprovalMode(mandate.approvalMode || 'paper_veto_1s')
      setEnabled(payload?.bot?.enabled !== false)
    }
  }, [])

  const load = useCallback(() => {
    get('/ai/personal-trader')
      .then((res) => {
        const payload = res?.data ?? res
        if (!payload || !payload.lifecycle) {
          setState({ status: 'unavailable', data: null, error: null })
          onStatusChange?.({ status: 'unavailable' })
          return
        }
        syncDraftFromData(payload)
        setState({ status: 'ready', data: payload, error: null })
        onStatusChange?.({ status: 'ready', configured: Boolean(payload.configured), enabled: payload.bot?.enabled === true })
      })
      .catch(() => {
        setState({ status: 'unavailable', data: null, error: null })
        onStatusChange?.({ status: 'unavailable' })
      })
  }, [syncDraftFromData, onStatusChange])

  useEffect(() => { load() }, [load])

  if (state.status === 'loading' || state.status === 'unavailable' || !state.data) {
    return null
  }

  const d = state.data
  const lc = d.lifecycle
  const showSetupForm = editing || !d.configured

  const toggleSector = (sector) => {
    setSectors((prev) =>
      prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector]
    )
  }

  const handleSave = async (nextEnabledOverride = null) => {
    if (sectors.length === 0) {
      setSaveError('Choose at least one sector so your Personal AI Trader knows where to look.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await put('/ai/personal-trader', {
        riskProfile,
        sectors,
        approvalMode,
        enabled: typeof nextEnabledOverride === 'boolean' ? nextEnabledOverride : enabled
      })
      const payload = res?.data ?? res
      syncDraftFromData(payload)
      setState({ status: 'ready', data: payload, error: null })
      onStatusChange?.({ status: 'ready', configured: Boolean(payload.configured), enabled: payload.bot?.enabled === true })
      setEditing(false)
      onUpdated?.(payload)
    } catch (err) {
      setSaveError(err?.message || 'Could not save Personal AI Trader settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="tl-card tl-card-shell tl-card-shell--compact"
      style={{ marginBottom: '1.25rem' }}
      aria-labelledby="personal-ai-trader-heading"
      data-testid="personal-ai-trader-card"
    >
      <div className="tl-section-head">
        <div>
          <h2 id="personal-ai-trader-heading" className="tl-section-title" style={{ margin: 0 }}>
            Personal AI Trader
          </h2>
          <p className="tl-small tl-muted" style={{ margin: '0.2rem 0 0' }}>
            Dedicated simulated paper portfolio ({moneyWhole(d.portfolio?.startingCash ?? 10000)} starting cash) · Zero brokerage keys required
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="tl-tag" data-testid="personal-trader-lifecycle-badge">{lc.badge}</span>
          {d.configured && !editing && (
            <>
              <button
                type="button"
                className="tl-btn tl-btn--sm"
                disabled={saving}
                onClick={() => handleSave(!d.bot.enabled)}
                data-testid="personal-trader-toggle-btn"
              >
                {d.bot.enabled ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                className="tl-link-btn"
                onClick={() => setEditing(true)}
                data-testid="personal-trader-edit-btn"
              >
                Adjust preferences
              </button>
            </>
          )}
        </div>
      </div>

      <div className="tl-flow-card" style={{ marginTop: '0.75rem' }} data-testid="personal-trader-lifecycle-panel">
        <p className="tl-small" style={{ margin: 0 }}><strong>{lc.headline}</strong></p>
        <p className="tl-small tl-muted" style={{ margin: '0.25rem 0 0' }} data-testid="personal-trader-next-step">
          <strong>What happens next:</strong> {lc.whatHappensNext}
        </p>
        {d.configured && d.bot?.personalMandate && !editing && (
          <p className="tl-small tl-muted" style={{ margin: '0.4rem 0 0' }}>
            Mandate: <strong>{d.bot.personalMandate.riskProfile}</strong> risk ·{' '}
            <strong>{d.bot.personalMandate.sectors.join(', ')}</strong> ·{' '}
            Mode: <strong>{d.bot.personalMandate.approvalMode === 'paper_veto_1s' ? '1-session Copilot review' : d.bot.personalMandate.approvalMode === 'require_approval' ? 'Manual approval' : 'Paper autopilot'}</strong>
          </p>
        )}
      </div>

      {showSetupForm && (!compact || editing || !d.configured) && (
        <div style={{ marginTop: '0.85rem' }} data-testid="personal-trader-setup-form">
          <div style={{ marginBottom: '0.75rem' }}>
            <p className="tl-small" style={{ margin: '0 0 0.35rem' }}><strong>1. Risk comfort &amp; deterministic limits</strong></p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }} role="group" aria-label="Risk comfort">
              {(d.options?.riskProfiles || []).map((rp) => (
                <button
                  key={rp.id}
                  type="button"
                  className={`tl-tag ${riskProfile === rp.id ? 'is-active' : ''}`}
                  aria-pressed={riskProfile === rp.id}
                  onClick={() => setRiskProfile(rp.id)}
                  data-testid={`personal-risk-${rp.id}`}
                >
                  {rp.label} (max {Math.round(rp.maxPositionPct * 100)}% / {moneyWhole(rp.maxOrderNotional)})
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <p className="tl-small" style={{ margin: '0 0 0.35rem' }}><strong>2. Preferred sectors (structured GICS filter)</strong></p>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }} role="group" aria-label="Preferred sectors">
              {(d.options?.sectors || []).map((sec) => {
                const active = sectors.includes(sec)
                return (
                  <button
                    key={sec}
                    type="button"
                    className={`tl-tag ${active ? 'is-active' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggleSector(sec)}
                    data-testid={`personal-sector-${sec}`}
                  >
                    {active ? '✓ ' : ''}{sec}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <p className="tl-small" style={{ margin: '0 0 0.35rem' }}><strong>3. How should simulated trades be approved?</strong></p>
            <select
              value={approvalMode}
              onChange={(e) => setApprovalMode(e.target.value)}
              aria-label="Approval mode"
              data-testid="personal-approval-mode"
              style={{ maxWidth: '100%' }}
            >
              {(d.options?.approvalModes || []).map((mode) => (
                <option key={mode.id} value={mode.id}>{mode.label}</option>
              ))}
            </select>
          </div>

          {saveError && (
            <p className="tl-small tl-neg" role="alert" style={{ margin: '0 0 0.5rem' }}>{saveError}</p>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="tl-btn tl-btn--primary"
              disabled={saving}
              onClick={() => handleSave(true)}
              data-testid="personal-trader-save-btn"
            >
              {saving ? 'Saving…' : d.configured ? 'Save preferences' : 'Activate Personal AI Trader'}
            </button>
            {editing && (
              <button type="button" className="tl-btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
