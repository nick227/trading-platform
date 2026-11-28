/** Builder data: starting points, account cash and portfolio for the Algorithm Builder. */
import { get } from '../../../api/client'

export const MAX_CAPITAL = 10_000_000
export const DEFAULT_CAPITAL = 1_000

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
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

/** Parses "aapl, msft  nvda" → ['AAPL', 'MSFT', 'NVDA'] (deduped). */
export function parseSymbols(text) {
  const seen = new Set()
  for (const raw of String(text ?? '').split(/[\s,]+/)) {
    const s = raw.trim().toUpperCase()
    if (s) seen.add(s)
  }
  return [...seen]
}

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
