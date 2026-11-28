import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { post } from '../../../api/client'
import { useAuth } from '../../../app/AuthProvider'
import { getTradingMode, isSimulated } from '../../../components/ModeBadge'
import { Field, Input, Select } from '../../../components/ui/Field'
import { describeAction, describeGuards } from '../../../ui/describeBot'
import { buildBotFromDraft, createBotConfiguration, formatDesiredRules, initCreateDraft, mapServerValidationError, validateBuilderDraft } from './builderModel'
import { loadWizardData, parseSymbols } from './builderData'
import { strategyPresentation } from '../strategyPresentation'
import './simple-create-bot.css'

const amount = value => '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
const numeric = value => String(value ?? '').replace(/[^0-9.]/g, '')

/** Only a genuine template stock universe or an account-provided universe can be selected. */
export function initializeTemplateDraft(template, data, eligibleSymbols, requestedTicker) {
  const tickers = Array.isArray(template.config?.tickers) ? template.config.tickers.map(s => String(s).toUpperCase()) : []
  const eligible = Array.isArray(eligibleSymbols) ? eligibleSymbols.map(s => String(s).toUpperCase()) : []
  const selected = requestedTicker && tickers.includes(requestedTicker.toUpperCase())
    ? requestedTicker.toUpperCase() : tickers.length ? null
      : requestedTicker && eligible.includes(requestedTicker.toUpperCase()) ? requestedTicker.toUpperCase()
        : eligible.length === 1 ? eligible[0] : null
  const draft = initCreateDraft(template, data, selected)
  // Templates with a predefined universe are not silently transformed by the account UI.
  if (!tickers.length && !selected) draft.symbolsText = ''
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

  const preview = useMemo(() => draft && template ? buildBotFromDraft(draft, template) : null, [draft, template])
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

  const presets = Array.isArray(template.config?.tickers) ? template.config.tickers : []
  const noUniverse = !presets.length && !eligibleSymbols.length
  const hasPrice = draft.triggerType === 'price_threshold'
  const hasResearch = draft.triggerType === 'alpha_research'
  const modeBlocked = mode !== 'paper'
  const blocked = modeBlocked || !data.portfolioId || noUniverse
  const presentation = strategyPresentation(template)
  const settings = []
  if (hasPrice) settings.push({
    field: 'triggerPrice', label: 'Trigger price ($)', value: draft.trigger?.price,
    help: 'The stock price that activates this template’s ' + (draft.trigger.operator === 'below' ? 'below-price' : 'above-price') + ' condition.',
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
    value: draft.priceChange.pct, help: 'Measured over ' + draft.priceChange.sessions + ' trading sessions.',
    update: value => changeNested('priceChange', 'pct', value),
  })
  if (draft.exit?.stopLoss?.on) settings.push({
    field: 'exit', label: 'Sell after a decline from purchase price (%)',
    value: draft.exit.stopLoss.pct,
    update: value => setDraft(old => ({ ...old, exit: { ...old.exit, stopLoss: { ...old.exit.stopLoss, pct: value } } })),
  })
  if (draft.exit?.reversal?.on) settings.push({
    field: 'exitReversal', label: 'Sell after a price reversal (%)',
    value: draft.exit.reversal.pct, help: 'Measured over ' + draft.exit.reversal.sessions + ' sessions.',
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
        <p className="tl-simple-builder__help">{presentation.description}</p>
        <div className="tl-simple-builder__facts">
          <div><strong>Stocks</strong>
            {presets.length > 0 ? <p data-testid="strategy-stocks">{presets.join(', ')}</p> :
              eligibleSymbols.length > 0 ? <div data-error-field="symbols"><Field label="Choose a supported stock" error={fieldError('symbols')}>
                {({ id }) => <Select id={id} value={draft.symbolsText}
                  onChange={e => change('symbolsText', e.target.value)}>
                  <option value="">Select a stock</option>
                  {eligibleSymbols.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>}</Field></div> :
                <p role="alert">This strategy has no defined stocks and the account has no supported stock list.</p>}
          </div>
          <div><strong>Trading condition</strong><p>{
            hasPrice ? 'Trade when a stock price moves ' + (draft.trigger.operator === 'below' ? 'below' : 'above') + ' the specified dollar price.' :
            hasResearch ? 'Trade using qualifying Alpha Engine research.' :
            draft.triggerType === 'trend_filter' ? 'Trade when the strategy’s market trend condition is met.' :
            'Use the strategy’s recurring trading schedule.'
          }</p></div>
        </div>
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
        <p className="tl-simple-builder__help">Each order is capped at {amount(draft.maxPerOrder)} by this strategy's existing safeguards. Increasing your allocation does not increase this per-order cap.</p>
        {fieldError('maxPerOrder') && <p role="alert" className="tl-field-error">{fieldError('maxPerOrder')}</p>}
      </section>

      <section className="tl-simple-builder__section" aria-labelledby="settings-heading">
        <div className="tl-simple-builder__section-head">
          <div><h2 id="settings-heading">Strategy settings</h2><p>These are the strategy’s current trigger values. You can adjust supported values before adding your bot.</p></div>
        </div>
        {hasPrice && <p className="tl-simple-builder__help">The default condition is <strong>{draft.trigger.operator === 'below' ? 'below' : 'above'}</strong> the target price.</p>}
        {settings.length ? <div className="tl-simple-builder__settings">
          {settings.map(s => <NumberSetting key={s.field} field={s.field} label={s.label} value={s.value}
            error={fieldError(s.field === 'exitReversal' ? 'exit' : s.field)} help={s.help} onChange={s.update} />)}
        </div> : <p className="tl-simple-builder__help">This strategy has no adjustable trigger values. Its existing trading conditions will be used.</p>}
        {hasResearch && <p className="tl-simple-builder__help">Research must pass the independent evidence requirement. This protection cannot be disabled.</p>}
        <div className="tl-simple-builder__limits">
          <h3>Other conditions and protections</h3>
          <ul>{describeGuards(preview).map(text => <li key={text}>{text}</li>)}</ul>
        </div>
      </section>

      <section className="tl-simple-builder__section tl-simple-builder__review" aria-labelledby="review-heading">
        <h2 id="review-heading">Review</h2>
        <p data-testid="builder-summary">{describeAction(preview)}</p>
        <p className="tl-simple-builder__help">{amount(draft.capital)} allocated · maximum {amount(draft.maxPerOrder)} per order</p>
      </section>
      {mode === 'paper' && !simulated && <label className="tl-simple-builder__confirm">
        <input type="checkbox" checked={draft.confirmed} onChange={e => change('confirmed', e.target.checked)} />
        I understand this bot will place orders automatically in my paper account.
      </label>}
      <p className="tl-simple-builder__account">Account: {mode === 'paper' ? 'Paper trading' :
        mode === 'live-disabled' ? 'Live trading unavailable' : 'Not verified'}</p>
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
