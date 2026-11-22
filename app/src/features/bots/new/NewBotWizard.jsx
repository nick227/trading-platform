import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../app/AuthProvider'
import { getTradingMode, isSimulated } from '../../../components/ModeBadge'
import RuleEditor, { draftFromBot, draftToBot, validateDraft } from '../../../ui/RuleEditor'
import { describeAction, describeGuards, isResearchBot } from '../../../ui/describeBot'
import { money, sessionDate } from '../../../ui/format'
import {
  createAndStartBot,
  defaultCapital,
  defaultMaxPerOrder,
  loadWizardData,
  parseSymbols,
  validateAllocation,
  validateControls,
} from './newBotApi'

export const STEPS = [
  { id: 'choose', title: 'Choose a starting point' },
  { id: 'setup', title: 'Symbols & capital' },
  { id: 'rules', title: 'Rules & start' },
]

function StepHeader({ index }) {
  return (
    <div className="wizard-progress" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
      <span className="eyebrow mb-0">Step {index + 1} of {STEPS.length}</span>
      <ol className="wizard-dots" aria-hidden="true">
        {STEPS.map((s, i) => <li key={s.id} className={i <= index ? 'is-done' : ''} />)}
      </ol>
    </div>
  )
}

function FieldError({ id, message }) {
  if (!message) return null
  return <p id={id} className="tl-field-error" role="alert">{message}</p>
}

function ModeNotice({ mode }) {
  if (mode === 'paper' || mode === 'checking') return null
  return (
    <div className="tl-notice tl-notice--warn" role="status" data-testid="mode-notice" style={{ marginBottom: 18 }}>
      <span>
        {mode === 'live-disabled'
          ? 'Your connected account is a live account. Live trading is disabled, so bots can only run on a paper account. '
          : mode === 'unknown'
            ? 'We couldn’t check your trading account right now. You can look around; starting a bot needs a working account. '
            : 'Connect a paper trading account to start a bot. You can still look around first. '}
        <Link to="/profile">Account settings</Link>
      </span>
    </div>
  )
}

function MoneyField({ id, label, value, onChange, onBlur, error, help }) {
  return (
    <div className="tl-field">
      <label className="tl-label" htmlFor={id}>{label}</label>
      <div className="tl-input-prefix"><span aria-hidden="true">$</span>
        <input id={id} className="tl-input" inputMode="decimal" value={value} aria-invalid={Boolean(error)} aria-describedby={`${id}-help ${id}-error`}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} onBlur={onBlur} />
      </div>
      {help && <p id={`${id}-help`} className="tl-help">{help}</p>}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

export default function NewBotWizard() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { brokerStatus, brokerStatusLoading, brokerStatusError } = useAuth()
  const mode = getTradingMode(brokerStatus, { loading: brokerStatusLoading, error: brokerStatusError })
  const simulated = isSimulated(brokerStatus)
  const pinnedTicker = params.get('ticker')

  const [data, setData] = useState(null)
  const [form, setForm] = useState({ templateId: params.get('template') ?? null, symbolsText: '', capital: '', maxPerOrder: '', name: '', confirmed: false })
  const [draft, setDraft] = useState(null)
  const [touched, setTouched] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const headingRef = useRef(null)
  const preselected = useRef(Boolean(params.get('template')))

  useEffect(() => {
    let cancelled = false
    loadWizardData().then((d) => { if (!cancelled) setData(d) })
    return () => { cancelled = true }
  }, [])

  const template = useMemo(() => data?.templates.find((t) => t.id === form.templateId && t.available) ?? null, [data, form.templateId])

  // Template-dependent defaults, filled once per chosen starting point.
  useEffect(() => {
    if (!template || !data) return
    const symbols = pinnedTicker ? pinnedTicker.toUpperCase() : template.tickers.join(', ')
    const cap = defaultCapital(template, data.buyingPower ?? null)
    setForm((f) => ({
      ...f,
      symbolsText: symbols,
      capital: String(cap),
      maxPerOrder: String(defaultMaxPerOrder(template, cap)),
      name: `${template.name}${parseSymbols(symbols)[0] ? ` · ${parseSymbols(symbols)[0]}` : ''}`,
      confirmed: false,
    }))
    setDraft(draftFromBot({ config: template.config, rules: template.rules }))
    setTouched({})
  }, [template?.id, data]) // eslint-disable-line react-hooks/exhaustive-deps

  const symbols = parseSymbols(form.symbolsText)
  const capitalNum = form.capital === '' ? null : Number(form.capital)
  const setupErrors = template
    ? {
        ...validateAllocation({ capital: form.capital, symbolsText: form.symbolsText }, { buyingPower: data?.buyingPower ?? null, templateTickers: [] }),
        ...validateControls({ maxPerOrder: form.maxPerOrder, name: form.name }, { capital: Number.isFinite(capitalNum) ? capitalNum : null }),
      }
    : {}
  const ruleErrors = draft ? validateDraft(draft) : {}
  const noCash = data?.buyingPower !== null && data?.buyingPower !== undefined && data.buyingPower <= 0

  const reachable = !template ? 0 : Object.keys(setupErrors).length > 0 || noCash ? 1 : 2
  // A starting point preselected by link (Bots → "Start from this") opens at step 2;
  // choosing one on step 1 waits for Continue.
  const requestedId = params.get('step') ?? (preselected.current && template ? 'setup' : 'choose')
  const requested = Math.max(0, STEPS.findIndex((s) => s.id === requestedId))
  const stepIndex = Math.min(requested, reachable)
  const step = STEPS[stepIndex].id

  useEffect(() => { headingRef.current?.focus() }, [stepIndex])

  const update = (patch) => setForm((f) => ({ ...f, ...patch }))
  const goTo = (index) => {
    const next = new URLSearchParams(params)
    next.set('step', STEPS[index].id)
    setParams(next)
  }
  const selectTemplate = (t) => { if (t.available && t.id !== form.templateId) update({ templateId: t.id }) }

  const continueFrom = (index) => {
    if (index === 1) {
      setTouched({ capital: true, symbols: true, maxPerOrder: true, name: true })
      if (Object.keys(setupErrors).length > 0 || noCash) return
    }
    goTo(index + 1)
  }

  const built = template && draft ? draftToBot(draft, { config: { ...template.config, tickers: symbols, allocatedAmount: capitalNum, maxOrderNotional: Number(form.maxPerOrder) }, rules: template.rules }) : null
  const needsConfirm = !simulated

  const submit = async () => {
    setTouched((t) => ({ ...t, rules: true }))
    if (Object.keys(ruleErrors).length > 0) return
    if ((needsConfirm && !form.confirmed) || submitting || mode !== 'paper' || !data?.portfolioId) return
    setSubmitting(true)
    setSubmitError(null)
    const result = await createAndStartBot({
      template,
      portfolioId: data.portfolioId,
      name: form.name.trim(),
      tickers: symbols,
      capital: capitalNum,
      maxPerOrder: Number(form.maxPerOrder),
      rules: built.rules.map(({ id: _id, ...r }) => r),
      researchConfig: isResearchBot(template.config) ? built.config.research : undefined,
    })
    setSubmitting(false)
    if (result.ok) navigate(`/bots/${result.botId}`, { replace: true, state: { created: true, from: 'bots' } })
    else setSubmitError({ message: result.message, botId: result.botId ?? null })
  }

  if (!data) {
    return (
      <main className="tl-page wizard" aria-busy="true">
        <div className="wizard-skeleton" data-testid="wizard-loading" />
      </main>
    )
  }

  return (
    <main className="tl-page wizard">
      <StepHeader index={stepIndex} />
      <h1 className="wizard-title" tabIndex={-1} ref={headingRef}>{STEPS[stepIndex].title}</h1>
      <ModeNotice mode={mode} />

      {step === 'choose' && (
        <section aria-label="Starting points">
          <p className="tl-muted" style={{ marginTop: 0 }}>Each starting point preloads conditions. You’ll pick the symbols and capital next, and can change every rule before you start.</p>
          {data.catalogError ? (
            <div className="tl-notice tl-notice--error" role="alert">
              {data.catalogError} <button type="button" className="tl-link-btn" onClick={() => { setData(null); loadWizardData().then(setData) }}>Retry</button>
            </div>
          ) : (
            <ul className="wizard-options" role="radiogroup" aria-label="Starting points">
              {data.templates.map((t) => {
                const selected = t.id === form.templateId && t.available
                return (
                  <li key={t.id}>
                    <button type="button" role="radio" aria-checked={selected} aria-disabled={!t.available} disabled={!t.available}
                      className={`wizard-option ${selected ? 'is-selected' : ''}`} onClick={() => selectTemplate(t)} data-testid={`template-${t.id}`}>
                      <span className="wizard-option-name">{t.name}</span>
                      <span className="wizard-option-desc">{describeAction(t, { template: true })}</span>
                      {!t.available && <span className="wizard-option-meta tl-muted">{t.unavailableReason}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="tl-small tl-muted">See each starting point’s conditions, research and results on <Link to="/bots">Bots</Link>.</p>
        </section>
      )}

      {step !== 'choose' && template && (
        <p className="tl-small tl-muted" style={{ margin: '-4px 0 18px' }}>
          Starting from <strong className="tl-ink">{template.name}</strong> · <button type="button" className="tl-link-btn tl-small" onClick={() => goTo(0)}>Change</button>
        </p>
      )}

      {step === 'setup' && template && (
        <section>
          <div className="tl-field">
            <label className="tl-label" htmlFor="symbols">Symbols</label>
            <input id="symbols" className="tl-input" placeholder="e.g. AAPL, MSFT" value={form.symbolsText}
              onChange={(e) => update({ symbolsText: e.target.value })} onBlur={() => setTouched((t) => ({ ...t, symbols: true }))}
              aria-invalid={Boolean(touched.symbols && setupErrors.symbols)} aria-describedby="symbols-help symbols-error" />
            <p id="symbols-help" className="tl-help">{isResearchBot(template.config) ? 'The bot acts only on symbols that have current Alpha Engine research.' : 'Separate several symbols with commas.'}</p>
            <FieldError id="symbols-error" message={touched.symbols ? setupErrors.symbols : null} />
          </div>
          <MoneyField id="capital" label="Simulated capital for this bot" value={form.capital} onChange={(v) => update({ capital: v })}
            onBlur={() => setTouched((t) => ({ ...t, capital: true }))} error={touched.capital ? setupErrors.capital : null}
            help={<span data-testid="buying-power">{simulated ? 'Simulated cash available' : 'Paper buying power'}: {money(data.buyingPower)}. Capital isn’t set aside — it caps what the bot may spend.</span>} />
          {noCash && <div className="tl-notice tl-notice--warn" role="alert" style={{ marginTop: 12 }}>Your account has no cash available, so this bot couldn’t buy anything.</div>}
          <MoneyField id="maxPerOrder" label="Most it can spend on one order" value={form.maxPerOrder} onChange={(v) => update({ maxPerOrder: v })}
            onBlur={() => setTouched((t) => ({ ...t, maxPerOrder: true }))} error={touched.maxPerOrder ? setupErrors.maxPerOrder : null} />
          <div className="tl-field">
            <label className="tl-label" htmlFor="name">Bot name</label>
            <input id="name" className="tl-input" value={form.name} onChange={(e) => update({ name: e.target.value })} onBlur={() => setTouched((t) => ({ ...t, name: true }))} aria-describedby="name-error" />
            <FieldError id="name-error" message={touched.name ? setupErrors.name : null} />
          </div>
        </section>
      )}

      {step === 'rules' && template && draft && built && (
        <section>
          <RuleEditor value={draft} onChange={setDraft} errors={touched.rules ? ruleErrors : {}} direction={template.config.direction ?? 'buy'} idPrefix="new" />
          <aside className="wizard-preview" aria-label="Summary" data-testid="bot-preview">
            <div className="wizard-preview-label">{form.name.trim() || template.name} will</div>
            <p>{describeAction(built)}</p>
            <ul>{describeGuards(built).map((g) => <li key={g}>{g}</li>)}</ul>
            <p className="tl-small tl-muted" style={{ margin: '10px 0 0', fontWeight: 450 }} data-testid="review-summary">
              {mode !== 'paper' ? 'No account connected.' : simulated ? `Simulated money — fills replay the ${sessionDate(brokerStatus.session)} close; no broker orders.` : 'Paper trading (simulated money).'} Pause it anytime from Home or the bot’s page.
            </p>
          </aside>
          {needsConfirm && (
            <label className="wizard-confirm">
              <input type="checkbox" checked={form.confirmed} onChange={(e) => update({ confirmed: e.target.checked })} />
              <span>I understand this bot will place orders automatically in my paper account.</span>
            </label>
          )}
          {!data.portfolioId && <div className="tl-notice tl-notice--error" role="alert" style={{ marginTop: 12 }}>{data.portfolioError ?? 'Your portfolio is unavailable.'} Reload the page to try again.</div>}
          {submitError && (
            <div className="tl-notice tl-notice--error" role="alert" data-testid="submit-error" style={{ marginTop: 12 }}>
              <span>{submitError.message}{submitError.botId && <> <Link to={`/bots/${submitError.botId}`}>Open the bot</Link></>}</span>
            </div>
          )}
        </section>
      )}

      <div className="wizard-actions">
        {stepIndex > 0 ? (
          <button type="button" className="tl-btn" onClick={() => goTo(stepIndex - 1)} disabled={submitting}>Back</button>
        ) : (
          <Link to="/bots" className="tl-btn">Cancel</Link>
        )}
        {step === 'rules' ? (
          <button type="button" className="tl-btn tl-btn--primary" onClick={submit}
            disabled={(needsConfirm && !form.confirmed) || submitting || mode !== 'paper' || !data.portfolioId || Boolean(submitError?.botId)}>
            {submitting ? 'Starting…' : 'Start bot'}
          </button>
        ) : (
          <button type="button" className="tl-btn tl-btn--primary" onClick={() => continueFrom(stepIndex)} disabled={(step === 'choose' && !template) || (step === 'setup' && noCash)}>
            Continue
          </button>
        )}
      </div>
    </main>
  )
}
