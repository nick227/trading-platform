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

/** Create-only: one visible form, no timeline, editorial card, step editors or mandatory backtest. */
export default function SimpleCreateBot() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { brokerStatus, brokerStatusLoading, brokerStatusError } = useAuth()
  const mode = getTradingMode(brokerStatus, { loading: brokerStatusLoading, error: brokerStatusError })
  const simulated = isSimulated(brokerStatus)
  const tradableSymbols = Array.isArray(brokerStatus?.tradableSymbols) && brokerStatus.tradableSymbols.length ? brokerStatus.tradableSymbols : null
  const pinnedTicker = params.get('ticker') || params.get('symbol')
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
      const selected = wd.templates.find(t => t.id === templateQuery && t.available)
        || wd.templates.find(t => t.available)
      if (!selected) { setLoadError(wd.catalogError || 'No available strategies.'); return }
      setTemplate(selected)
      setDraft(initCreateDraft(selected, wd, pinnedTicker))
    }).catch(() => live && setLoadError('Bot setup is unavailable.'))
    return () => { live = false }
  }, []) // Intentional: preserve user edits if query parameters change while the form is open.

  const builtBot = useMemo(() => draft ? buildBotFromDraft(draft, template || {}) : null, [draft, template])
  const errors = useMemo(() => draft ? validateBuilderDraft(draft, { buyingPower: data?.buyingPower ?? null, tradableSymbols }) : {}, [draft, data?.buyingPower, tradableSymbols])
  const patch = (key, value) => {
    setServerErrors(current => ({ ...current, [key]: null }))
    setDraft(current => ({ ...current, [key]: value }))
  }
  const fieldError = key => serverErrors[key] || (touched ? errors[key] : null)
  const presentation = template && strategyPresentation(template)
  const guards = builtBot ? describeGuards(builtBot) : []

  const changeTemplate = id => {
    const next = data.templates.find(item => item.id === id && item.available)
    if (!next) return
    setTemplate(next)
    setDraft(initCreateDraft(next, data, pinnedTicker))
    setParams({ template: id, ...(pinnedTicker ? { ticker: pinnedTicker } : {}) }, { replace: true })
    setTouched(false)
    setServerErrors({})
    setSubmitError(null)
  }

  const handleSubmit = async event => {
    event.preventDefault()
    setTouched(true)
    setSubmitError(null)
    if (Object.keys(errors).length) {
      const first = ['name', 'symbols', 'triggerPrice', 'minScore', 'maxAgeHours', 'maxDriftPct', 'capital', 'maxPerOrder', 'cooldown', 'positionLimit', 'dailyLoss', 'exit', 'relVolume', 'priceChange'].find(key => errors[key])
      formRef.current?.querySelector(`[data-error-field="${first}"] input, [data-error-field="${first}"] select`)?.focus()
      return
    }
    if (mode !== 'paper' || !data?.portfolioId || (!simulated && !draft.confirmed)) return
    setSaving(true)
    try {
      const result = await createBotConfiguration({ portfolioId: data.portfolioId, templateId: draft.templateId,
        draft, originalTemplate: template, api: { post } })
      navigate(`/bots/${result?.id || result?.botId}`, { state: { created: true } })
    } catch (error) {
      const mapped = mapServerValidationError(error, formatDesiredRules(draft, template?.rules || []))
      setServerErrors(mapped.fieldErrors || {})
      setSubmitError(mapped.message || 'Bot could not be created.')
    } finally {
      setSaving(false)
    }
  }

  if (loadError) return <main className="tl-page tl-simple-builder"><Link to="/bots" className="tl-back">← My Bots</Link><div role="alert">{loadError}</div></main>
  if (!draft || !template || !data) return <main className="tl-page tl-simple-builder" role="status">Loading bot setup…</main>

  const trigger = draft.triggerType
  const isResearch = trigger === 'alpha_research'
  const restricted = mode !== 'paper' || !data.portfolioId
  return <main className="tl-page tl-simple-builder" data-testid="algorithm-builder">
    <Link to="/bots" className="tl-back">← My Bots</Link>
    <header className="tl-simple-builder__heading">
      <h1>Create bot</h1>
      <span className="tl-small tl-muted">Simulated trading</span>
    </header>
    {restricted && <div className="tl-notice tl-notice--warn" role="status">
      Bot activation requires an available paper trading account. <Link to="/profile">Account settings</Link>
    </div>}
    {data.portfolioError && <div className="tl-notice tl-notice--warn" role="alert">{data.portfolioError}</div>}
    <form ref={formRef} onSubmit={handleSubmit} noValidate>
      <section className="tl-simple-builder__section" aria-labelledby="create-strategy-title">
        <h2 id="create-strategy-title">Strategy</h2>
        <Field label="Trading strategy">
          {({ id }) => <Select id={id} data-testid="template-select" value={template.id}
            onChange={e => changeTemplate(e.target.value)}>
            {data.templates.map(item => <option value={item.id} key={item.id} disabled={!item.available}>
              {strategyPresentation(item).name}{!item.available ? ' (unavailable)' : ''}
            </option>)}
          </Select>}
        </Field>
        <p className="tl-simple-builder__help">{presentation.description}</p>
        <div data-error-field="name"><Field label="Bot name" error={fieldError('name')}>
          {({ id, 'aria-invalid': invalid, 'aria-describedby': describedby }) =>
            <Input id={id} value={draft.name} aria-invalid={invalid} aria-describedby={describedby}
              onChange={e => patch('name', e.target.value)} />}
        </Field></div>
      </section>

      <section className="tl-simple-builder__section" aria-labelledby="create-stocks-title">
        <h2 id="create-stocks-title">Stocks</h2>
        <div data-error-field="symbols"><Field label="Stock symbols" error={fieldError('symbols')}
          help={tradableSymbols ? `Available in this simulated account: ${tradableSymbols.join(', ')}` : 'Separate symbols with commas.'}>
          {({ id, 'aria-invalid': invalid, 'aria-describedby': describedby }) =>
            <Input id={id} value={draft.symbolsText} placeholder="SPY, AAPL" aria-invalid={invalid}
              aria-describedby={describedby} onChange={e => patch('symbolsText', e.target.value)} />}
        </Field></div>
      </section>

      <section className="tl-simple-builder__section" aria-labelledby="create-trigger-title">
        <h2 id="create-trigger-title">Trading conditions</h2>
        <Field label="When to trade">
          {({ id }) => <Select id={id} value={trigger} onChange={e => setDraft(current => ({
            ...current, triggerType: e.target.value,
            trigger: current.trigger?.price ? current.trigger : { operator: current.direction === 'sell' ? 'below' : 'above', price: '' },
            research: e.target.value === 'alpha_research' && !current.research
              ? { minScore: '60', maxAgeHours: '96', maxDriftPct: '5', requireEdge: true } : current.research,
          }))}>
            <option value="price_threshold">Stock reaches a price</option>
            <option value="schedule">On a regular schedule</option>
            <option value="alpha_research">When Alpha Engine publishes qualifying research</option>
            {draft.fixed.some(rule => rule.type === 'trend_filter') && <option value="trend_filter">When market trend is confirmed</option>}
          </Select>}
        </Field>
        {trigger === 'price_threshold' && <div className="tl-simple-builder__columns">
          <Field label="Condition">{({ id }) => <Select id={id} value={draft.trigger?.operator || 'above'}
            onChange={e => setDraft(current => ({ ...current, trigger: { ...current.trigger, operator: e.target.value } }))}>
            <option value="above">Price rises above</option><option value="below">Price falls below</option>
          </Select>}</Field>
          <div data-error-field="triggerPrice"><Field label="Trigger price ($)" error={fieldError('triggerPrice')}>
            {({ id, 'aria-invalid': invalid }) => <Input id={id} inputMode="decimal" value={draft.trigger?.price ?? ''}
              aria-invalid={invalid} onChange={e => {
                setServerErrors(current => ({ ...current, triggerPrice: null }))
                setDraft(current => ({ ...current, trigger: { ...current.trigger, price: e.target.value } }))
              }} />}
          </Field></div>
        </div>}
        {isResearch && <div className="tl-simple-builder__columns tl-simple-builder__columns--three">
          {[
            ['minScore', 'Minimum research score (0–100)'],
            ['maxAgeHours', 'Maximum research age (hours)'],
            ['maxDriftPct', 'Maximum price drift (%)'],
          ].map(([key, label]) => <div key={key} data-error-field={key}>
            <Field label={label} error={fieldError(key)}>
              {({ id, 'aria-invalid': invalid }) => <Input id={id} inputMode="decimal" value={draft.research?.[key] ?? ''}
                aria-invalid={invalid} onChange={e => setDraft(current => ({ ...current,
                  research: { ...current.research, [key]: e.target.value } }))} />}
            </Field>
          </div>)}
          <p className="tl-simple-builder__rule">Research must pass the existing independent evidence check before trading.</p>
        </div>}
        <Field label="Order direction">{({ id }) => <Select id={id} value={draft.direction ?? 'research'}
          onChange={e => patch('direction', e.target.value === 'research' ? null : e.target.value)}>
          {isResearch && <option value="research">Follow research (buy and sell)</option>}
          <option value="buy">Buy</option><option value="sell">Sell</option>
        </Select>}</Field>
      </section>

      <section className="tl-simple-builder__section" aria-labelledby="create-money-title">
        <h2 id="create-money-title">Investment limits</h2>
        <div className="tl-simple-builder__columns">
          <div data-error-field="capital"><Field label="Capital allocated ($)" error={fieldError('capital')}>
            {({ id, 'aria-invalid': invalid }) => <Input id={id} inputMode="decimal" value={draft.capital}
              aria-invalid={invalid} onChange={e => patch('capital', e.target.value)} />}
          </Field></div>
          <div data-error-field="maxPerOrder"><Field label="Maximum per order ($)" error={fieldError('maxPerOrder')}>
            {({ id, 'aria-invalid': invalid }) => <Input id={id} inputMode="decimal" value={draft.maxPerOrder}
              aria-invalid={invalid} onChange={e => patch('maxPerOrder', e.target.value)} />}
          </Field></div>
        </div>
        {guards.length > 0 && <div className="tl-simple-builder__limits">
          <h3>Additional trading limits</h3>
          <ul>{guards.filter(text => !text.includes('simulated capital') && !text.includes('per order')).map(text => <li key={text}>{text}</li>)}</ul>
        </div>}
      </section>

      <section className="tl-simple-builder__section tl-simple-builder__review" aria-labelledby="create-review-title">
        <h2 id="create-review-title">Review</h2>
        <p data-testid="builder-summary">{builtBot ? describeAction(builtBot) : ''}</p>
        <p className="tl-small tl-muted">{parseSymbols(draft.symbolsText).join(', ') || 'No symbols selected'} ·
          ${Number(draft.capital || 0).toLocaleString()} allocated ·
          ${Number(draft.maxPerOrder || 0).toLocaleString()} maximum per order</p>
      </section>

      {!simulated && mode === 'paper' && <label className="tl-simple-builder__confirm">
        <input type="checkbox" checked={draft.confirmed} onChange={e => patch('confirmed', e.target.checked)} />
        I understand this bot will place orders automatically in my paper account.
      </label>}
      {submitError && <div className="tl-notice tl-notice--error" role="alert" data-testid="submit-error">{submitError}</div>}
      <footer className="tl-simple-builder__actions">
        <Link to="/bots" className="tl-btn tl-btn--secondary">Cancel</Link>
        <button type="submit" className="tl-btn tl-btn--primary" data-testid="submit-builder-btn"
          disabled={saving || restricted || (!simulated && !draft.confirmed)}>
          {saving ? 'Starting…' : 'Start bot'}
        </button>
      </footer>
    </form>
  </main>
}
