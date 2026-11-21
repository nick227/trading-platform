/**
 * Bot dashboard adapter — the single place the consumer bot UI talks to the
 * backend. Every loader distinguishes "unavailable" (request failed / field not
 * supplied) from "empty" (backend answered with nothing), so screens never
 * fabricate values or activity.
 *
 * Contracts used (existing):
 *   GET    /api/bots/:id                 → { data: Bot }
 *   GET    /api/bots/:id/events          → { data: BotEvent[], pagination }
 *   GET    /api/bots/:id/rules           → { data: BotRule[] }
 *   GET    /api/executions?botId=&limit= → { data: Execution[], pagination }
 *   GET    /api/account                  → { buying_power, cash, equity }
 *   PUT    /api/bots/:id                 → { data: Bot }
 *   DELETE /api/bots/:id                 → 204 (soft delete = Stopped)
 */
import { get, put, del } from '../client'

export const ACTIVITY_LIMIT = 50

export function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function asArray(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.data)) return value.data
  if (Array.isArray(value?.events)) return value.events
  return null
}

async function settle(promise) {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error }
  }
}

// ── Bot ─────────────────────────────────────────────────────────────────────

/**
 * Performance is shown only when the backend supplies it. Accepts a
 * `performance` object on the bot payload; anything else is "unavailable".
 */
export function normalizePerformance(raw) {
  if (!raw || typeof raw !== 'object') return null
  const realized = toNumberOrNull(raw.realizedPnl ?? raw.realized_pnl)
  const unrealized = toNumberOrNull(raw.unrealizedPnl ?? raw.unrealized_pnl)
  const total = toNumberOrNull(raw.totalPnl ?? raw.total_pnl) ?? (realized !== null && unrealized !== null ? realized + unrealized : null)
  if (realized === null && unrealized === null && total === null) return null
  return {
    realized,
    unrealized,
    total,
    fees: toNumberOrNull(raw.fees),
    asOf: raw.asOf ?? raw.as_of ?? null,
  }
}

export function normalizeBot(raw) {
  if (!raw || typeof raw !== 'object') return null
  const config = raw.config && typeof raw.config === 'object' ? raw.config : {}
  return {
    id: raw.id,
    name: raw.name || 'Untitled bot',
    enabled: raw.enabled === true,
    stopped: Boolean(raw.deletedAt),
    botType: raw.botType ?? null,
    templateId: raw.templateId ?? null,
    strategyName: raw.strategy?.name ?? null,
    tickers: Array.isArray(config.tickers) ? config.tickers.filter(Boolean).map(String) : [],
    direction: typeof config.direction === 'string' ? config.direction : null,
    allocation: toNumberOrNull(config.allocatedAmount ?? config.allocation),
    maxPerOrder: toNumberOrNull(config.maxOrderNotional),
    config,
    performance: normalizePerformance(raw.performance),
    capitalInUse: toNumberOrNull(raw.capitalInUse ?? raw.capital_in_use),
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  }
}

/** Running | Paused | Stopped | Error. Error = running, and the newest activity is an error. */
export function deriveStatus(bot, timeline = []) {
  if (!bot) return 'unknown'
  if (bot.stopped) return 'stopped'
  if (!bot.enabled) return 'paused'
  const latest = timeline[0]
  if (latest && latest.category === 'error') return 'error'
  return 'running'
}

export const STATUS_LABELS = {
  running: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
  error: 'Error',
  unknown: 'Unknown',
}

// ── Activity timeline ───────────────────────────────────────────────────────

const SKIP_REASONS = {
  inflight_exists: { title: 'Skipped — order already open', text: (s) => `An order for ${s} is still open, so the bot waited.` },
  no_position: { title: 'Skipped a sell', text: (s) => `There were no ${s} shares to sell.` },
  invalid_quantity: { title: 'Skipped — order too small', text: () => 'The maximum order size was too small to buy a single share at the current price.' },
  missing_direction: { title: 'Skipped — no direction', text: () => 'The bot couldn’t tell whether to buy or sell.' },
  invalid_direction: { title: 'Skipped — no direction', text: () => 'The signal had no valid buy or sell direction.' },
  missing_user_context: { title: 'Skipped — account unavailable', text: () => 'The bot couldn’t confirm which account to use.' },
  market_closed: { title: 'Waiting — market closed', text: () => 'This bot only trades during market hours.' },
  time_window_outside: { title: 'Waiting — outside trading window', text: () => 'This bot only trades during its set time window.' },
  cooldown_active: { title: 'Waiting — cooldown', text: (s) => `The bot traded ${s} recently and is waiting before trading it again.` },
  stale_price_data: { title: 'Skipped — no fresh price', text: (s) => `A current price for ${s} wasn’t available.` },
  no_price_available: { title: 'Skipped — no price', text: (s) => `A price for ${s} wasn’t available.` },
  trend_filter_not_confirmed: { title: 'Waiting — trend not confirmed', text: () => 'The market trend condition wasn’t confirmed yet.' },
  trend_filter_regime_mismatch: { title: 'Waiting — trend condition not met', text: () => 'The market trend didn’t match this bot’s condition.' },
  trend_filter_missing_snapshot: { title: 'Skipped — trend data missing', text: () => 'Market trend data wasn’t available.' },
  trend_filter_snapshot_stale: { title: 'Skipped — trend data out of date', text: () => 'Market trend data was too old to use.' },
}

const RISK_REASONS = new Set(['position_limit_reached', 'daily_loss_limit_reached', 'max_slots_reached', 'single_ticker_limit', 'exposure_critical', 'exposure_warning', 'overnight_not_allowed', 'rate_limit_exceeded'])

const RISK_TEXT = {
  position_limit_reached: 'The position limit for this symbol was reached.',
  daily_loss_limit_reached: 'Today’s loss limit was reached, so no new orders were placed.',
  max_slots_reached: 'The maximum number of open positions was reached.',
  single_ticker_limit: 'Too much of the account is already in this symbol.',
  exposure_critical: 'Account exposure is too high for new orders.',
  exposure_warning: 'Account exposure is high.',
  overnight_not_allowed: 'Holding overnight isn’t allowed for this bot.',
  rate_limit_exceeded: 'Too many orders in a short time.',
}

function sideWord(side, past = false) {
  const s = String(side ?? '').toLowerCase()
  if (s === 'buy') return past ? 'Bought' : 'buy'
  if (s === 'sell') return past ? 'Sold' : 'sell'
  return past ? 'Traded' : 'order'
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const fmt = (n) => (n === null || n === undefined ? null : money.format(n))

/** Maps one BotEvent row to a timeline item. Unknown types are kept, not dropped. */
export function eventToItem(e) {
  const meta = e?.metadata && typeof e.metadata === 'object' ? e.metadata : {}
  // `confidence` is a fixed engine heuristic (not a calibrated probability, per
  // recommendation contract v2), so it is never shown, even in diagnostics.
  const { confidence: _heuristicConfidence, ...shownMeta } = meta
  const symbol = meta.ticker ?? null
  const sym = symbol ?? 'this symbol'
  const reason = meta.reason ?? null
  const base = {
    id: `evt:${e.id}`,
    at: e.createdAt ?? null,
    symbol,
    diagnostics: { source: 'event', type: e.type, detail: e.detail ?? null, ...shownMeta },
    executionId: meta.executionId ?? e.executionId ?? null,
  }

  switch (e.type) {
    case 'signal_hold':
    case 'decision_made':
      if (e.type === 'decision_made' && meta.signal && meta.signal !== 'hold') {
        return { ...base, category: 'signal', title: `Signal: ${sideWord(meta.signal)}`, explanation: e.detail || `The strategy signalled a ${sideWord(meta.signal)} for ${sym}.` }
      }
      return { ...base, category: 'evaluation', title: 'Checked — no trade', explanation: `Evaluated ${sym}; conditions for a trade weren’t met.` }
    case 'rule_triggered':
      return { ...base, category: 'signal', title: 'Rule triggered', explanation: e.detail || `A rule fired for ${sym}.` }
    case 'execution_created':
      return {
        ...base,
        category: 'order',
        title: `Paper ${sideWord(meta.side ?? meta.direction ?? meta.signal)} order placed`,
        explanation: meta.quantity ? `${meta.quantity} shares of ${sym}.` : `Order for ${sym}.`,
      }
    case 'execution_blocked_by_risk':
      return { ...base, category: 'risk', title: 'Blocked by risk limits', explanation: RISK_TEXT[reason] ?? 'A risk check stopped this order.' }
    case 'execution_skipped': {
      if (reason && RISK_REASONS.has(reason)) {
        return { ...base, category: 'risk', title: 'Blocked by a limit', explanation: RISK_TEXT[reason] ?? 'A limit stopped this order.' }
      }
      const known = reason && SKIP_REASONS[reason]
      if (known) return { ...base, category: 'skip', title: known.title, explanation: known.text(sym) }
      return { ...base, category: 'skip', title: 'Skipped', explanation: e.detail || 'The bot decided not to trade.' }
    }
    case 'execution_failed':
      return { ...base, category: 'error', title: 'Order couldn’t be placed', explanation: 'The paper order wasn’t created. See details.' }
    case 'risk_evaluation_failed':
      return { ...base, category: 'error', title: 'Risk check failed', explanation: 'The risk check couldn’t run, so no order was placed.' }
    case 'strategy_error':
    case 'error_occurred':
      return { ...base, category: 'error', title: 'Strategy error', explanation: 'The bot couldn’t evaluate its strategy. See details.' }
    default:
      return { ...base, category: 'other', title: String(e.type ?? 'Event').replace(/_/g, ' '), explanation: e.detail || '' }
  }
}

export function normalizeExecution(x) {
  return {
    id: x.id,
    symbol: x.ticker ?? null,
    side: x.direction ?? null,
    quantity: toNumberOrNull(x.quantity),
    filledQuantity: toNumberOrNull(x.filledQuantity),
    intentPrice: toNumberOrNull(x.price),
    filledPrice: toNumberOrNull(x.filledPrice),
    status: x.status ?? null,
    cancelReason: x.cancelReason ?? null,
    brokerStatus: x.brokerStatus ?? null,
    costs: (toNumberOrNull(x.fees) ?? 0) + (toNumberOrNull(x.commission) ?? 0),
    createdAt: x.createdAt ?? null,
    submittedAt: x.submittedAt ?? null,
    filledAt: x.filledAt ?? null,
    updatedAt: x.lastBrokerSyncAt ?? x.submittedAt ?? x.createdAt ?? null,
  }
}

/** Order outcome item for an execution (filled / rejected / cancelled / in progress). */
export function executionToItems(x, { hasCreatedEvent }) {
  const items = []
  const diagnostics = { source: 'execution', executionId: x.id, status: x.status, brokerStatus: x.brokerStatus, cancelReason: x.cancelReason, intentPrice: x.intentPrice, quantity: x.quantity }
  const sym = x.symbol ?? 'symbol'
  if (!hasCreatedEvent) {
    items.push({
      id: `exe:${x.id}:created`, at: x.createdAt, symbol: x.symbol, category: 'order', executionId: x.id, diagnostics,
      title: `Paper ${sideWord(x.side)} order placed`,
      explanation: x.quantity !== null ? `${x.quantity} shares of ${sym}.` : `Order for ${sym}.`,
    })
  }
  const qty = x.filledQuantity ?? x.quantity
  switch (x.status) {
    case 'filled':
    case 'partially_filled':
      items.push({
        id: `exe:${x.id}:fill`, at: x.filledAt ?? x.updatedAt, symbol: x.symbol, category: 'fill', executionId: x.id, diagnostics,
        title: x.status === 'filled' ? `${sideWord(x.side, true)} ${qty ?? ''} ${sym}`.replace(/\s+/g, ' ').trim() : `Partly filled: ${sym}`,
        explanation: [x.filledPrice !== null ? `at ${fmt(x.filledPrice)}` : null, x.costs > 0 ? `costs ${fmt(x.costs)}` : null].filter(Boolean).join(' · ') || 'Paper fill.',
      })
      break
    case 'failed':
      items.push({ id: `exe:${x.id}:failed`, at: x.updatedAt, symbol: x.symbol, category: 'error', executionId: x.id, diagnostics, title: 'Order rejected', explanation: x.cancelReason || 'The paper broker rejected this order.' })
      break
    case 'cancelled':
      items.push({ id: `exe:${x.id}:cancelled`, at: x.updatedAt, symbol: x.symbol, category: 'order', executionId: x.id, diagnostics, title: 'Order cancelled', explanation: x.cancelReason || 'This order was cancelled.' })
      break
    case 'processing':
    case 'submitted':
      if (x.submittedAt) items.push({ id: `exe:${x.id}:sent`, at: x.submittedAt, symbol: x.symbol, category: 'order', executionId: x.id, diagnostics, title: 'Sent to paper broker', explanation: 'Waiting for a fill.' })
      break
    default:
      break
  }
  return items
}

const GROUPABLE = new Set(['evaluation', 'skip'])

/** Collapses consecutive identical routine entries (e.g. repeated "no trade" checks). */
export function groupRepeats(items) {
  const out = []
  for (const item of items) {
    const prev = out[out.length - 1]
    if (prev && GROUPABLE.has(item.category) && prev.category === item.category && prev.title === item.title && prev.symbol === item.symbol) {
      prev.count += 1
      prev.since = item.at
      continue
    }
    out.push({ ...item, count: 1, since: item.at })
  }
  return out
}

/** Merges events and executions into one newest-first timeline. */
export function buildTimeline(events, executions) {
  const eventItems = (events ?? []).map(eventToItem)
  const createdIds = new Set(eventItems.filter((i) => i.category === 'order' && i.executionId).map((i) => i.executionId))
  const execItems = (executions ?? []).flatMap((x) => executionToItems(x, { hasCreatedEvent: createdIds.has(x.id) }))
  const all = [...eventItems, ...execItems].sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0))
  return groupRepeats(all)
}

/** Factual totals from filled executions only. Not P/L. */
export function summarizeFills(executions) {
  if (!executions) return null
  const fills = executions.filter((x) => x.status === 'filled' || x.status === 'partially_filled')
  return {
    filledOrders: fills.length,
    costs: fills.reduce((s, x) => s + (x.costs || 0), 0),
  }
}

// ── Loaders ─────────────────────────────────────────────────────────────────

export async function loadBotActivity(botId, { limit = ACTIVITY_LIMIT } = {}) {
  const [events, executions] = await Promise.all([
    settle(get(`/bots/${botId}/events`, { limit })),
    settle(get('/executions', { botId, limit })),
  ])
  const eventRows = events.ok ? asArray(events.value) : null
  const execRows = executions.ok ? asArray(executions.value) : null
  const normalizedExecs = execRows ? execRows.map(normalizeExecution) : null
  return {
    timeline: buildTimeline(eventRows ?? [], normalizedExecs ?? []),
    eventsAvailable: eventRows !== null,
    executionsAvailable: normalizedExecs !== null,
    executions: normalizedExecs,
  }
}

export async function loadBotDashboard(botId) {
  const [bot, activity, account] = await Promise.all([
    settle(get(`/bots/${botId}`)),
    loadBotActivity(botId),
    settle(get('/account')),
  ])
  if (!bot.ok) {
    const notFound = bot.error?.status === 404
    return { bot: null, notFound, error: notFound ? null : 'We couldn’t load this bot.' }
  }
  const normalized = normalizeBot(bot.value)
  return {
    bot: normalized,
    status: deriveStatus(normalized, activity.timeline),
    activity,
    buyingPower: account.ok ? toNumberOrNull(account.value?.buying_power) : null,
    fills: summarizeFills(activity.executions),
  }
}

export async function loadBotRules(botId) {
  const r = await settle(get(`/bots/${botId}/rules`))
  return r.ok ? asArray(r.value) ?? [] : null
}

// ── Controls ────────────────────────────────────────────────────────────────

export function controlErrorMessage(error, action) {
  const code = error?.code
  if (action === 'resume' && (code === 'BROKER_NOT_CONFIGURED' || code === 'BROKER_CREDENTIALS_INVALID' || error?.status === 403)) {
    return code === 'LIVE_TRADING_DISABLED'
      ? 'Can’t resume: your connected account is live, and live trading is disabled.'
      : 'Can’t resume: connect a paper trading account first.'
  }
  if (error?.status === 404) return 'This bot no longer exists.'
  const verb = { pause: 'pause', resume: 'resume', stop: 'stop', edit: 'save changes to' }[action] ?? 'update'
  return `Couldn’t ${verb} this bot. Nothing changed — try again.`
}

export const pauseBot = (id) => put(`/bots/${id}`, { enabled: false })
export const resumeBot = (id) => put(`/bots/${id}`, { enabled: true })
export const stopBot = (id) => del(`/bots/${id}`)

export function updateBotSettings(bot, { name, allocation, maxPerOrder }) {
  return put(`/bots/${bot.id}`, {
    name,
    config: {
      ...bot.config,
      capitalMode: 'allocated',
      allocatedAmount: allocation,
      riskOnExposure: bot.config?.riskOnExposure ?? 1,
      maxOrderNotional: maxPerOrder,
    },
  })
}
