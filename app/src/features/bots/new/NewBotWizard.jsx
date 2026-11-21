import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../app/AuthProvider'
import { getTradingMode } from '../../../components/ModeBadge'
import {
  createAndStartBot,
  defaultCapital,
  defaultMaxPerOrder,
  describeDirection,
  loadWizardData,
  parseSymbols,
  validateAllocation,
  validateControls,
} from './newBotApi'

export const STEPS = [
  { id: 'choose', title: 'Choose a bot' },
  { id: 'allocation', title: 'Simulated capital' },
  { id: 'controls', title: 'Controls' },
  { id: 'review', title: 'Review & start' },
]

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const fmtMoney = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : currency.format(Number(n)))

function describeRule(rule) {
  const c = rule?.config ?? {}
  switch (rule?.type) {
    case 'market_hours': return c.allowPremarket || c.allowAfterHours ? 'Trades in regular and extended hours' : 'Trades only during regular market hours'
    case 'cooldown': {
      const ms = Number(c.windowMs ?? (c.cooldownHours ? c.cooldownHours * 3_600_000 : c.minutes ? c.minutes * 60_000 : NaN))
      if (!Number.isFinite(ms)) return 'Waits between trades'
      const hours = ms / 3_600_000
      return hours >= 24 ? `Waits ${Math.round(hours / 24)} day(s) between trades in a symbol` : `Waits ${Math.round(hours * 10) / 10} hour(s) between trades in a symbol`
    }
    case 'position_limit': return c.maxShares ? `Position limit: ${c.maxShares} shares` : c.maxPositions ? `Position limit: ${c.maxPositions} position(s)` : 'Position limit'
    case 'daily_loss': return c.maxLoss ? `Daily loss limit: ${fmtMoney(c.maxLoss)}` : c.maxDailyLossPct ? `Daily loss limit: ${c.maxDailyLossPct}%` : 'Daily loss limit'
    case 'time_window': return c.start && c.end ? `Trades between ${c.start} and ${c.end} ${c.timezone ?? ''}`.trim() : 'Time window'
    case 'trend_filter': return `Trend filter on ${c.symbol ?? 'SPY'}`
    case 'price_threshold': return 'Price threshold'
    default: return rule?.type ?? 'Rule'
  }
}

function StepHeader({ index }) {
  return (
    <div className="wizard-progress" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
      <span className="eyebrow mb-0">Step {index + 1} of {STEPS.length}</span>
      <ol className="wizard-dots" aria-hidden="true">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i <= index ? 'is-done' : ''} />
        ))}
      </ol>
    </div>
  )
}

function FieldError({ id, message }) {
  if (!message) return null
  return <div id={id} className="text-negative text-xs mt-1" role="alert">{message}</div>
}

function ModeNotice({ mode }) {
  // Nothing to say until the account status is known.
  if (mode === 'paper' || mode === 'checking') return null
  return (
    <div className="alert alert-warn mb-4" role="status" data-testid="mode-notice">
      {mode === 'live-disabled'
        ? 'Your connected account is a live account. Live trading is disabled, so bots can only be created with a paper account. '
        : mode === 'unknown'
          ? 'We couldn’t check your trading account right now. You can look around; starting a bot needs a connected paper account. '
          : 'Connect a paper trading account to create a bot. You can still look around first. '}
      <Link to="/profile/broker">Go to broker settings</Link>
    </div>
  )
}

export default function NewBotWizard() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { brokerStatus, brokerStatusLoading, brokerStatusError } = useAuth()
  const mode = getTradingMode(brokerStatus, { loading: brokerStatusLoading, error: brokerStatusError })

  const [data, setData] = useState(null) // { templates, catalogError, buyingPower, portfolioId, portfolioError }
  const [form, setForm] = useState({
    templateId: params.get('template') ?? null,
    capital: '',
    symbolsText: params.get('ticker') ?? '',
    maxPerOrder: '',
    name: '',
    confirmed: false,
  })
  const [touched, setTouched] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null) // { message, botId? }
  const headingRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    loadWizardData().then((d) => {
      if (!cancelled) setData(d)
    })
    return () => { cancelled = true }
  }, [])

  const template = useMemo(
    () => data?.templates.find((t) => t.id === form.templateId && t.available) ?? null,
    [data, form.templateId]
  )
  const needsSymbols = Boolean(template) && template.tickers.length === 0
  const capitalNum = form.capital === '' ? null : Number(form.capital)
  const symbols = needsSymbols || form.symbolsEdited ? parseSymbols(form.symbolsText) : template?.tickers ?? []

  const allocationErrors = template
    ? validateAllocation(form, { buyingPower: data?.buyingPower ?? null, templateTickers: template.tickers })
    : {}
  const controlsErrors = template
    ? validateControls(
        { maxPerOrder: form.maxPerOrder, name: form.name, symbolsText: form.symbolsEdited ? form.symbolsText : undefined },
        { capital: Number.isFinite(capitalNum) ? capitalNum : null }
      )
    : {}
  const noBuyingPower = data?.buyingPower !== null && data?.buyingPower !== undefined && data.buyingPower <= 0

  // Furthest step whose prerequisites are complete; the URL can't skip past it.
  const reachable = !template
    ? 0
    : Object.keys(allocationErrors).length > 0 || noBuyingPower
      ? 1
      : Object.keys(controlsErrors).length > 0
        ? 2
        : 3
  const requested = Math.max(0, STEPS.findIndex((s) => s.id === params.get('step')))
  const stepIndex = Math.min(requested, reachable)
  const step = STEPS[stepIndex].id

  useEffect(() => {
    headingRef.current?.focus()
  }, [stepIndex])

  const update = (patch) => setForm((f) => ({ ...f, ...patch }))

  const goTo = (index) => {
    const next = new URLSearchParams(params)
    next.set('step', STEPS[index].id)
    setParams(next)
  }

  const selectTemplate = (t) => {
    if (!t.available) return
    if (t.id === form.templateId) return
    // Template-dependent defaults reset when the bot changes; other answers stay.
    update({
      templateId: t.id,
      capital: '',
      maxPerOrder: '',
      name: '',
      symbolsEdited: false,
      symbolsText: t.tickers.length === 0 ? form.symbolsText : t.tickers.join(', '),
      confirmed: false,
    })
  }

  const continueFrom = (index) => {
    if (index === 0 && template && form.capital === '') {
      const cap = defaultCapital(template, data?.buyingPower ?? null)
      update({ capital: String(cap) })
    }
    if (index === 1) {
      setTouched((t) => ({ ...t, capital: true, symbols: true }))
      if (Object.keys(allocationErrors).length > 0 || noBuyingPower) return
      if (form.maxPerOrder === '') update({ maxPerOrder: String(defaultMaxPerOrder(template, capitalNum)) })
      if (form.name === '') update({ name: template.name })
    }
    if (index === 2) {
      setTouched((t) => ({ ...t, maxPerOrder: true, name: true, symbols: true }))
      if (Object.keys(controlsErrors).length > 0) return
    }
    goTo(index + 1)
  }

  const submit = async () => {
    if (!form.confirmed || submitting || mode !== 'paper' || !data?.portfolioId) return
    setSubmitting(true)
    setSubmitError(null)
    const result = await createAndStartBot({
      template,
      portfolioId: data.portfolioId,
      name: form.name.trim(),
      tickers: symbols,
      capital: capitalNum,
      maxPerOrder: Number(form.maxPerOrder),
    })
    setSubmitting(false)
    if (result.ok) {
      navigate(`/bots/${result.botId}`, { replace: true, state: { created: true } })
    } else {
      setSubmitError({ message: result.message, botId: result.botId ?? null })
    }
  }

  if (!data) {
    return (
      <main className="page container wizard" aria-busy="true">
        <div className="card card-pad-md skeleton-block wizard-skeleton" data-testid="wizard-loading" />
      </main>
    )
  }

  return (
    <main className="page container wizard">
      <StepHeader index={stepIndex} />
      <h1 className="wizard-title" tabIndex={-1} ref={headingRef}>{STEPS[stepIndex].title}</h1>
      <ModeNotice mode={mode} />

      {step === 'choose' && (
        <section aria-label="Available bots">
          <p className="muted mt-0">Each bot follows a fixed set of rules from its template. You can pause it anytime.</p>
          {data.catalogError ? (
            <div className="alert alert-error" role="alert">
              {data.catalogError} <button type="button" className="btn btn-xs btn-ghost" onClick={() => { setData(null); loadWizardData().then(setData) }}>Retry</button>
            </div>
          ) : data.templates.length === 0 ? (
            <p className="muted">No bots are available right now.</p>
          ) : (
            <ul className="wizard-options" role="radiogroup" aria-label="Bots">
              {data.templates.map((t) => {
                const selected = t.id === form.templateId && t.available
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-disabled={!t.available}
                      disabled={!t.available}
                      className={`card card-pad-sm wizard-option ${selected ? 'is-selected' : ''}`}
                      onClick={() => selectTemplate(t)}
                      data-testid={`template-${t.id}`}
                    >
                      <span className="wizard-option-name">{t.name}</span>
                      {t.description && <span className="wizard-option-desc">{t.description}</span>}
                      <span className="wizard-option-meta muted">
                        {describeDirection(t.direction)}
                        {' · '}
                        {t.tickers.length > 0 ? `Trades ${t.tickers.slice(0, 5).join(', ')}${t.tickers.length > 5 ? '…' : ''}` : 'You choose the symbols'}
                      </span>
                      {!t.available && <span className="wizard-option-meta text-warning">{t.unavailableReason}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="muted text-xs">Templates don’t include performance history yet, so none is shown.</p>
        </section>
      )}

      {step === 'allocation' && template && (
        <section>
          <p className="mt-0"><strong>{template.name}</strong></p>
          <label className="wizard-label" htmlFor="capital">Simulated capital for this bot</label>
          <div className="wizard-money">
            <span aria-hidden="true">$</span>
            <input
              id="capital"
              className="form-input"
              inputMode="decimal"
              value={form.capital}
              onChange={(e) => update({ capital: e.target.value.replace(/[^0-9.]/g, '') })}
              onBlur={() => setTouched((t) => ({ ...t, capital: true }))}
              aria-invalid={Boolean(touched.capital && allocationErrors.capital)}
              aria-describedby="capital-help capital-error"
            />
          </div>
          <FieldError id="capital-error" message={touched.capital ? allocationErrors.capital : null} />
          <p className="text-sm mt-2" data-testid="buying-power">
            Paper buying power: <strong>{fmtMoney(data.buyingPower)}</strong>
            {data.buyingPower === null && <span className="muted"> (unavailable)</span>}
          </p>
          {noBuyingPower && (
            <div className="alert alert-warn" role="alert">Your paper account has no buying power, so this bot couldn’t place buy orders. Reset or fund your paper account with your broker, then come back.</div>
          )}
          <p id="capital-help" className="muted text-sm">
            This money isn’t set aside. The bot sizes each buy order from this amount, so no single order is bigger than this. Several orders can add up to more.
          </p>

          {needsSymbols && (
            <>
              <label className="wizard-label mt-4" htmlFor="symbols">Symbols to trade</label>
              <input
                id="symbols"
                className="form-input"
                placeholder="e.g. AAPL, MSFT"
                value={form.symbolsText}
                onChange={(e) => update({ symbolsText: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, symbols: true }))}
                aria-invalid={Boolean(touched.symbols && allocationErrors.symbols)}
                aria-describedby="symbols-error"
              />
              <FieldError id="symbols-error" message={touched.symbols ? allocationErrors.symbols : null} />
            </>
          )}
        </section>
      )}

      {step === 'controls' && template && (
        <section>
          <label className="wizard-label" htmlFor="maxPerOrder">Maximum per buy order</label>
          <div className="wizard-money">
            <span aria-hidden="true">$</span>
            <input
              id="maxPerOrder"
              className="form-input"
              inputMode="decimal"
              value={form.maxPerOrder}
              onChange={(e) => update({ maxPerOrder: e.target.value.replace(/[^0-9.]/g, '') })}
              onBlur={() => setTouched((t) => ({ ...t, maxPerOrder: true }))}
              aria-invalid={Boolean(touched.maxPerOrder && controlsErrors.maxPerOrder)}
              aria-describedby="maxPerOrder-error"
            />
          </div>
          <FieldError id="maxPerOrder-error" message={touched.maxPerOrder ? controlsErrors.maxPerOrder : null} />

          <dl className="wizard-facts">
            <div>
              <dt>What it can do</dt>
              <dd>{describeDirection(template.direction)}, in {symbols.join(', ') || '—'}, in your paper account.</dd>
            </div>
            <div>
              <dt>Pausing</dt>
              <dd>Pause anytime from Home or the bot’s page. Pausing stops new orders. It doesn’t cancel orders already sent or sell what the bot bought.</dd>
            </div>
          </dl>

          <details className="wizard-advanced">
            <summary>Advanced settings</summary>
            <label className="wizard-label mt-3" htmlFor="name">Bot name</label>
            <input
              id="name"
              className="form-input"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              aria-describedby="name-error"
            />
            <FieldError id="name-error" message={touched.name ? controlsErrors.name : null} />

            <label className="wizard-label mt-3" htmlFor="advSymbols">Symbols</label>
            <input
              id="advSymbols"
              className="form-input"
              value={form.symbolsEdited || needsSymbols ? form.symbolsText : template.tickers.join(', ')}
              onChange={(e) => update({ symbolsText: e.target.value, symbolsEdited: true })}
              aria-describedby="advSymbols-error"
            />
            <FieldError id="advSymbols-error" message={controlsErrors.symbols} />

            {template.rules.length > 0 && (
              <>
                <div className="wizard-label mt-3">Template rules</div>
                <ul className="wizard-rules text-sm">
                  {template.rules.map((r, i) => <li key={`${r.type}-${i}`}>{describeRule(r)}</li>)}
                </ul>
                <p className="muted text-xs">These rules are copied to your bot as part of its template. They can’t be edited here.</p>
              </>
            )}
          </details>
        </section>
      )}

      {step === 'review' && template && (
        <section>
          <dl className="wizard-summary card card-pad-md" data-testid="review-summary">
            <div><dt>Bot</dt><dd>{form.name.trim()} <span className="muted">({template.name})</span></dd></div>
            <div><dt>Account</dt><dd>{mode === 'paper' ? 'Paper trading (simulated money)' : 'No paper account connected'}</dd></div>
            <div><dt>Symbols</dt><dd>{symbols.join(', ')}</dd></div>
            <div><dt>Simulated capital</dt><dd>{fmtMoney(capitalNum)} <span className="muted">(not set aside)</span></dd></div>
            <div><dt>Max per buy order</dt><dd>{fmtMoney(Number(form.maxPerOrder))}</dd></div>
            <div><dt>Can place</dt><dd>{describeDirection(template.direction)}</dd></div>
            <div><dt>After you start</dt><dd>The bot runs automatically and may place paper orders when its rules are met. Pause it anytime.</dd></div>
          </dl>

          <label className="wizard-confirm">
            <input
              type="checkbox"
              checked={form.confirmed}
              onChange={(e) => update({ confirmed: e.target.checked })}
            />
            <span>I understand this bot will place orders automatically in my paper account using simulated money.</span>
          </label>

          {!data.portfolioId && (
            <div className="alert alert-error mt-3" role="alert">{data.portfolioError ?? 'Your portfolio is unavailable.'} Reload the page to try again.</div>
          )}
          {submitError && (
            <div className="alert alert-error mt-3" role="alert" data-testid="submit-error">
              {submitError.message}
              {submitError.botId && <> <Link to={`/bots/${submitError.botId}`}>Open the bot</Link></>}
            </div>
          )}
        </section>
      )}

      <div className="wizard-actions">
        {stepIndex > 0 ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => goTo(stepIndex - 1)} disabled={submitting}>
            Back
          </button>
        ) : (
          <Link to="/bots" className="btn btn-sm btn-ghost">Cancel</Link>
        )}
        {step === 'review' ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={submit}
            disabled={!form.confirmed || submitting || mode !== 'paper' || !data.portfolioId || Boolean(submitError?.botId)}
          >
            {submitting ? 'Starting…' : 'Start paper trading'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => continueFrom(stepIndex)}
            disabled={(step === 'choose' && !template) || (step === 'allocation' && noBuyingPower)}
          >
            Continue
          </button>
        )}
      </div>
    </main>
  )
}
