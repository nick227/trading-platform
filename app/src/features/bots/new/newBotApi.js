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
    available,
    unavailableReason: available ? null : 'Not available yet — strategy-based bots can’t run in the bot engine.',
  }
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
  if (error?.status === 401) return 'Your session expired. Sign in again.'
  return 'We couldn’t create your bot. Nothing was saved. Try again.'
}

/**
 * Creates the bot, then saves its capital/limits and starts it.
 *
 * `from-template` cannot persist allocation or limits (its schema accepts only
 * tickers/quantity and the service always creates the bot enabled), so a
 * second PUT writes config.{capitalMode, allocatedAmount, maxOrderNotional}
 * — the fields the bot engine already uses to size buy orders.
 *
 * If that second step fails, the bot is paused so it never runs without the
 * limits the user confirmed, and the result reports a partial failure.
 */
export async function createAndStartBot({ template, portfolioId, name, tickers, capital, maxPerOrder }) {
  let created
  try {
    created = await post('/bots/catalog/from-template', {
      templateId: template.id,
      portfolioId,
      name,
      tickers,
      enabled: false,
    })
  } catch (error) {
    return { ok: false, stage: 'create', message: friendlyCreateError(error) }
  }

  const botId = created?.id
  if (!botId) {
    return { ok: false, stage: 'create', message: 'The server didn’t return the new bot. Check your bots list before trying again.' }
  }

  const config = {
    ...(created.config && typeof created.config === 'object' ? created.config : {}),
    tickers,
    capitalMode: 'allocated',
    allocatedAmount: capital,
    riskOnExposure: 1,
    maxOrderNotional: maxPerOrder,
  }

  try {
    await put(`/bots/${botId}`, { config, enabled: true })
    return { ok: true, botId }
  } catch (error) {
    let paused = false
    try {
      await put(`/bots/${botId}`, { enabled: false })
      paused = true
    } catch {
      paused = false
    }
    return {
      ok: false,
      stage: 'configure',
      botId,
      paused,
      message: paused
        ? 'Your bot was created, but its capital and limits couldn’t be saved, so it has been paused. Open the bot to review it.'
        : 'Your bot was created, but its capital and limits couldn’t be saved and we couldn’t confirm it is paused. Open the bot and pause it.',
    }
  }
}
