import { get, post, put } from '../../../api/client'

export const MAX_CAPITAL = 10_000_000
export const DEFAULT_CAPITAL = 1_000

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Normalizes a BotTemplate row into what the wizard shows. */
export function normalizeTemplate(t) {
  const config = t?.config && typeof t.config === 'object' ? t.config : {}
  const tickers = Array.isArray(config.tickers) ? config.tickers.filter(Boolean).map(String) : []
  // The bot engine throws "not yet implemented" for every strategy_based bot,
  // so those templates are listed but cannot be selected.
  const available = t?.botType === 'rule_based'
  return {
    id: t.id,
    name: t.name || t.id,
    description: t.description || '',
    botType: t.botType ?? null,
    direction: typeof config.direction === 'string' ? config.direction : null,
    tickers,
    config,
    rules: Array.isArray(t.rules) ? t.rules : [],
    tags: Array.isArray(t.tags) ? t.tags : [],
    research: config.signalSource === 'alpha_research' ? researchDefaults(config.research) : null,
    available,
    unavailableReason: available ? null : 'Not available yet — strategy-based bots can’t run in the bot engine.',
  }
}

// Mirrors the bot engine's research policy bounds (worker/src/engine/researchDecision.js).
export const RESEARCH_LIMITS = {
  minConfidencePct: { min: 0, max: 100 },
  maxAgeHours: { min: 1, max: 720 },
  maxDriftPct: { min: 0, max: 50 },
}

function researchDefaults(research) {
  const r = research && typeof research === 'object' ? research : {}
  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback)
  return {
    minConfidencePct: Math.round(num(r.minConfidence, 0.6) * 100),
    maxAgeHours: num(r.maxPredictionAgeHours, 96),
    maxDriftPct: num(r.maxEntryDriftPct, 5),
    requireEdge: r.requireEdgeOverBaseline !== false,
    base: r,
  }
}

/** Field errors for research settings. Empty object = valid. */
export function validateResearch(values) {
  const errors = {}
  for (const [key, { min, max }] of Object.entries(RESEARCH_LIMITS)) {
    const n = toNumberOrNull(values?.[key])
    if (n === null || n < min || n > max) errors[key] = `Enter a number from ${min} to ${max}.`
  }
  return errors
}

/** Wizard values → config.research, keeping template keys the wizard doesn't edit. */
export function toResearchConfig(values, base = {}) {
  return {
    ...base,
    minConfidence: Number(values.minConfidencePct) / 100,
    maxPredictionAgeHours: Number(values.maxAgeHours),
    maxEntryDriftPct: Number(values.maxDriftPct),
    requireEdgeOverBaseline: values.requireEdge !== false,
  }
}

/** What a template's bot does, in plain words. */
export function describeTemplateAction(template) {
  if (template?.research) return 'Buys on current Alpha Engine BUY research; sells shares it holds on SELL research'
  return describeDirection(template?.direction)
}

export function describeDirection(direction) {
  switch (direction) {
    case 'buy': return 'Buy orders only'
    case 'sell': return 'Sell orders only, for shares you already hold'
    case 'both': return 'Buy and sell orders'
    default: return 'Not specified by this template'
  }
}

/** Parses "aapl, msft  nvda" → ['AAPL', 'MSFT', 'NVDA'] (deduped). */
export function parseSymbols(text) {
  const seen = new Set()
  for (const raw of String(text ?? '').split(/[\s,]+/)) {
    const s = raw.trim().toUpperCase()
    if (s) seen.add(s)
  }
  return [...seen]
}

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/

export function defaultCapital(template, buyingPower) {
  const fromTemplate = toNumberOrNull(template?.config?.allocatedAmount)
  const base = fromTemplate && fromTemplate > 0 ? fromTemplate : DEFAULT_CAPITAL
  if (buyingPower !== null && buyingPower !== undefined && buyingPower > 0) {
    return Math.min(base, Math.floor(buyingPower))
  }
  return base
}

export function defaultMaxPerOrder(template, capital) {
  const fromTemplate = toNumberOrNull(template?.config?.maxOrderNotional)
  if (fromTemplate && fromTemplate > 0 && capital) return Math.min(fromTemplate, capital)
  return capital ?? null
}

/** Field errors for the allocation step. Empty object = valid. */
export function validateAllocation({ capital, symbolsText }, { buyingPower, templateTickers }) {
  const errors = {}
  const amount = toNumberOrNull(capital)
  if (amount === null) errors.capital = 'Enter a valid amount.'
  else if (amount <= 0) errors.capital = 'Amount must be greater than $0.'
  else if (amount > MAX_CAPITAL) errors.capital = 'Amount is too large.'
  else if (buyingPower !== null && buyingPower !== undefined && amount > buyingPower) {
    errors.capital = 'Amount is more than your paper buying power.'
  }

  if (!templateTickers || templateTickers.length === 0) {
    const symbols = parseSymbols(symbolsText)
    if (symbols.length === 0) errors.symbols = 'Add at least one symbol for this bot to trade.'
    else if (symbols.some((s) => !SYMBOL_RE.test(s))) errors.symbols = 'Use ticker symbols like AAPL or BRK.B.'
  }
  return errors
}

export function validateControls({ maxPerOrder, name, symbolsText }, { capital }) {
  const errors = {}
  const max = toNumberOrNull(maxPerOrder)
  if (max === null) errors.maxPerOrder = 'Enter a valid amount.'
  else if (max <= 0) errors.maxPerOrder = 'Must be greater than $0.'
  else if (capital !== null && max > capital) errors.maxPerOrder = 'Can’t be more than the bot’s simulated capital.'

  if (!String(name ?? '').trim()) errors.name = 'Give your bot a name.'

  if (symbolsText !== undefined) {
    const symbols = parseSymbols(symbolsText)
    if (symbols.length === 0) errors.symbols = 'Add at least one symbol.'
    else if (symbols.some((s) => !SYMBOL_RE.test(s))) errors.symbols = 'Use ticker symbols like AAPL or BRK.B.'
  }
  return errors
}

async function settle(promise) {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error }
  }
}

export async function loadWizardData() {
  const [catalog, account, portfolio] = await Promise.all([
    settle(get('/bots/catalog')),
    settle(get('/account')),
    settle(get('/portfolios/default')),
  ])

  let templates = []
  let catalogError = null
  if (catalog.ok) {
    const c = catalog.value ?? {}
    const rows = Array.isArray(c) ? c : [...(c.ruleBased ?? []), ...(c.strategyBased ?? [])]
    templates = rows.map(normalizeTemplate)
  } else {
    catalogError = 'We couldn’t load the bot catalog.'
  }

  return {
    templates,
    catalogError,
    buyingPower: account.ok ? toNumberOrNull(account.value?.buying_power) : null,
    portfolioId: portfolio.ok ? portfolio.value?.id ?? null : null,
    portfolioError: portfolio.ok ? null : 'We couldn’t load your portfolio.',
  }
}

export function friendlyCreateError(error) {
  const code = error?.code
  if (code === 'LIVE_TRADING_DISABLED') return 'Your connected account is a live account. Live trading is disabled — connect a paper account to create bots.'
  if (code === 'BROKER_NOT_CONFIGURED') return 'Connect a paper trading account before creating a bot.'
  if (code === 'BROKER_CREDENTIALS_INVALID') return 'Your paper account credentials were rejected. Reconnect your account and try again.'
  if (code === 'INVALID_PORTFOLIO') return 'Your portfolio couldn’t be found. Reload the page and try again.'
  if (code === 'NOT_FOUND') return 'That bot template is no longer available. Choose another bot.'
  if (code === 'INVALID_CONFIG') return 'The server rejected these settings. Check the capital and order limit, then try again.'
  if (error?.status === 401) return 'Your session expired. Sign in again.'
  return 'We couldn’t create your bot. Nothing was saved. Try again.'
}

/**
 * Creates the bot atomically (paused, with capital and limits), then — because
 * the user has confirmed on the Review step — explicitly activates it.
 *
 * `POST /bots/catalog/from-template` persists config.{allocatedAmount,
 * maxOrderNotional, capitalMode} and rules in one transaction and creates the
 * bot paused (`enabled: false`). Activation is a separate `PUT { enabled: true }`.
 * If activation fails, the bot already exists, paused, with the confirmed
 * limits; the result says so and links to it rather than retrying creation.
 */
export async function createAndStartBot({ template, portfolioId, name, tickers, capital, maxPerOrder, research }) {
  let created
  try {
    created = await post('/bots/catalog/from-template', {
      templateId: template.id,
      portfolioId,
      name,
      tickers,
      capitalMode: 'allocated',
      allocatedAmount: capital,
      maxOrderNotional: maxPerOrder,
      riskOnExposure: 1,
      enabled: false,
      ...(template.research && research ? { config: { research: toResearchConfig(research, template.research.base) } } : {}),
    })
  } catch (error) {
    return { ok: false, stage: 'create', message: friendlyCreateError(error) }
  }

  const botId = created?.id
  if (!botId) {
    return { ok: false, stage: 'create', message: 'The server didn’t return the new bot. Check your bots list before trying again.' }
  }

  try {
    await put(`/bots/${botId}`, { enabled: true })
    return { ok: true, botId }
  } catch (error) {
    return {
      ok: false,
      stage: 'activate',
      botId,
      paused: true,
      message: `Your bot was created with your limits but couldn’t be started, so it’s paused. ${friendlyActivateError(error)}`,
    }
  }
}

function friendlyActivateError(error) {
  const code = error?.code
  if (code === 'BROKER_NOT_CONFIGURED' || code === 'BROKER_CREDENTIALS_INVALID') return 'Connect a paper trading account, then resume it from its page.'
  if (code === 'LIVE_TRADING_DISABLED') return 'Live trading is disabled; connect a paper account, then resume it.'
  return 'Open the bot to resume it.'
}
