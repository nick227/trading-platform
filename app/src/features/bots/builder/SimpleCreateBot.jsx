import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { post } from '../../../api/client'
import { useAuth } from '../../../app/AuthProvider'
import { getTradingMode, isSimulated } from '../../../components/ModeBadge'
import { Field, Input, Select } from '../../../components/ui/Field'
import { buildBotFromDraft, createBotConfiguration, formatDesiredRules, initCreateDraft, mapServerValidationError, validateBuilderDraft } from './builderModel'
import { loadWizardData } from './builderData'
import { strategyPresentation } from '../strategyPresentation'
import './simple-create-bot.css'

const amount = value => '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
const numeric = value => String(value ?? '').replace(/[^0-9.]/g, '')

/** Account supported tickers take precedence; fall back to the template's actual universe. */
export function supportedStocks(template, eligibleSymbols) {
  const fromAccount = Array.isArray(eligibleSymbols) ? eligibleSymbols : []
  const fromTemplate = Array.isArray(template?.config?.tickers) ? template.config.tickers : []
  return [...new Set((fromAccount.length ? fromAccount : fromTemplate)
    .map(ticker => String(ticker).toUpperCase().trim()).filter(Boolean))].sort()
}

export function initializeTemplateDraft(template, data, eligibleSymbols, requestedTicker) {
  const choices = supportedStocks(template, eligibleSymbols)
  const preferred = String(requestedTicker || '').toUpperCase()
  const defaultTicker = Array.isArray(template.config?.tickers)
    ? template.config.tickers.map(s => String(s).toUpperCase()).find(ticker => choices.includes(ticker))
    : null
  const selected = choices.includes(preferred) ? preferred : defaultTicker || choices[0] || ''
  const draft = initCreateDraft(template, data, selected || null)
  draft.symbolsText = selected
  draft.name = selected ? `${template.name} · ${selected}` : template.name
  return draft
}

function NumberSetting({ label, value, error, onChange, help, field }) {
  return <div data-error-field={field}>
    <Field label={label} error={error || null} help={help}>
      {({ id, 'aria-invalid': invalid, 'aria-describedby': describedby }) =>
        <Input id={id} inputMode="decimal" value={String(value ?? '')}
          aria-invalid={invalid} aria-describedby={describedby}
          onChange={e => onChange(numeric(e.target.value))} />}
    </Field>
  </div>
}

export default function SimpleCreateBot() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { brokerStatus, brokerStatusLoading, brokerStatusError } = useAuth()
  const mode = getTradingMode(brokerStatus, { loading: brokerStatusLoading, error: brokerStatusError })
  const simulated = isSimulated(brokerStatus)
  const eligibleSymbols = Array.isArray(brokerStatus?.tradableSymbols) ? brokerStatus.tradableSymbols : []
  const tickerQuery = (params.get('ticker') || params.get('symbol') || '').toUpperCase()
  const templateQuery = params.get('template') || params.get('strategy')
  const [data, setData] = useState(null)
  const [template, setTemplate] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverErrors, setServerErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const formRef = useRef(null)

  useEffect(() => {
    let live = true
    loadWizardData().then(wd => {
      if (!live) return
      setData(wd)
      const next = wd.templates.find(item => item.id === templateQuery && item.available)
        || wd.templates.find(item => item.available)
      if (!next) { setLoadError(wd.catalogError || 'No strategies are currently available.'); return }
      setTemplate(next)
      setDraft(initializeTemplateDraft(next, wd, brokerStatus?.tradableSymbols, tickerQuery))
    }).catch(() => { if (live) setLoadError('Unable to load available strategies.') })
    return () => { live = false }
  }, []) // Do not discard a user's edits on account-provider re-renders.

  const stockOptions = useMemo(() => supportedStocks(template, brokerStatus?.tradableSymbols), [template, brokerStatus?.tradableSymbols])
  const errors = useMemo(() => draft ? validateBuilderDraft(draft, {
    buyingPower: data?.buyingPower ?? null,
    tradableSymbols: eligibleSymbols.length ? eligibleSymbols : null,
  }) : {}, [draft, data?.buyingPower, brokerStatus?.tradableSymbols])
  const fieldError = key => serverErrors[key] || (touched ? errors[key] : null)
  const change = (key, value) => {
    setServerErrors(old => ({ ...old, [key]: null }))
    setDraft(old => ({ ...old, [key]: value }))
  }
  const changeNested = (key, subKey, value, errorKey = key) => {
    setServerErrors(old => ({ ...old, [errorKey]: null }))
    setDraft(old => ({ ...old, [key]: { ...old[key], [subKey]: value } }))
  }
  const chooseStock = ticker => {
    setServerErrors(old => ({ ...old, symbols: null, name: null }))
    setDraft(old => ({ ...old, symbolsText: ticker, name: `${template.name} · ${ticker}` }))
  }
  const switchTemplate = id => {
    const next = data.templates.find(item => item.id === id && item.available)
    if (!next) return
    setTemplate(next)
    setDraft(initializeTemplateDraft(next, data, brokerStatus?.tradableSymbols, tickerQuery))
    setParams({ template: id }, { replace: true })
    setTouched(false)
    setServerErrors({})
    setSubmitError(null)
  }
  const onCapitalChange = value => {
    const originalLimit = Number(template.config?.maxOrderNotional ?? draft.maxPerOrder)
    setServerErrors(old => ({ ...old, capital: null, maxPerOrder: null }))
    setDraft(old => ({
      ...old,
      capital: numeric(value),
      // Keep the template's per-order cap; never silently increase risk as allocation grows.
      maxPerOrder: String(Math.min(Number.isFinite(originalLimit) && originalLimit > 0 ? originalLimit : Number(old.maxPerOrder), Number(value) || 0)),
    }))
  }

  const handleSubmit = async event => {
    event.preventDefault()
    setTouched(true)
    setSubmitError(null)
    if (Object.keys(errors).length) {
      const first = ['symbols','triggerPrice','minScore','maxAgeHours','maxDriftPct','capital','maxPerOrder',
        'relVolume','priceChange','exit','dailyLoss','positionLimit','cooldown','name'].find(key => errors[key])
      formRef.current?.querySelector('[data-error-field="' + first + '"] input, [data-error-field="' + first + '"] select')?.focus()
      return
    }
    if (mode !== 'paper' || !data?.portfolioId || (!simulated && !draft.confirmed)) return
    setSaving(true)
    try {
      const response = await createBotConfiguration({
        portfolioId: data.portfolioId, templateId: template.id, draft, originalTemplate: template, api: { post },
      })
      navigate('/bots/' + (response?.id || response?.botId), { state: { created: true } })
    } catch (error) {
      const mapped = mapServerValidationError(error, formatDesiredRules(draft, template.rules || []))
      setServerErrors(mapped.fieldErrors || {})
      setSubmitError(mapped.message || 'Bot could not be added.')
    } finally {
      setSaving(false)
    }
  }

  if (loadError) return <main className="tl-page tl-simple-builder"><Link to="/bots" className="tl-back">← My Bots</Link><div role="alert">{loadError}</div></main>
  if (!data || !draft || !template) return <main className="tl-page tl-simple-builder" role="status">Loading strategies…</main>

  const noUniverse = !stockOptions.length
  const hasPrice = draft.triggerType === 'price_threshold'
  const hasResearch = draft.triggerType === 'alpha_research'
  const modeBlocked = mode !== 'paper'
  const blocked = modeBlocked || !data.portfolioId || noUniverse
  const settings = []
  if (hasPrice) settings.push({
    field: 'triggerPrice', label: 'Trigger price ($)', value: draft.trigger?.price,
    help: null,
    update: value => changeNested('trigger', 'price', value, 'triggerPrice'),
  })
  if (hasResearch) {
    settings.push({
      field: 'minScore', label: 'Minimum research score (0–100)', value: draft.research?.minScore,
      update: value => changeNested('research', 'minScore', value, 'minScore'),
    }, {
      field: 'maxAgeHours', label: 'Maximum research age (hours)', value: draft.research?.maxAgeHours,
      update: value => changeNested('research', 'maxAgeHours', value, 'maxAgeHours'),
    }, {
      field: 'maxDriftPct', label: 'Maximum price drift (%)', value: draft.research?.maxDriftPct,
      update: value => changeNested('research', 'maxDriftPct', value, 'maxDriftPct'),
    })
  }
  if (draft.relVolume?.on) settings.push({
    field: 'relVolume', label: 'Minimum relative volume (× 20-day average)',
    value: draft.relVolume.minRatio, update: value => changeNested('relVolume', 'minRatio', value),
  })
  if (draft.priceChange?.on) settings.push({
    field: 'priceChange', label: 'Required ' + (draft.priceChange.operator === 'below' ? 'price decline' : 'price increase') + ' (%)',
    value: draft.priceChange.pct,
    update: value => changeNested('priceChange', 'pct', value),
  })
  if (draft.exit?.stopLoss?.on) settings.push({
    field: 'exit', label: 'Sell after a decline from purchase price (%)',
    value: draft.exit.stopLoss.pct,
    update: value => setDraft(old => ({ ...old, exit: { ...old.exit, stopLoss: { ...old.exit.stopLoss, pct: value } } })),
  })
  if (draft.exit?.reversal?.on) settings.push({
    field: 'exitReversal', label: 'Sell after a price reversal (%)',
    value: draft.exit.reversal.pct,
    update: value => setDraft(old => ({ ...old, exit: { ...old.exit, reversal: { ...old.exit.reversal, pct: value } } })),
  })
  if (draft.dailyLoss?.on) settings.push({
    field: 'dailyLoss', label: 'Stop after daily realized losses ($)',
    value: draft.dailyLoss.maxLoss, update: value => changeNested('dailyLoss', 'maxLoss', value),
  })
  if (draft.positionLimit?.on) settings.push({
    field: 'positionLimit', label: 'Maximum shares per stock',
    value: draft.positionLimit.maxShares, update: value => changeNested('positionLimit', 'maxShares', value),
  })

  return <main className="tl-page tl-simple-builder" data-testid="algorithm-builder">
    <Link to="/bots" className="tl-back">← My Bots</Link>
    <header className="tl-simple-builder__heading"><h1>Add Bot</h1></header>
    {modeBlocked && <div className="tl-notice tl-notice--warn" role="status">
      {mode === 'live-disabled' ? 'Real-money bot activation is not enabled yet.' :
        mode === 'checking' ? 'Checking your trading account.' :
          mode === 'unknown' ? 'Your trading account could not be verified.' :
            'Connect a supported trading account to add a bot.'}{' '}
      <Link to="/profile">Account settings</Link>
    </div>}
    {data.portfolioError && <div className="tl-notice tl-notice--warn" role="alert">{data.portfolioError}</div>}
    <form ref={formRef} noValidate onSubmit={handleSubmit}>
      <section className="tl-simple-builder__section" aria-labelledby="strategy-heading">
        <h2 id="strategy-heading">Strategy</h2>
        <Field label="Choose a strategy">{({ id }) =>
          <Select id={id} data-testid="template-select" value={template.id} onChange={e => switchTemplate(e.target.value)}>
            {data.templates.map(item => <option key={item.id} value={item.id} disabled={!item.available}>
              {strategyPresentation(item).name}{!item.available ? ' (not available yet)' : ''}
            </option>)}
          </Select>}
        </Field>
        <div data-error-field="symbols">
          <Field label="Target stock" error={fieldError('symbols')}>
            {({ id }) => <Select id={id} data-testid="target-stock-select"
              value={draft.symbolsText} onChange={e => chooseStock(e.target.value)}
              disabled={noUniverse}>
              {noUniverse && <option value="">No supported stocks available</option>}
              {stockOptions.map(ticker => <option key={ticker} value={ticker}>{ticker}</option>)}
            </Select>}
          </Field>
        </div>
        {noUniverse && <p role="alert" className="tl-field-error">No supported stocks are available for this account.</p>}
      </section>

      <section className="tl-simple-builder__section" aria-labelledby="allocation-heading">
        <h2 id="allocation-heading">Investment allocation</h2>
        <div className="tl-simple-builder__amount" data-error-field="capital">
          <Field label="Amount to allocate ($)" error={fieldError('capital')}
            help="The total capital this bot may use across its investments.">
            {({ id, 'aria-invalid': invalid, 'aria-describedby': describedby }) =>
              <Input id={id} value={draft.capital} aria-invalid={invalid} aria-describedby={describedby}
                inputMode="decimal" onChange={e => onCapitalChange(e.target.value)} />}
          </Field>
        </div>
        <p className="tl-simple-builder__compact">Per-order limit: {amount(draft.maxPerOrder)}</p>
        {fieldError('maxPerOrder') && <p role="alert" className="tl-field-error">{fieldError('maxPerOrder')}</p>}
      </section>

      <section className="tl-simple-builder__section" aria-labelledby="settings-heading">
        <div className="tl-simple-builder__section-head">
          <h2 id="settings-heading">Strategy settings</h2>
        </div>

        {settings.length ? <div className="tl-simple-builder__settings">
          {settings.map(s => <NumberSetting key={s.field} field={s.field} label={s.label} value={s.value}
            error={fieldError(s.field === 'exitReversal' ? 'exit' : s.field)} help={s.help} onChange={s.update} />)}
        </div> : <p className="tl-simple-builder__compact">Uses the template's preset trading conditions.</p>}
        {hasResearch && <p className="tl-simple-builder__compact">Independent research evidence is required.</p>}

      </section>

      <p className="tl-simple-builder__compact tl-simple-builder__review-line" data-testid="builder-summary">
        {draft.symbolsText || 'No stock selected'} · {amount(draft.capital)} allocated
      </p>
      {mode === 'paper' && !simulated && <label className="tl-simple-builder__confirm">
        <input type="checkbox" checked={draft.confirmed} onChange={e => change('confirmed', e.target.checked)} />
        I understand this bot will place orders automatically in my paper account.
      </label>}
      <p className="tl-simple-builder__account">{mode === 'paper' ? 'Paper trading account' :
        mode === 'live-disabled' ? 'Real-money activation unavailable' : 'Account not verified'}</p>
      {submitError && <div role="alert" className="tl-notice tl-notice--error" data-testid="submit-error">{submitError}</div>}
      <footer className="tl-simple-builder__actions">
        <Link to="/bots" className="tl-btn tl-btn--secondary">Cancel</Link>
        <button type="submit" className="tl-btn tl-btn--primary" data-testid="submit-builder-btn"
          disabled={saving || blocked || (mode === 'paper' && !simulated && !draft.confirmed)}>
          {saving ? 'Adding…' : 'Add bot'}
        </button>
      </footer>
    </form>
  </main>
}
