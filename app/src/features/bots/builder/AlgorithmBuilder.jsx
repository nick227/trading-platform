import { PageIdentity } from '../../../components/content/ContentBlocks'
import SimpleCreateBot from './SimpleCreateBot'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { get, post, put } from '../../../api/client'
import { useAuth } from '../../../app/AuthProvider'
import { getTradingMode, isSimulated } from '../../../components/ModeBadge'
import Button from '../../../components/ui/Button'
import Disclosure from '../../../components/ui/Disclosure'
import { Field, Input, Select } from '../../../components/ui/Field'
import { describeAction, describeGuards } from '../../../ui/describeBot'
import { money, sessionDate } from '../../../ui/format'
import AlgorithmStep from './AlgorithmStep'
import SymbolContext from './SymbolContext'
import StockSelector from './StockSelector'
import BacktestPanel from './BacktestPanel'
import TemplateBaseline, { behaviourKey } from './TemplateBaseline'
import AlgorithmIdentity, { algorithmIdentity } from '../../../ui/AlgorithmIdentity'
import { loadWizardData, parseSymbols } from './builderData'
import {
  buildBotFromDraft,
  createBotConfiguration,
  formatDesiredRules,
  initCreateDraft,
  initEditDraft,
  rebaseDraft,
  mapServerValidationError,
  updateBotConfiguration,
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

function LegacyAlgorithmBuilder() {
  const { id, botId: paramBotId } = useParams()
  const botId = id || paramBotId
  const isEdit = Boolean(botId)

  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { brokerStatus, brokerStatusLoading, brokerStatusError } = useAuth()
  const mode = getTradingMode(brokerStatus, { loading: brokerStatusLoading, error: brokerStatusError })
  const simulated = isSimulated(brokerStatus)
  // paper_daily: only symbols with a fresh daily close can trade (server-enforced too).
  const tradableSymbols = Array.isArray(brokerStatus?.tradableSymbols) && brokerStatus.tradableSymbols.length ? brokerStatus.tradableSymbols : null
  const pinnedTicker = params.get('ticker') || params.get('symbol')
  const templateQuery = params.get('template') || params.get('strategy')
  const windowQuery = params.get('window')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [wizardData, setWizardData] = useState(null)
  const [originalBot, setOriginalBot] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loadedDraft, setLoadedDraft] = useState(null) // as loaded from the server, for conflict rebase
  const [templateDraft, setTemplateDraft] = useState(null) // create mode: the starting point as tested
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [serverFieldErrors, setServerFieldErrors] = useState({})
  const [staleError, setStaleError] = useState(null)

  const [activeStep, setActiveStep] = useState(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const formRef = useRef(null)
  const openStep = (step) => setActiveStep((current) => current === step ? null : step)
  const revealErrors = (fieldErrors) => {
    const first = ['name', 'symbols', 'triggerPrice', 'minScore', 'capital', 'maxPerOrder',
      'cooldown', 'positionLimit', 'dailyLoss', 'maxAgeHours', 'maxDriftPct'].find((key) => fieldErrors[key])
    const step = { name: 'name', symbols: 'watch', triggerPrice: 'when', minScore: 'when',
      capital: 'trade', maxPerOrder: 'trade' }[first] || 'more'
    setActiveStep(step)
    setFocusRequest((n) => n + 1)
  }

  useEffect(() => {
    if (!focusRequest) return
    const container = formRef.current?.querySelector(`[data-testid="section-${activeStep}"]`)
    container?.querySelector('[aria-invalid="true"]')?.focus()
  }, [focusRequest, activeStep])

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
        const loaded = initEditDraft(fullBot)
        setLoadedDraft(loaded)
        setDraft(loaded)
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
          const d = initCreateDraft(selectedTemplate, wd, pinnedTicker)
          setDraft(d)
          setTemplateDraft(d)
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
    const d = initCreateDraft(tmpl, wizardData, pinnedTicker)
    setDraft(d)
    setTemplateDraft(d)
    setTouched(false)
    setActiveStep(null)
    setSubmitError(null)
    setServerFieldErrors({})
    setStaleError(null)
  }

  // Live bot preview built from draft
  const builtBot = useMemo(() => {
    if (!draft) return null
    return buildBotFromDraft(draft, originalBot || {})
  }, [draft, originalBot])

  // Field validation
  const errors = useMemo(() => {
    if (!draft) return {}
    return validateBuilderDraft(draft, { buyingPower: wizardData?.buyingPower ?? null, tradableSymbols })
  }, [draft, wizardData?.buyingPower, tradableSymbols])

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

  const exitSummaries = [
    draft.exit?.stopLoss?.on && `Stop-loss ${draft.exit.stopLoss.pct ?? 10}%`,
    draft.exit?.trend?.on && `Exit when ${draft.exit.trend.symbol ?? 'SPY'} trend turns down`,
    draft.exit?.reversal?.on && `Exit on ${draft.exit.reversal.pct ?? 5}% drop over ${draft.exit.reversal.sessions ?? 10} sessions`,
  ].filter(Boolean)
  const exitSummaryText = exitSummaries.length > 0 ? ` · Exit & Protect: ${exitSummaries.join(', ')}` : ''

  const tradeMetaText = `${draft.direction === 'sell' ? 'Sell shares held' : draft.direction === 'buy' ? 'Buy' : 'Follow research'}${draft.maxPerOrder ? ` · up to ${money(Number(draft.maxPerOrder))} per order` : ' · set an order limit'}${exitSummaryText}`
  const hasChanges = isEdit && JSON.stringify(draft) !== JSON.stringify(loadedDraft)

  const settingsMetaText =
    [
      draft.marketHours.on && (draft.marketHours.extended ? 'Regular & extended hours' : 'Market hours only'),
      draft.cooldown.on && `${draft.cooldown.hours}h cooldown`,
      draft.dailyLoss.on && `$${draft.dailyLoss.maxLoss} daily loss`,
      draft.positionLimit.on && `${draft.positionLimit.maxShares} max shares`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Review limits'

  // Save action (unified transactional API)
  const handleSave = async () => {
    setTouched(true)

    if (hasErrors) {
      revealErrors(errors)
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    setServerFieldErrors({})
    setStaleError(null)

    try {
      if (isEdit) {
        await updateBotConfiguration({
          bot: originalBot,
          draft,
          api: { put },
          expectedUpdatedAt: draft.updatedAt,
        })
        setSubmitting(false)
        navigate(`/bots/${botId}`, { state: { updated: true } })
      } else {
        const res = await createBotConfiguration({
          portfolioId: wizardData?.portfolioId,
          templateId: draft.templateId,
          draft,
          originalTemplate: originalBot,
          api: { post },
        })
        setSubmitting(false)
        navigate(`/bots/${res?.id || res?.botId}`, { state: { created: true } })
      }
    } catch (error) {
      setSubmitting(false)
      const desiredRules = formatDesiredRules(draft, isEdit ? originalBot?.rules : originalBot?.rules || [])
      const mapped = mapServerValidationError(error, desiredRules)

      if (mapped.stale) {
        setStaleError({
          message: mapped.message,
          currentUpdatedAt: mapped.currentUpdatedAt,
        })
      } else {
        setSubmitError({ message: mapped.message })
        if (mapped.fieldErrors && Object.keys(mapped.fieldErrors).length > 0) {
          setServerFieldErrors(mapped.fieldErrors)
          revealErrors(mapped.fieldErrors)
        }
      }
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    handleSave()
  }

  const handleReloadBot = async () => {
    setLoading(true)
    setStaleError(null)
    setSubmitError(null)
    setServerFieldErrors({})
    try {
      const [botRes, rulesRes] = await Promise.all([
        get(`/bots/${botId}`),
        get(`/bots/${botId}/rules`).catch(() => []),
      ])
      const fullBot = {
        ...botRes,
        rules: Array.isArray(botRes.rules) && botRes.rules.length ? botRes.rules : Array.isArray(rulesRes) ? rulesRes : [],
      }
      const latest = initEditDraft(fullBot)
      setOriginalBot(fullBot)
      setLoadedDraft(latest)
      // Keep the user's edits on top of the latest version; they review and save again.
      setDraft((d) => (d && loadedDraft ? rebaseDraft(loadedDraft, d, latest) : latest))
      setSubmitError(null)
      setLoading(false)
    } catch {
      setLoadError('Failed to reload latest bot.')
      setLoading(false)
    }
  }

  const cancelPath = isEdit ? `/bots/${botId}` : '/bots'
  const needsConfirm = !isEdit && mode === 'paper' && !simulated

  return (
    <main className="tl-page tl-builder" data-testid="algorithm-builder">
      <Link to={cancelPath} className="tl-back">
        ← {isEdit ? originalBot?.name || 'Bot' : 'Bots'}
      </Link>

      <PageIdentity title={isEdit ? `Edit ${originalBot?.name}` : 'Create a simulated trading bot'} description={isEdit ? 'Review its trading rules and safety limits before saving changes.' : 'Choose an approach, set a simulated budget and review the conditions that control trades.'} />

      <ModeNotice mode={mode} />

      {/* Starting point selector (Create mode only) */}
      {!isEdit && wizardData?.templates && wizardData.templates.length > 0 && (
        <section className="tl-builder-starting-point">
          <Field
            label="Choose a strategy"
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

      <form ref={formRef} onSubmit={handleSubmit} noValidate>
        <section className="tl-algorithm" aria-label="Strategy">
          <header className="tl-algorithm-head">
            <span className="tl-algorithm-heading-identity"><AlgorithmIdentity bot={builtBot} compact /><span><span className="tl-algorithm-family">{algorithmIdentity(builtBot).label}</span></span></span>
            <span className="tl-algorithm-status" role="status">{isEdit ? hasChanges ? 'Unsaved changes' : 'Saved configuration' : 'Draft'}</span>
          </header>
          <AlgorithmStep label="Name" summary={draft.name || 'Name your bot'} open={activeStep === 'name'} onToggle={() => openStep('name')} testId="section-name" quiet>
              <Field
                label="Bot name"
                error={(touched ? errors.name : null) || serverFieldErrors.name || null}
              >
                {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                  <Input
                    id={id}
                    value={draft.name}
                    error={(touched && errors.name) || Boolean(serverFieldErrors.name)}
                    aria-invalid={ariaInvalid}
                    aria-describedby={ariaDescribedby}
                    onChange={(e) => {
                      setServerFieldErrors((s) => ({ ...s, name: null }))
                      setDraft((d) => ({ ...d, name: e.target.value }))
                    }}
                  />
                )}
              </Field>

          </AlgorithmStep>
          {!isEdit && originalBot?.id && templateDraft && (
            <TemplateBaseline templateId={originalBot.id} modified={behaviourKey(draft) !== behaviourKey(templateDraft)} />
          )}
          <div className="tl-algorithm-flow">
            <AlgorithmStep label="Watch" summary={parseSymbols(draft.symbolsText).join(', ') || 'Choose symbols'} mark="○" open={activeStep === 'watch'} onToggle={() => openStep('watch')} testId="section-watch">
              <Field
                label="Symbols"
                help={
                  tradableSymbols
                    ? `Paper trading uses daily closes for ${tradableSymbols.join(', ')}.`
                    : draft.triggerType === 'alpha_research'
                      ? 'The bot acts only on symbols with current Alpha Engine research.'
                      : 'Separate several symbols with commas (e.g. AAPL, MSFT).'
                }
                error={(touched ? errors.symbols : null) || serverFieldErrors.symbols || null}
              >
                {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                  <Input
                    id={id}
                    placeholder="e.g. AAPL, MSFT"
                    value={draft.symbolsText}
                    error={(touched && errors.symbols) || Boolean(serverFieldErrors.symbols)}
                    aria-invalid={ariaInvalid}
                    aria-describedby={ariaDescribedby}
                    onChange={(e) => {
                      setServerFieldErrors((s) => ({ ...s, symbols: null }))
                      setDraft((d) => ({ ...d, symbolsText: e.target.value }))
                    }}
                  />
                )}
              </Field>
              <StockSelector
                selected={parseSymbols(draft.symbolsText)}
                supported={tradableSymbols}
                onSelect={symbol => {
                  setServerFieldErrors(errors => ({ ...errors, symbols: null }))
                  setDraft(current => {
                    const symbols = parseSymbols(current.symbolsText)
                    return symbols.includes(symbol) ? current
                      : { ...current, symbolsText: [...symbols, symbol].join(', ') }
                  })
                }}
              />
              <SymbolContext
                selected={parseSymbols(draft.symbolsText)}
                supported={tradableSymbols}
                onToggle={(sym) => {
                  setServerFieldErrors((s) => ({ ...s, symbols: null }))
                  setDraft((d) => {
                    const cur = parseSymbols(d.symbolsText)
                    const next = cur.includes(sym) ? cur.filter((x) => x !== sym) : [...cur, sym]
                    return { ...d, symbolsText: next.join(', ') }
                  })
                }}
              />

            </AlgorithmStep>
          {/* ── Section 1: When ────────────────────────────────────────── */}
          <AlgorithmStep label="When" summary={triggerMetaText} mark="◇"
            open={activeStep === 'when'} onToggle={() => openStep('when')} testId="section-when">
            <div className="tl-field-stack">
              <div>
                <label className="tl-label tl-field-label">
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
                <div className="tl-responsive-fields">
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
                    error={(touched ? errors.triggerPrice : null) || serverFieldErrors.triggerPrice || null}
                    help="Target price in dollars"
                  >
                    {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                      <Input
                        id={id}
                        prefix="$"
                        inputMode="decimal"
                        value={draft.trigger?.price || ''}
                        error={(touched && errors.triggerPrice) || Boolean(serverFieldErrors.triggerPrice)}
                        aria-invalid={ariaInvalid}
                        aria-describedby={ariaDescribedby}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9.]/g, '')
                          setServerFieldErrors((s) => ({ ...s, triggerPrice: null }))
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
                <div className="tl-builder-cluster">
                  <Field
                    label="Minimum research score"
                    help="(0–100; a score, not a probability)"
                    error={(touched ? errors.minScore : null) || serverFieldErrors.minScore || null}
                  >
                    {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                      <Input
                        id={id}
                        style={{ maxWidth: 160 }}
                        inputMode="numeric"
                        value={draft.research.minScore}
                        error={(touched && errors.minScore) || Boolean(serverFieldErrors.minScore)}
                        aria-invalid={ariaInvalid}
                        aria-describedby={ariaDescribedby}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9]/g, '')
                          setServerFieldErrors((s) => ({ ...s, minScore: null }))
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

              <fieldset className="tl-conditions" data-testid="market-conditions">
                <legend className="tl-label">Market conditions <span className="tl-muted tl-small">(optional, all must hold)</span></legend>
                <label className="tl-check">
                  <input type="checkbox" checked={Boolean(draft.relVolume?.on)} data-testid="cond-relvol"
                    onChange={(e) => setDraft((d) => ({ ...d, relVolume: { ...(d.relVolume ?? { minRatio: '1.5' }), on: e.target.checked } }))} />
                  <span>Volume is at least</span>
                  <input className="tl-input tl-input--inline" inputMode="decimal" aria-label="Volume multiple" value={draft.relVolume?.minRatio ?? '1.5'}
                    disabled={!draft.relVolume?.on} aria-invalid={Boolean(touched && errors.relVolume)}
                    onChange={(e) => setDraft((d) => ({ ...d, relVolume: { ...(d.relVolume ?? {}), minRatio: e.target.value } }))} />
                  <span>× its 20-day average</span>
                </label>
                {touched && errors.relVolume && <p className="tl-field-error" role="alert">{errors.relVolume}</p>}
                <label className="tl-check">
                  <input type="checkbox" checked={Boolean(draft.priceChange?.on)} data-testid="cond-pricechange"
                    onChange={(e) => setDraft((d) => ({ ...d, priceChange: { ...(d.priceChange ?? { sessions: '5', operator: 'above', pct: '3' }), on: e.target.checked } }))} />
                  <span>Price</span>
                  <select className="tl-input tl-input--inline" aria-label="Rose or fell" value={draft.priceChange?.operator ?? 'above'} disabled={!draft.priceChange?.on}
                    onChange={(e) => setDraft((d) => ({ ...d, priceChange: { ...(d.priceChange ?? {}), operator: e.target.value } }))}>
                    <option value="above">rose</option>
                    <option value="below">fell</option>
                  </select>
                  <span>at least</span>
                  <input className="tl-input tl-input--inline" inputMode="decimal" aria-label="Percent change" value={draft.priceChange?.pct ?? '3'} disabled={!draft.priceChange?.on}
                    aria-invalid={Boolean(touched && errors.priceChange)}
                    onChange={(e) => setDraft((d) => ({ ...d, priceChange: { ...(d.priceChange ?? {}), pct: e.target.value } }))} />
                  <span>% over</span>
                  <input className="tl-input tl-input--inline" inputMode="numeric" aria-label="Sessions" value={draft.priceChange?.sessions ?? '5'} disabled={!draft.priceChange?.on}
                    aria-invalid={Boolean(touched && errors.priceChange)}
                    onChange={(e) => setDraft((d) => ({ ...d, priceChange: { ...(d.priceChange ?? {}), sessions: e.target.value } }))} />
                  <span>sessions</span>
                </label>
                {touched && errors.priceChange && <p className="tl-field-error" role="alert">{errors.priceChange}</p>}
              </fieldset>
            </div>
          </AlgorithmStep>

          {/* ── Section 2: Trade ────────────────────────────────────────── */}
          <AlgorithmStep label="Act" summary={tradeMetaText} mark="→"
            detail={`Capital allocated: ${draft.capital ? money(Number(draft.capital)) : 'Not set'}`}
            open={activeStep === 'trade'} onToggle={() => openStep('trade')} testId="section-trade">
            <div className="tl-field-stack">
              <div>
                <label className="tl-label tl-field-label">
                  Order direction
                </label>
                <div className="tl-segmented" role="radiogroup" aria-label="Order direction">
                  {draft.triggerType === 'alpha_research' && (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!draft.direction}
                      className={`tl-segmented-btn ${!draft.direction ? 'is-active' : ''}`}
                      onClick={() => setDraft((d) => ({ ...d, direction: null }))}
                    >
                      Follow research
                    </button>
                  )}
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

              <div className="tl-responsive-fields">
                <Field
                  label="Capital allocated"
                  help={`Cash available: ${money(wizardData?.buyingPower)}. Capital caps total spend.`}
                  error={(touched ? errors.capital : null) || serverFieldErrors.capital || null}
                >
                  {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                    <Input
                      id={id}
                      prefix="$"
                      inputMode="decimal"
                      value={draft.capital}
                      error={(touched && errors.capital) || Boolean(serverFieldErrors.capital)}
                      aria-invalid={ariaInvalid}
                      aria-describedby={ariaDescribedby}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9.]/g, '')
                        setServerFieldErrors((s) => ({ ...s, capital: null }))
                        setDraft((d) => ({ ...d, capital: val }))
                      }}
                    />
                  )}
                </Field>

                <Field
                  label="Max spend per order"
                  help="Caps the size of any single order."
                  error={(touched ? errors.maxPerOrder : null) || serverFieldErrors.maxPerOrder || null}
                >
                  {({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby }) => (
                    <Input
                      id={id}
                      prefix="$"
                      inputMode="decimal"
                      value={draft.maxPerOrder}
                      error={(touched && errors.maxPerOrder) || Boolean(serverFieldErrors.maxPerOrder)}
                      aria-invalid={ariaInvalid}
                      aria-describedby={ariaDescribedby}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9.]/g, '')
                        setServerFieldErrors((s) => ({ ...s, maxPerOrder: null }))
                        setDraft((d) => ({ ...d, maxPerOrder: val }))
                      }}
                    />
                  )}
                </Field>
              </div>

              {draft.triggerType !== 'alpha_research' && (draft.direction ?? 'buy') === 'buy' && (
                <div className="tl-exit-protect-card" data-testid="exit-conditions">
                  <div className="tl-exit-protect-head">
                    <div>
                      <strong className="tl-label" style={{ display: 'block', fontSize: '14.5px' }}>Exit &amp; Protect</strong>
                    </div>
                    {exitSummaries.length > 0 && <span className="tl-tag">{exitSummaries.length} active</span>}
                  </div>
                  <fieldset className="tl-conditions" style={{ border: 0, padding: 0, margin: 0 }}>
                    <label className="tl-check">
                      <input type="checkbox" checked={Boolean(draft.exit?.stopLoss?.on)} data-testid="exit-stoploss"
                        onChange={(e) => setDraft((d) => ({ ...d, exit: { ...(d.exit ?? {}), stopLoss: { ...(d.exit?.stopLoss ?? { pct: '10' }), on: e.target.checked } } }))} />
                      <span>Price falls</span>
                      <input className="tl-input tl-input--inline" inputMode="decimal" aria-label="Stop-loss percent" value={draft.exit?.stopLoss?.pct ?? '10'} disabled={!draft.exit?.stopLoss?.on}
                        onChange={(e) => setDraft((d) => ({ ...d, exit: { ...(d.exit ?? {}), stopLoss: { ...(d.exit?.stopLoss ?? {}), pct: e.target.value } } }))} />
                      <span>% below what it paid</span>
                    </label>
                    <label className="tl-check">
                      <input type="checkbox" checked={Boolean(draft.exit?.trend?.on)} data-testid="exit-trend"
                        onChange={(e) => setDraft((d) => ({ ...d, exit: { ...(d.exit ?? {}), trend: { ...(d.exit?.trend ?? { symbol: 'SPY' }), on: e.target.checked } } }))} />
                      <span>{draft.exit?.trend?.symbol ?? 'SPY'}’s trend turns down (below its 200-day average)</span>
                    </label>
                    <label className="tl-check">
                      <input type="checkbox" checked={Boolean(draft.exit?.reversal?.on)} data-testid="exit-reversal"
                        onChange={(e) => setDraft((d) => ({ ...d, exit: { ...(d.exit ?? {}), reversal: { ...(d.exit?.reversal ?? { sessions: '10', pct: '5' }), on: e.target.checked } } }))} />
                      <span>Price falls</span>
                      <input className="tl-input tl-input--inline" inputMode="decimal" aria-label="Reversal percent" value={draft.exit?.reversal?.pct ?? '5'} disabled={!draft.exit?.reversal?.on}
                        onChange={(e) => setDraft((d) => ({ ...d, exit: { ...(d.exit ?? {}), reversal: { ...(d.exit?.reversal ?? {}), pct: e.target.value } } }))} />
                      <span>% over</span>
                      <input className="tl-input tl-input--inline" inputMode="numeric" aria-label="Reversal sessions" value={draft.exit?.reversal?.sessions ?? '10'} disabled={!draft.exit?.reversal?.on}
                        onChange={(e) => setDraft((d) => ({ ...d, exit: { ...(d.exit ?? {}), reversal: { ...(d.exit?.reversal ?? {}), sessions: e.target.value } } }))} />
                      <span>sessions</span>
                    </label>
                    {touched && errors.exit && <p className="tl-field-error" role="alert">{errors.exit}</p>}
                  </fieldset>
                </div>
              )}
            </div>
          </AlgorithmStep>
          </div>
          <section className="tl-algorithm-sentence" data-testid="builder-summary" aria-label="Strategy summary">
            <p>{actionSentence}</p>
            <span className="tl-small tl-muted">{simulated
              ? `Simulated money (${sessionDate(brokerStatus?.session)} close)`
              : mode === 'paper' ? 'Paper trading (simulated money)' : 'Account not connected'}</span>
          </section>

          {/* ── Section 3: More settings ─────────────────────────────────── */}
          <Disclosure
            label="Limits & schedule"
            meta={settingsMetaText}
            open={activeStep === 'more'}
            onToggle={() => openStep('more')}
            testId="section-more"
            className="tl-algorithm-limits"
          >
            <div style={{ display: 'grid', gap: 18 }}>
              <ul className="tl-builder-summary-guards" data-testid="builder-guards">
                {guards.map((g) => <li key={g}>{g}</li>)}
              </ul>
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
                    error={(touched && errors.cooldown) || Boolean(serverFieldErrors.cooldown)}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '')
                      setServerFieldErrors((s) => ({ ...s, cooldown: null }))
                      setDraft((d) => ({
                        ...d,
                        cooldown: { ...d.cooldown, hours: val, on: true },
                      }))
                    }}
                  />
                  <span className="tl-muted">hours</span>
                </div>
                {((touched && errors.cooldown) || serverFieldErrors.cooldown) && (
                  <p className="tl-field-error" role="alert">
                    {errors.cooldown || serverFieldErrors.cooldown}
                  </p>
                )}
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
                    error={(touched && errors.positionLimit) || Boolean(serverFieldErrors.positionLimit)}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '')
                      setServerFieldErrors((s) => ({ ...s, positionLimit: null }))
                      setDraft((d) => ({
                        ...d,
                        positionLimit: { ...d.positionLimit, maxShares: val, on: true },
                      }))
                    }}
                  />
                  <span className="tl-muted">shares per symbol</span>
                </div>
                {((touched && errors.positionLimit) || serverFieldErrors.positionLimit) && (
                  <p className="tl-field-error" role="alert">
                    {errors.positionLimit || serverFieldErrors.positionLimit}
                  </p>
                )}
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
                    error={(touched && errors.dailyLoss) || Boolean(serverFieldErrors.dailyLoss)}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '')
                      setServerFieldErrors((s) => ({ ...s, dailyLoss: null }))
                      setDraft((d) => ({
                        ...d,
                        dailyLoss: { ...d.dailyLoss, maxLoss: val, on: true },
                      }))
                    }}
                  />
                </div>
                {((touched && errors.dailyLoss) || serverFieldErrors.dailyLoss) && (
                  <p className="tl-field-error" role="alert">
                    {errors.dailyLoss || serverFieldErrors.dailyLoss}
                  </p>
                )}
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
                <div className="tl-builder-subsection">
                  <h4>When research can be used</h4>
                  <div className="tl-responsive-fields">
                    <Field
                      label="Maximum prediction age"
                      help="Hours since publication (1–720)"
                      error={(touched ? errors.maxAgeHours : null) || serverFieldErrors.maxAgeHours || null}
                    >
                      {({ id, 'aria-invalid': ariaInvalid }) => (
                        <Input
                          id={id}
                          inputMode="numeric"
                          value={draft.research.maxAgeHours}
                          error={(touched && errors.maxAgeHours) || Boolean(serverFieldErrors.maxAgeHours)}
                          aria-invalid={ariaInvalid}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '')
                            setServerFieldErrors((s) => ({ ...s, maxAgeHours: null }))
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
                      error={(touched ? errors.maxDriftPct : null) || serverFieldErrors.maxDriftPct || null}
                    >
                      {({ id, 'aria-invalid': ariaInvalid }) => (
                        <Input
                          id={id}
                          inputMode="numeric"
                          value={draft.research.maxDriftPct}
                          error={(touched && errors.maxDriftPct) || Boolean(serverFieldErrors.maxDriftPct)}
                          aria-invalid={ariaInvalid}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '')
                            setServerFieldErrors((s) => ({ ...s, maxDriftPct: null }))
                            setDraft((d) => ({
                              ...d,
                              research: { ...d.research, maxDriftPct: val },
                            }))
                          }}
                        />
                      )}
                    </Field>
                  </div>
                  <p className="tl-small tl-muted m0" data-testid="research-evidence-rule">
                    <strong>Evidence required.</strong> The bot only trades research whose holdout beat the
                    always-up baseline on out-of-sample data. This can’t be turned off in the beta.
                  </p>
                </div>
              )}
            </div>
          </Disclosure>
        </section>

        <BacktestPanel
          preview={builtBot}
          initialRange={windowQuery === '5Y' || templateQuery ? '5Y' : windowQuery === '3Y' ? '3Y' : '1Y'}
          linkBotId={isEdit && !hasChanges ? botId : null}
          onApplyVariant={(set) => setDraft((d) => {
            const next = { ...d }
            if (set.triggerPrice !== undefined) next.trigger = { ...(d.trigger ?? {}), price: String(set.triggerPrice) }
            if (set.cooldownDays !== undefined) next.cooldown = { ...(d.cooldown ?? {}), on: true, hours: String(set.cooldownDays * 24) }
            if (set.maxOrderNotional !== undefined) next.maxPerOrder = String(set.maxOrderNotional)
            if (set.allocatedAmount !== undefined) next.capital = String(set.allocatedAmount)
            return next
          })}
          blockedReason={
            draft.triggerType === 'alpha_research'
              ? 'Research bots can’t be backtested yet: Alpha Engine has no point-in-time research history to replay.'
              : errors.symbols || errors.triggerPrice || errors.capital || errors.maxPerOrder || errors.relVolume || errors.priceChange || errors.exit
                ? 'Fix the highlighted fields to run a backtest.'
                : null
          }
        />

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

        {/* Concurrency conflict notice (409 STALE_BOT) */}
        {staleError && (
          <div className="tl-notice tl-notice--warn" role="alert" data-testid="stale-bot-notice" style={{ marginTop: 18 }}>
            <div style={{ display: 'grid', gap: 10 }}>
              <span>{staleError.message}</span>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button
                  variant="secondary"
                  size="small"
                  type="button"
                  onClick={handleReloadBot}
                  data-testid="reload-btn"
                >
                  Load latest and keep my changes
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Submit error alert */}
        {submitError && !staleError && (
          <div className="tl-notice tl-notice--error tl-builder-notice" role="alert" data-testid="submit-error">
            <span>{submitError.message}</span>
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
              (!isEdit && !wizardData?.portfolioId)
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


/** Existing bots keep their full rule editor; new bots use the direct configuration form. */
export default function AlgorithmBuilder() {
  const { id, botId } = useParams()
  return id || botId ? <LegacyAlgorithmBuilder /> : <SimpleCreateBot />
}
