import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { get, post } from '../../../api/client'
import { useAuth } from '../../../app/AuthProvider'
import ModeBadge, { getTradingMode, isSimulated } from '../../../components/ModeBadge'
import { Field, Input, Select } from '../../../components/ui/Field'
import { describeAction, describeGuards } from '../../../ui/describeBot'
import { buildBotFromDraft, createBotConfiguration, formatDesiredRules, initCreateDraft, mapServerValidationError, validateBuilderDraft } from './builderModel'
import { loadWizardData } from './builderData'
import { strategyPresentation } from '../strategyPresentation'
import './simple-create-bot.css'

const amount = value => '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
const numeric = value => String(value ?? '').replace(/[^0-9.]/g, '')
const needsMarketPrice = template => (template?.rules ?? []).some(rule => rule.type === 'price_threshold' && rule.enabled !== false && !(Number(rule.config?.price) > 0))
const validPrice = value => Number.isFinite(Number(value)) && Number(value) > 0

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

function NumberSetting({ label, value, error, onChange, onBlur, help, placeholder, field }) {
  return <div data-error-field={field}>
    <Field label={label} error={error || null} help={help}>
      {({ id, 'aria-invalid': invalid, 'aria-describedby': describedby }) =>
        <Input id={id} inputMode="decimal" value={String(value ?? '')} placeholder={placeholder}
          aria-invalid={invalid} aria-describedby={describedby}
          onChange={e => onChange(numeric(e.target.value))} onBlur={onBlur} />}
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
  const [quoteDefault, setQuoteDefault] = useState({ status: 'idle', ticker: '', price: null, updatedAt: null })
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
  const marketLinkedPrice = needsMarketPrice(template)
  useEffect(() => {
    const ticker = draft?.symbolsText?.trim()?.toUpperCase()
    if (!template || !marketLinkedPrice || !ticker) {
      setQuoteDefault({ status: 'idle', ticker: '', price: null, updatedAt: null })
      return undefined
    }
    let active = true
    setQuoteDefault({ status: 'loading', ticker, price: null, updatedAt: null })
    // Delayed when typing a ticker to avoid one market request per keystroke.
    const timeout = setTimeout(() => {
      get('/market/quote/' + encodeURIComponent(ticker)).then(quote => {
        if (!active) return
        const price = Number(quote?.price)
        if (!validPrice(price)) throw new Error('Price is unavailable')
        // 2–4 decimal places support ordinary stocks and small-price equities.
        const formatted = String(Number(price.toFixed(price < 1 ? 4 : 2)))
        setQuoteDefault({ status: 'ready', ticker, price: formatted, updatedAt: quote?.updatedAt ?? null })
        setDraft(current => current?.templateId === template.id && current.symbolsText === ticker && !validPrice(current.trigger?.price)
          ? { ...current, trigger: { ...current.trigger, price: formatted } }
          : current)
      }).catch(() => {
        if (active) setQuoteDefault({ status: 'unavailable', ticker, price: null, updatedAt: null })
      })
    }, 120)
    return () => { active = false; clearTimeout(timeout) }
  }, [template?.id, draft?.symbolsText, marketLinkedPrice])
  const preview = useMemo(() => draft && template ? buildBotFromDraft(draft, template) : null, [draft, template])
  const conditions = useMemo(() => preview ? describeGuards(preview).filter(condition =>
    !condition.includes('simulated capital') && !condition.includes('per order')) : [], [preview])
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
    setServerErrors(old => ({ ...old, symbols: null, name: null, triggerPrice: null }))
    setDraft(old => ({
      ...old, symbolsText: ticker, name: `${template.name} · ${ticker}`,
      // A previous stock's absolute trigger must never carry over to a new stock.
      ...(needsMarketPrice(template) ? { trigger: { ...old.trigger, price: '' } } : {}),
    }))
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
  const resetEmptyStock = () => {
    if (draft.symbolsText.trim()) return
    const fallback = initializeTemplateDraft(template, data, brokerStatus?.tradableSymbols, null)
    chooseStock(fallback.symbolsText)
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

  const resetEmptyAmount = () => {
    if (draft.capital !== '') return
    const fallback = initializeTemplateDraft(template, data, brokerStatus?.tradableSymbols, draft.symbolsText)
    onCapitalChange(fallback.capital)
  }
  const resetEmptySetting = (setting) => {
    if (setting.value !== '' && setting.value !== undefined && setting.value !== null) return
    const fallback = initializeTemplateDraft(template, data, brokerStatus?.tradableSymbols, draft.symbolsText)
    const defaults = {
      triggerPrice: fallback.trigger?.price,
      minScore: fallback.research?.minScore,
      maxAgeHours: fallback.research?.maxAgeHours,
      maxDriftPct: fallback.research?.maxDriftPct,
      relVolume: fallback.relVolume?.minRatio,
      priceChange: fallback.priceChange?.pct,
      exit: fallback.exit?.stopLoss?.pct,
      exitReversal: fallback.exit?.reversal?.pct,
      dailyLoss: fallback.dailyLoss?.maxLoss,
      positionLimit: fallback.positionLimit?.maxShares,
    }
    const defaultValue = setting.field === 'triggerPrice' && marketLinkedPrice && quoteDefault.ticker === draft.symbolsText && quoteDefault.status === 'ready'
      ? quoteDefault.price : defaults[setting.field]
    if (defaultValue !== '' && defaultValue !== undefined && defaultValue !== null) setting.update(String(defaultValue))
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

  const hasKnownUniverse = eligibleSymbols.length > 0
  const hasPrice = draft.triggerType === 'price_threshold'
  const hasResearch = draft.triggerType === 'alpha_research'
  const modeBlocked = mode !== 'paper'
  const blocked = modeBlocked || !data.portfolioId
  const settings = []
  if (hasPrice) settings.push({
    field: 'triggerPrice', label: 'Trigger price ($)', value: draft.trigger?.price,
    help: marketLinkedPrice
      ? quoteDefault.status === 'ready' && quoteDefault.ticker === draft.symbolsText
        ? 'From latest available market price' + (quoteDefault.updatedAt ? ' · ' + new Date(quoteDefault.updatedAt).toLocaleDateString() : '')
        : quoteDefault.status === 'unavailable'
          ? 'Stock price unavailable. Enter a trigger price.'
          : 'Getting the latest available stock price…'
      : null,
    placeholder: marketLinkedPrice && quoteDefault.status === 'loading' ? 'Loading stock price…' : 'Enter a price',
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
    <header className="tl-simple-builder__heading">
      <h1>Add Bot</h1>
      <ModeBadge brokerStatus={brokerStatus} loading={brokerStatusLoading} error={brokerStatusError} />
    </header>
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
            {({ id, 'aria-invalid': invalid, 'aria-describedby': describedby }) =>
              hasKnownUniverse
                ? <Select id={id} data-testid="target-stock-select" value={draft.symbolsText}
                    aria-invalid={invalid} aria-describedby={describedby}
                    onChange={e => chooseStock(e.target.value)}>
                    {stockOptions.map(ticker => <option key={ticker} value={ticker}>{ticker}</option>)}
                  </Select>
                : <Input id={id} data-testid="target-stock-input" value={draft.symbolsText}
                    autoComplete="off" spellCheck={false} aria-invalid={invalid} aria-describedby={describedby}
                    onChange={e => chooseStock(e.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, ''))}
                    onBlur={resetEmptyStock} />
            }
          </Field>
        </div>
      </section>

      <section className="tl-simple-builder__section" aria-labelledby="allocation-heading">
        <h2 id="allocation-heading">Investment allocation</h2>
        <p className="tl-simple-builder__balance" data-testid="available-funds" role="status">
          {Number.isFinite(data.buyingPower) && data.buyingPower >= 0
            ? <>Available to trade: <strong>{amount(data.buyingPower)}</strong></>
            : 'Available funds could not be verified.'}
          {' · '}{simulated ? 'Simulation funds' : mode === 'paper' ? 'Paper trading funds' : mode === 'live-disabled' ? 'Real account · trading disabled' : 'Account status not verified'}
        </p>
        <div className="tl-simple-builder__amount" data-error-field="capital">
          <Field label="Amount to allocate ($)" error={fieldError('capital')}
            help="The amount of your account's available funds assigned to this bot. It can place multiple trades within this budget.">
            {({ id, 'aria-invalid': invalid, 'aria-describedby': describedby }) =>
              <Input id={id} value={draft.capital} aria-invalid={invalid} aria-describedby={describedby}
                inputMode="decimal" onChange={e => onCapitalChange(e.target.value)}
                onBlur={resetEmptyAmount} />}
          </Field>
        </div>
        <p className="tl-simple-builder__compact">Maximum for one trade: {amount(draft.maxPerOrder)}</p>
        {fieldError('maxPerOrder') && <p role="alert" className="tl-field-error">{fieldError('maxPerOrder')}</p>}
      </section>

      <section className="tl-simple-builder__section" aria-labelledby="settings-heading">
        <div className="tl-simple-builder__section-head">
          <h2 id="settings-heading">Strategy settings</h2>
        </div>

        <div className="tl-simple-builder__behavior" data-testid="strategy-behavior">
          <h3>When it trades</h3>
          <p data-testid="strategy-action">{describeAction(preview)}</p>
          {conditions.length > 0 && <ul data-testid="strategy-conditions">
            {conditions.map(condition => <li key={condition}>{condition}</li>)}
          </ul>}
        </div>
        {settings.length > 0 && <>
          <h3 className="tl-simple-builder__settings-heading">Settings you can change</h3>
          <div className="tl-simple-builder__settings">
            {settings.map(setting => <NumberSetting key={setting.field} field={setting.field}
              label={setting.label} value={setting.value} onBlur={() => resetEmptySetting(setting)}
              placeholder={setting.placeholder}
              error={fieldError(setting.field === 'exitReversal' ? 'exit' : setting.field)}
              help={setting.help} onChange={setting.update} />)}
          </div>
        </>}

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
          disabled={saving || blocked || (marketLinkedPrice && hasPrice && !validPrice(draft.trigger?.price)) || (mode === 'paper' && !simulated && !draft.confirmed)}>
          {saving ? 'Adding…' : 'Add bot'}
        </button>
      </footer>
    </form>
  </main>
}
