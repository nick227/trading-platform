import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { del, get, post, put } from '../../../api/client'
import { useAuth } from '../../../app/AuthProvider'
import { getTradingMode, isSimulated } from '../../../components/ModeBadge'
import Button from '../../../components/ui/Button'
import Disclosure from '../../../components/ui/Disclosure'
import { Field, Input, Select } from '../../../components/ui/Field'
import { describeAction, describeGuards } from '../../../ui/describeBot'
import { money, sessionDate } from '../../../ui/format'
import { createAndStartBot, loadWizardData, parseSymbols } from '../new/newBotApi'
import {
  buildBotFromDraft,
  initCreateDraft,
  initEditDraft,
  saveBotAlgorithm,
  validateBuilderDraft,
} from './builderModel'

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

export default function AlgorithmBuilder() {
  const { id, botId: paramBotId } = useParams()
  const botId = id || paramBotId
  const isEdit = Boolean(botId)

  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { brokerStatus, brokerStatusLoading, brokerStatusError } = useAuth()
  const mode = getTradingMode(brokerStatus, { loading: brokerStatusLoading, error: brokerStatusError })
  const simulated = isSimulated(brokerStatus)
  const pinnedTicker = params.get('ticker')
  const templateQuery = params.get('template')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [wizardData, setWizardData] = useState(null)
  const [originalBot, setOriginalBot] = useState(null)
  const [draft, setDraft] = useState(null)
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // Section disclosures open state
  const [whenOpen, setWhenOpen] = useState(true)
  const [tradeOpen, setTradeOpen] = useState(true)
  const [moreOpen, setMoreOpen] = useState(false)

  // Load data on mount
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)

    if (isEdit) {
      // Edit mode: fetch bot and rules
      Promise.all([
        get(`/bots/${botId}`).catch((e) => ({ error: e })),
        get(`/bots/${botId}/rules`).catch(() => []),
        get('/account').catch(() => null),
      ]).then(([botRes, rulesRes, accountRes]) => {
        if (cancelled) return
        if (botRes?.error) {
          setLoadError(botRes.error?.status === 404 ? 'Bot not found.' : 'We couldn’t load this bot.')
          setLoading(false)
          return
        }

        const fullBot = {
          ...botRes,
          rules: Array.isArray(botRes.rules) && botRes.rules.length ? botRes.rules : Array.isArray(rulesRes) ? rulesRes : [],
        }

        if (fullBot.deletedAt) {
          setLoadError('This bot is stopped and cannot be edited. Create a new bot instead.')
          setLoading(false)
          return
        }

        setOriginalBot(fullBot)
        setDraft(initEditDraft(fullBot))
        setWizardData({
          buyingPower: accountRes?.buying_power ?? null,
        })
        setLoading(false)
      })
    } else {
      // Create mode: fetch catalog and account
      loadWizardData().then((wd) => {
        if (cancelled) return
        setWizardData(wd)

        const selectedTemplate =
          (templateQuery && wd.templates.find((t) => t.id === templateQuery && t.available)) ||
          wd.templates.find((t) => t.available) ||
          wd.templates[0] ||
          null

        setOriginalBot(selectedTemplate)
        if (selectedTemplate) {
          setDraft(initCreateDraft(selectedTemplate, wd, pinnedTicker))
        }
        setLoading(false)
      })
    }

    return () => {
      cancelled = true
    }
  }, [botId, isEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle template selection change in create mode
  const handleTemplateChange = (templateId) => {
    if (!wizardData?.templates) return
    const tmpl = wizardData.templates.find((t) => t.id === templateId)
    if (!tmpl) return
    setParams({ template: tmpl.id, ...(pinnedTicker ? { ticker: pinnedTicker } : {}) }, { replace: true })
    setOriginalBot(tmpl)
    setDraft(initCreateDraft(tmpl, wizardData, pinnedTicker))
    setTouched(false)
    setSubmitError(null)
  }

  // Live bot preview built from draft
  const builtBot = useMemo(() => {
    if (!draft) return null
    return buildBotFromDraft(draft, originalBot || {})
  }, [draft, originalBot])

  // Field validation
  const errors = useMemo(() => {
    if (!draft) return {}
    return validateBuilderDraft(draft, { buyingPower: wizardData?.buyingPower ?? null })
  }, [draft, wizardData?.buyingPower])

  const hasErrors = Object.keys(errors).length > 0

  if (loading) {
    return (
      <main className="tl-page tl-builder" aria-busy="true">
        <span className="tl-skel" style={{ width: 120, height: 16 }} />
        <span className="tl-skel" style={{ width: 280, height: 32, marginTop: 16 }} />
        <span className="tl-skel" style={{ height: 100, marginTop: 24 }} />
        <span className="tl-skel" style={{ height: 72, marginTop: 20 }} />
        <span className="tl-skel" style={{ height: 72, marginTop: 14 }} />
        <span className="tl-skel" style={{ height: 72, marginTop: 14 }} />
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="tl-page tl-builder">
        <Link to="/bots" className="tl-back">← Bots</Link>
        <h1 className="tl-title">Unavailable</h1>
        <p className="tl-lede">{loadError}</p>
        <div style={{ marginTop: 20 }}>
          <Link to="/bots" className="tl-btn tl-btn--primary">Go to Bots</Link>
        </div>
      </main>
    )
  }

  if (!draft || !builtBot) return null

  const actionSentence = describeAction(builtBot)
  const guards = describeGuards(builtBot)

  // Metadata summaries for disclosure headers
  const triggerMetaText =
    draft.triggerType === 'price_threshold'
      ? draft.trigger?.price
        ? `Price ${draft.trigger.operator === 'below' ? 'below' : 'above'} $${draft.trigger.price}`
        : 'Price threshold'
      : draft.triggerType === 'alpha_research'
        ? draft.research?.minScore
          ? `Alpha Engine (score ≥ ${draft.research.minScore})`
          : 'Alpha Engine research'
        : draft.triggerType === 'trend_filter'
          ? 'Benchmark trend confirmation'
          : 'Regular schedule'

  const tradeMetaText = draft.symbolsText
    ? `${draft.symbolsText} · ${draft.direction === 'sell' ? 'Sell' : 'Buy'}${
        draft.capital ? ` · $${Number(draft.capital).toLocaleString()} capital` : ''
      }`
    : 'Symbols & capital'

  const settingsMetaText =
    [
      draft.marketHours.on && (draft.marketHours.extended ? 'Regular & extended hours' : 'Market hours only'),
      draft.cooldown.on && `${draft.cooldown.hours}h cooldown`,
      draft.dailyLoss.on && `$${draft.dailyLoss.maxLoss} daily loss`,
      draft.positionLimit.on && `${draft.positionLimit.maxShares} max shares`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Limits & schedule'

  // Submit action
  const handleSubmit = async (e) => {
    e.preventDefault()
    setTouched(true)

    if (hasErrors) {
      if (errors.cooldown || errors.positionLimit || errors.dailyLoss || errors.maxAgeHours || errors.maxDriftPct) {
        setMoreOpen(true)
      }
      if (errors.triggerPrice || errors.minScore) {
        setWhenOpen(true)
      }
      if (errors.name || errors.symbols || errors.capital || errors.maxPerOrder) {
        setTradeOpen(true)
      }
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    if (isEdit) {
      // Save existing bot
      const res = await saveBotAlgorithm({
        bot: originalBot,
        builtBot,
        api: { put, post, del },
      })
      setSubmitting(false)

      if (res.ok) {
        navigate(`/bots/${botId}`, { state: { updated: true } })
      } else {
        setSubmitError({ message: res.error, partial: res.partial })
      }
    } else {
      // Create new bot
      const res = await createAndStartBot({
        template: originalBot,
        portfolioId: wizardData?.portfolioId,
        name: builtBot.name,
        tickers: builtBot.tickers,
        capital: builtBot.config.allocatedAmount,
        maxPerOrder: builtBot.config.maxOrderNotional,
        rules: builtBot.rules,
        researchConfig: builtBot.config.research,
      })
      setSubmitting(false)

      if (res.ok) {
        navigate(`/bots/${res.botId}`, { state: { created: true } })
      } else {
        setSubmitError(res)
      }
    }
  }

  const cancelPath = isEdit ? `/bots/${botId}` : '/bots'
  const needsConfirm = !isEdit && mode === 'paper' && !simulated

  return (
    <main className="tl-page tl-builder" data-testid="algorithm-builder">
      <Link to={cancelPath} className="tl-back">
        ← {isEdit ? originalBot?.name || 'Bot' : 'Bots'}
      </Link>

      <header className="tl-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="tl-title">{isEdit ? `Edit ${originalBot?.name}` : 'New bot'}</h1>
          <p className="tl-lede">
            {isEdit
              ? 'Adjust your strategy conditions, symbols, and risk limits.'
              : 'Configure your strategy conditions, symbols, and simulated capital.'}
          </p>
        </div>
      </header>

      <ModeNotice mode={mode} />

      {/* Live Strategy Summary */}
      <section className="tl-builder-summary" data-testid="builder-summary" aria-label="Strategy summary">
        <div className="tl-builder-summary-head">
          <span className="tl-builder-summary-label">Strategy summary</span>
          <span className="tl-small tl-muted">
            {simulated
              ? `Simulated money (${sessionDate(brokerStatus?.session)} close)`
              : mode === 'paper'
                ? 'Paper trading (simulated money)'
                : 'Account not connected'}
          </span>
        </div>
        <p className="tl-builder-summary-sentence">{actionSentence}</p>
        <ul className="tl-builder-summary-guards" data-testid="builder-guards">
          {guards.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </section>

      {/* Starting point selector (Create mode only) */}
      {!isEdit && wizardData?.templates && wizardData.templates.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <Field
            label="Starting point"
            help="Preloads an established setup you can customize."
          >
            {({ id }) => (
              <Select
                id={id}
                value={draft.templateId || ''}
                onChange={(e) => handleTemplateChange(e.target.value)}
                data-testid="template-select"
              >
                {wizardData.templates.map((t) => (
                  <option key={t.id} value={t.id} disabled={!t.available}>
                    {t.name} {!t.available ? '(unavailable)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </section>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="tl-builder-sections">
          {/* ── Section 1: When ────────────────────────────────────────── */}
          <Disclosure
            label="1. When"
            meta={triggerMetaText}
            open={whenOpen}
            onToggle={setWhenOpen}
            testId="section-when"
            className="tl-disc--card"
          >
            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <label className="tl-label" style={{ marginBottom: 8, display: 'block' }}>
                  Trigger type
                </label>
                <div className="tl-segmented" role="radiogroup" aria-label="Trigger type">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.triggerType === 'price_threshold'}
                    className={`tl-segmented-btn ${draft.triggerType === 'price_threshold' ? 'is-active' : ''}`}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        triggerType: 'price_threshold',
                        trigger: d.trigger?.price ? d.trigger : { operator: d.direction === 'sell' ? 'below' : 'above', price: '' },
                      }))
                    }
                  >
                    Price threshold
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.triggerType === 'alpha_research'}
                    className={`tl-segmented-btn ${draft.triggerType === 'alpha_research' ? 'is-active' : ''}`}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        triggerType: 'alpha_research',
                        research: d.research || { minScore: '60', maxAgeHours: '96', maxDriftPct: '5', requireEdge: true },
                      }))
                    }
                  >
                    Alpha Engine research
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.triggerType === 'schedule'}
                    className={`tl-segmented-btn ${draft.triggerType === 'schedule' ? 'is-active' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, triggerType: 'schedule' }))}
                  >
                    Regular schedule
                  </button>
                  {draft.fixed.some((f) => f.type === 'trend_filter') && (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft.triggerType === 'trend_filter'}
                      className={`tl-segmented-btn ${draft.triggerType === 'trend_filter' ? 'is-active' : ''}`}
                      onClick={() => setDraft((d) => ({ ...d, triggerType: 'trend_filter' }))}
                    >
                      Trend filter
                    </button>
                  )}
                </div>
              </div>

              {draft.triggerType === 'price_threshold' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
                  <Field label="Condition">
                    {({ id }) => (
                      <Select
                        id={id}
                        value={draft.trigger?.operator || 'above'}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            trigger: { ...(d.trigger || {}), operator: e.target.value },
                          }))
                        }
                      >
                        <option value="above">Price rises above</option>
                        <option value="below">Price falls below</option>
                      </Select>
                    )}
                  </Field>
                  <Field
                    label="Trigger price"
                    error={touched ? errors.triggerPrice : null}
                    help="Target price in dollars"
                  >
                    {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                      <Input
                        id={id}
                        prefix="$"
                        inputMode="decimal"
                        value={draft.trigger?.price || ''}
                        error={touched && errors.triggerPrice}
                        aria-invalid={ariaInvalid}
                        aria-describedby={ariaDescribedby}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9.]/g, '')
                          setDraft((d) => ({
                            ...d,
                            trigger: { ...(d.trigger || {}), price: val },
                          }))
                        }}
                      />
                    )}
                  </Field>
                </div>
              )}

              {draft.triggerType === 'alpha_research' && draft.research && (
                <div style={{ display: 'grid', gap: 12 }}>
                  <p className="tl-help" style={{ margin: 0 }}>
                    Acts on current, verified BUY and SELL research signals published by Alpha Engine.
                  </p>
                  <Field
                    label="Minimum research score"
                    help="(0–100; a score, not a probability)"
                    error={touched ? errors.minScore : null}
                  >
                    {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                      <Input
                        id={id}
                        style={{ maxWidth: 160 }}
                        inputMode="numeric"
                        value={draft.research.minScore}
                        error={touched && errors.minScore}
                        aria-invalid={ariaInvalid}
                        aria-describedby={ariaDescribedby}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9]/g, '')
                          setDraft((d) => ({
                            ...d,
                            research: { ...d.research, minScore: val },
                          }))
                        }}
                      />
                    )}
                  </Field>
                </div>
              )}

              {draft.triggerType === 'trend_filter' && (
                <p className="tl-help" style={{ margin: 0 }}>
                  Evaluates when the benchmark trend is confirmed (e.g. SPY above its 200-day moving average).
                </p>
              )}

              {draft.triggerType === 'schedule' && (
                <p className="tl-help" style={{ margin: 0 }}>
                  Evaluates on every market schedule without price triggers.
                </p>
              )}
            </div>
          </Disclosure>

          {/* ── Section 2: Trade ────────────────────────────────────────── */}
          <Disclosure
            label="2. Trade"
            meta={tradeMetaText}
            open={tradeOpen}
            onToggle={setTradeOpen}
            testId="section-trade"
            className="tl-disc--card"
          >
            <div style={{ display: 'grid', gap: 16 }}>
              <Field
                label="Bot name"
                error={touched ? errors.name : null}
              >
                {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                  <Input
                    id={id}
                    value={draft.name}
                    error={touched && errors.name}
                    aria-invalid={ariaInvalid}
                    aria-describedby={ariaDescribedby}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                )}
              </Field>

              <Field
                label="Symbols"
                help={
                  draft.triggerType === 'alpha_research'
                    ? 'The bot acts only on symbols with current Alpha Engine research.'
                    : 'Separate several symbols with commas (e.g. AAPL, MSFT).'
                }
                error={touched ? errors.symbols : null}
              >
                {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                  <Input
                    id={id}
                    placeholder="e.g. AAPL, MSFT"
                    value={draft.symbolsText}
                    error={touched && errors.symbols}
                    aria-invalid={ariaInvalid}
                    aria-describedby={ariaDescribedby}
                    onChange={(e) => setDraft((d) => ({ ...d, symbolsText: e.target.value }))}
                  />
                )}
              </Field>

              <div>
                <label className="tl-label" style={{ marginBottom: 8, display: 'block' }}>
                  Order direction
                </label>
                <div className="tl-segmented" role="radiogroup" aria-label="Order direction">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.direction === 'buy'}
                    className={`tl-segmented-btn ${draft.direction === 'buy' ? 'is-active' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, direction: 'buy' }))}
                  >
                    Buy orders
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.direction === 'sell'}
                    className={`tl-segmented-btn ${draft.direction === 'sell' ? 'is-active' : ''}`}
                    onClick={() => setDraft((d) => ({ ...d, direction: 'sell' }))}
                  >
                    Sell orders (shares held)
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
                <Field
                  label="Simulated capital"
                  help={`Cash available: ${money(wizardData?.buyingPower)}. Capital caps total spend.`}
                  error={touched ? errors.capital : null}
                >
                  {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                    <Input
                      id={id}
                      prefix="$"
                      inputMode="decimal"
                      value={draft.capital}
                      error={touched && errors.capital}
                      aria-invalid={ariaInvalid}
                      aria-describedby={ariaDescribedby}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9.]/g, '')
                        setDraft((d) => ({ ...d, capital: val }))
                      }}
                    />
                  )}
                </Field>

                <Field
                  label="Max spend per order"
                  help="Caps the size of any single order."
                  error={touched ? errors.maxPerOrder : null}
                >
                  {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                    <Input
                      id={id}
                      prefix="$"
                      inputMode="decimal"
                      value={draft.maxPerOrder}
                      error={touched && errors.maxPerOrder}
                      aria-invalid={ariaInvalid}
                      aria-describedby={ariaDescribedby}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9.]/g, '')
                        setDraft((d) => ({ ...d, maxPerOrder: val }))
                      }}
                    />
                  )}
                </Field>
              </div>
            </div>
          </Disclosure>

          {/* ── Section 3: More settings ─────────────────────────────────── */}
          <Disclosure
            label="3. More settings"
            meta={settingsMetaText}
            open={moreOpen}
            onToggle={setMoreOpen}
            testId="section-more"
            className="tl-disc--card"
          >
            <div style={{ display: 'grid', gap: 18 }}>
              {/* Market hours */}
              <div className="tl-rule-row">
                <label className="tl-check">
                  <input
                    type="checkbox"
                    checked={draft.marketHours.on}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        marketHours: { ...d.marketHours, on: e.target.checked },
                      }))
                    }
                  />
                  <span>Trade only during market hours</span>
                </label>
                {draft.marketHours.on && (
                  <label className="tl-check" style={{ marginLeft: 24 }}>
                    <input
                      type="checkbox"
                      checked={draft.marketHours.extended}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          marketHours: { ...d.marketHours, extended: e.target.checked },
                        }))
                      }
                    />
                    <span className="tl-muted">include extended hours (pre-market and after-hours)</span>
                  </label>
                )}
              </div>

              {/* Cooldown */}
              <div className="tl-rule-row">
                <label className="tl-check">
                  <input
                    type="checkbox"
                    checked={draft.cooldown.on}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        cooldown: { ...d.cooldown, on: e.target.checked },
                      }))
                    }
                  />
                  <span>At most one trade per symbol every</span>
                </label>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Input
                    style={{ width: 80 }}
                    inputMode="decimal"
                    aria-label="Cooldown hours"
                    value={draft.cooldown.hours}
                    error={touched && errors.cooldown}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '')
                      setDraft((d) => ({
                        ...d,
                        cooldown: { ...d.cooldown, hours: val, on: true },
                      }))
                    }}
                  />
                  <span className="tl-muted">hours</span>
                </div>
                {touched && errors.cooldown && <p className="tl-field-error" role="alert">{errors.cooldown}</p>}
              </div>

              {/* Position limit */}
              <div className="tl-rule-row">
                <label className="tl-check">
                  <input
                    type="checkbox"
                    checked={draft.positionLimit.on}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        positionLimit: { ...d.positionLimit, on: e.target.checked },
                      }))
                    }
                  />
                  <span>Hold at most</span>
                </label>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Input
                    style={{ width: 90 }}
                    inputMode="numeric"
                    aria-label="Maximum shares per symbol"
                    value={draft.positionLimit.maxShares}
                    error={touched && errors.positionLimit}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '')
                      setDraft((d) => ({
                        ...d,
                        positionLimit: { ...d.positionLimit, maxShares: val, on: true },
                      }))
                    }}
                  />
                  <span className="tl-muted">shares per symbol</span>
                </div>
                {touched && errors.positionLimit && <p className="tl-field-error" role="alert">{errors.positionLimit}</p>}
              </div>

              {/* Daily loss limit */}
              <div className="tl-rule-row">
                <label className="tl-check">
                  <input
                    type="checkbox"
                    checked={draft.dailyLoss.on}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        dailyLoss: { ...d.dailyLoss, on: e.target.checked },
                      }))
                    }
                  />
                  <span>Stop for the day once realized loss reaches</span>
                </label>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Input
                    prefix="$"
                    style={{ width: 100 }}
                    inputMode="decimal"
                    aria-label="Daily loss limit in dollars"
                    value={draft.dailyLoss.maxLoss}
                    error={touched && errors.dailyLoss}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '')
                      setDraft((d) => ({
                        ...d,
                        dailyLoss: { ...d.dailyLoss, maxLoss: val, on: true },
                      }))
                    }}
                  />
                </div>
                {touched && errors.dailyLoss && <p className="tl-field-error" role="alert">{errors.dailyLoss}</p>}
              </div>

              {/* Fixed rules (trend_filter, time_window) */}
              {draft.fixed.map((f) => (
                <p key={f.id ?? f.type} className="tl-small tl-muted tl-rule-fixed">
                  {f.type === 'trend_filter'
                    ? `Only when the ${f.config?.symbol ?? 'SPY'} trend is confirmed (set by starting point)`
                    : `Only between ${f.config?.start} and ${f.config?.end} ET (set by starting point)`}
                </p>
              ))}

              {/* Advanced Research bounds (when research is active) */}
              {draft.triggerType === 'alpha_research' && draft.research && (
                <div style={{ borderTop: '1px solid var(--tl-line)', paddingTop: 16, marginTop: 4, display: 'grid', gap: 14 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Alpha Engine research policy</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
                    <Field
                      label="Maximum prediction age"
                      help="Hours since publication (1–720)"
                      error={touched ? errors.maxAgeHours : null}
                    >
                      {({ id, 'aria-invalid': ariaInvalid }) => (
                        <Input
                          id={id}
                          inputMode="numeric"
                          value={draft.research.maxAgeHours}
                          error={touched && errors.maxAgeHours}
                          aria-invalid={ariaInvalid}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '')
                            setDraft((d) => ({
                              ...d,
                              research: { ...d.research, maxAgeHours: val },
                            }))
                          }}
                        />
                      )}
                    </Field>
                    <Field
                      label="Maximum price drift"
                      help="Price move since signal (0–50%)"
                      error={touched ? errors.maxDriftPct : null}
                    >
                      {({ id, 'aria-invalid': ariaInvalid }) => (
                        <Input
                          id={id}
                          inputMode="numeric"
                          value={draft.research.maxDriftPct}
                          error={touched && errors.maxDriftPct}
                          aria-invalid={ariaInvalid}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '')
                            setDraft((d) => ({
                              ...d,
                              research: { ...d.research, maxDriftPct: val },
                            }))
                          }}
                        />
                      )}
                    </Field>
                  </div>
                  <label className="tl-check">
                    <input
                      type="checkbox"
                      checked={draft.research.requireEdge}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          research: { ...d.research, requireEdge: e.target.checked },
                        }))
                      }
                    />
                    <span>
                      Only research whose holdout beat the always-up baseline{' '}
                      <span className="tl-muted tl-small">(uncheck to experiment with unproven signals)</span>
                    </span>
                  </label>
                </div>
              )}
            </div>
          </Disclosure>
        </div>

        {/* Confirmation checkbox outside simulator */}
        {needsConfirm && (
          <label className="wizard-confirm" style={{ marginTop: 22 }}>
            <input
              type="checkbox"
              data-testid="confirm-paper-checkbox"
              checked={draft.confirmed}
              onChange={(e) => setDraft((d) => ({ ...d, confirmed: e.target.checked }))}
            />
            <span>I understand this bot will place orders automatically in my paper account.</span>
          </label>
        )}

        {/* Submit error alert */}
        {submitError && (
          <div className="tl-notice tl-notice--error" role="alert" data-testid="submit-error" style={{ marginTop: 18 }}>
            <span>
              {submitError.message}
              {submitError.partial && (
                <>
                  {' '}
                  <button type="button" className="tl-link-btn" onClick={() => window.location.reload()}>
                    Reload bot
                  </button>
                </>
              )}
              {submitError.botId && (
                <>
                  {' '}
                  <Link to={`/bots/${submitError.botId}`}>Open the bot</Link>
                </>
              )}
            </span>
          </div>
        )}

        {/* Actions bar */}
        <div className="tl-builder-actions">
          <Link to={cancelPath} className="tl-btn">
            Cancel
          </Link>
          <Button
            variant="primary"
            type="submit"
            disabled={
              submitting ||
              (needsConfirm && !draft.confirmed) ||
              mode !== 'paper' ||
              (!isEdit && !wizardData?.portfolioId) ||
              Boolean(submitError?.botId)
            }
            data-testid="submit-builder-btn"
          >
            {submitting
              ? isEdit
                ? 'Saving…'
                : 'Starting…'
              : isEdit
                ? 'Save changes'
                : 'Start bot'}
          </Button>
        </div>
      </form>
    </main>
  )
}
