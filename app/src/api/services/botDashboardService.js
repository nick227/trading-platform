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
  // A total is only meaningful when unrealized P/L is known; the backend currently
  // sends totalPnl === realizedPnl with unrealizedPnl: null, which would overstate it.
  const total = unrealized === null
    ? null
    : toNumberOrNull(raw.totalPnl ?? raw.total_pnl) ?? (realized !== null ? realized + unrealized : null)
  if (realized === null && unrealized === null) return null
  return {
    realized,
    unrealized,
    total,
    valuation: raw.valuation && typeof raw.valuation === 'object' ? raw.valuation : null,
    fees: toNumberOrNull(raw.fees),
    // Closed trades from the same FIFO pass as realized P/L (null until one closes).
    closedTrades: toNumberOrNull(raw.closedTrades),
    winRate: toNumberOrNull(raw.winRate),
    asOf: raw.asOf ?? raw.as_of ?? null,
  }
}

/** The bot's P&L at each daily close, with return and max drawdown against its allocation. */
export async function loadBotPerformanceHistory(botId, range = '1Y') {
  const res = await get(`/bots/${encodeURIComponent(botId)}/performance/history`, { range })
  return res?.data ?? res
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
    rules: Array.isArray(raw.rules) ? raw.rules : [],
    openPositions: raw.openPositions && typeof raw.openPositions === 'object' ? raw.openPositions : {},
    performance: normalizePerformance(raw.performance),
    // null from the backend means "not accurately attributable" → shown as unavailable.
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
  no_rules_configured: { title: 'Skipped — no rules', text: () => 'This bot has no rules to evaluate.' },
  market_closed: { title: 'Waiting — market closed', text: () => 'This bot only trades during market hours.' },
  time_window_outside: { title: 'Waiting — outside trading window', text: () => 'This bot only trades during its set time window.' },
  cooldown_active: { title: 'Waiting — cooldown', text: (s) => `The bot traded ${s} recently and is waiting before trading it again.` },
  stale_price_data: { title: 'Skipped — no fresh price', text: (s) => `A current price for ${s} wasn’t available.` },
  no_price_available: { title: 'Skipped — no price', text: (s) => `A price for ${s} wasn’t available.` },
  trend_filter_not_confirmed: { title: 'Waiting — trend not confirmed', text: () => 'The market trend condition wasn’t confirmed yet.' },
  trend_filter_regime_mismatch: { title: 'Waiting — trend condition not met', text: () => 'The market trend didn’t match this bot’s condition.' },
  trend_filter_missing_snapshot: { title: 'Skipped — trend data missing', text: () => 'Market trend data wasn’t available.' },
  trend_filter_snapshot_stale: { title: 'Skipped — trend data out of date', text: () => 'Market trend data was too old to use.' },
  prediction_already_acted: { title: 'Waiting — already acted on this research', text: (s) => `The bot already traded the current research for ${s}; it waits for new research.` },
  acted_this_session: { title: 'Done for today', text: (s) => `The bot already acted on ${s} at the latest close. It checks again after the next trading day’s close.` },
  no_current_session: { title: 'Waiting for market data', text: (s) => `No current daily close for ${s} yet, so the bot isn’t trading. It resumes when fresh prices arrive.` },
  refused_recently: { title: 'Waiting — last order was refused', text: (s) => `The last ${s} order was refused before it was sent, so the bot waits 15 minutes before trying again.` },
  relative_volume_below: { title: 'Waiting — volume below the condition', text: (s) => `${s}’s volume wasn’t high enough versus its 20-day average.` },
  relative_volume_unavailable: { title: 'Skipped — no volume data', text: (s) => `Volume for ${s} wasn’t available.` },
  price_change_rise_not_met: { title: 'Waiting — price hasn’t risen enough', text: (s) => `${s} hasn’t risen by the set amount over the lookback.` },
  price_change_fall_not_met: { title: 'Waiting — price hasn’t fallen enough', text: (s) => `${s} hasn’t fallen by the set amount over the lookback.` },
  price_change_unavailable: { title: 'Skipped — not enough price history', text: (s) => `Not enough daily closes for ${s} to measure the change.` },
  no_research_prediction: { title: 'Waiting — no research', text: (s) => `Alpha Engine has no current ranked research for ${s}.` },
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

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1)

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

  // Research-driven decisions carry the verified Alpha Engine evidence they were made on.
  if (e.type === 'decision_made' && meta.decision && meta.researchEvidence) {
    const ev = meta.researchEvidence
    const evaluation = ev.ranking?.evaluation ?? null
    const ctx = meta.decisionContext ?? {}
    const research = {
      decision: meta.decision, reason: ctx.reason ?? null, direction: ev.direction ?? null, horizon: ev.horizon ?? null,
      score: ev.confidence ?? null, observedAt: ev.observedAt ?? null, publicationId: ev.ranking?.publicationId ?? null,
      mode: ev.ranking?.mode ?? null, holdout: evaluation?.holdout ?? null,
      edgeOverBaseline: evaluation ? evaluation.edgeOverBaseline === true : null,
      genuineOutOfSample: evaluation ? evaluation.genuineOutOfSample === true : null,
      simulation: ctx.simulation ?? null,
    }
    const dir = sideWord(String(ev.direction ?? '').toLowerCase() === 'sell' ? 'sell' : 'buy')
    if (meta.decision === 'accepted') {
      return { ...base, category: 'signal', research, title: `Research: ${dir} ${sym}`,
        explanation: `Verified Alpha Engine ${dir} research (${ev.horizon ?? 'n/a'} horizon) accepted by this bot.` }
    }
    return { ...base, category: 'evaluation', research, title: `Research not traded: ${sym}`,
      explanation: RESEARCH_REASON_TEXT[ctx.reason] ?? `The research was ${meta.decision} (${ctx.reason ?? 'no reason recorded'}).` }
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
    case 'execution_created': {
      const rd = meta.riskDecision
      const side = sideWord(meta.side ?? meta.direction ?? meta.signal)
      const shares = meta.quantity ? `${meta.quantity} ${Number(meta.quantity) === 1 ? 'share' : 'shares'} of ${sym}.` : `Order for ${sym}.`
      if (rd?.basis === 'simulator_test_scenario') {
        return { ...base, category: 'order', riskDecision: rd, testScenario: true,
          title: `${cap(side)} order placed`,
          explanation: shares,
          note: `Isolated simulator test scenario — the normal risk policy would not place this order (${rd.decision}: ${MATRIX_TEXT[rd.reason] ?? rd.reason ?? 'not approved'}).` }
      }
      if (rd?.basis === 'restricted_reduced') {
        return { ...base, category: 'order', riskDecision: rd, title: `${cap(side)} order placed at reduced size`,
          explanation: `${shares} Risk restricted this trade (${MATRIX_TEXT[rd.reason] ?? rd.reason}), so only the reduced size was placed.` }
      }
      return { ...base, category: 'order', title: `${cap(side)} order placed`, explanation: shares }
    }
    case 'execution_blocked_by_risk': {
      const rd = meta.riskDecision
      if (rd) {
        const restricted = rd.basis === 'restricted_blocked'
        return { ...base, category: 'risk', riskDecision: rd, title: restricted ? 'Restricted by risk — not traded' : 'Rejected by risk',
          explanation: `${MATRIX_TEXT[rd.reason] ?? (rd.failedChecks?.length ? 'A risk limit failed.' : 'The risk engine didn’t approve this order.')}${restricted && rd.adjustedQuantity ? ` (would allow at most ${rd.adjustedQuantity} shares at reduced size; reduced-size trading is off)` : ''}` }
      }
      return { ...base, category: 'risk', title: 'Blocked by risk limits', explanation: RISK_TEXT[reason] ?? 'A risk check stopped this order.' }
    }
    case 'execution_skipped': {
      if (reason && RISK_REASONS.has(reason)) {
        return { ...base, category: 'risk', title: 'Blocked by a limit', explanation: RISK_TEXT[reason] ?? 'A limit stopped this order.' }
      }
      const known = reason && SKIP_REASONS[reason]
      if (known) return { ...base, category: 'skip', title: known.title, explanation: known.text(sym) }
      return { ...base, category: 'skip', title: 'Skipped', explanation: e.detail || 'The bot decided not to trade.' }
    }
    case 'execution_failed':
      return { ...base, category: 'error', title: 'Order couldn’t be placed', explanation: 'The order wasn’t created.' }
    case 'risk_evaluation_failed':
      return { ...base, category: 'error', title: 'Risk check failed', explanation: 'The risk check couldn’t run, so no order was placed.' }
    case 'strategy_error':
    case 'error_occurred':
      return { ...base, category: 'error', title: 'Strategy error', explanation: 'The bot couldn’t evaluate its strategy. See details.' }
    case 'bot_paused':
      return { ...base, category: 'control', title: 'Paused', explanation: 'The bot stopped placing new orders.' }
    case 'bot_resumed':
      return { ...base, category: 'control', title: 'Resumed', explanation: 'The bot is running again.' }
    case 'bot_stopped':
      return { ...base, category: 'control', title: 'Stopped', explanation: 'The bot was stopped for good.' }
    default:
      return { ...base, category: 'other', title: String(e.type ?? 'Event').replace(/_/g, ' '), explanation: e.detail || '' }
  }
}

const MATRIX_TEXT = {
  execution_weak: 'the signal was too weak to trust',
  execution_moderate: 'the signal was only moderately reliable',
  operational_critical: 'trading systems weren’t healthy enough',
  operational_degraded: 'trading systems were degraded',
  exposure_critical: 'the portfolio was too concentrated',
  exposure_warning: 'the portfolio was getting concentrated',
  stress_critical: 'the account is under drawdown stress',
  stress_warning: 'the account is under some drawdown stress',
}

const RESEARCH_REASON_TEXT = {
  no_edge_over_baseline: 'Its holdout didn’t beat the always-up baseline. Research must show an edge before a bot can trade it.',
  not_out_of_sample: 'Its edge wasn’t measured on genuinely out-of-sample data. Research must be validated out of sample before a bot can trade it.',
  below_min_confidence: 'Its score was below this bot’s minimum.',
  stale_prediction: 'The research was older than this bot allows.',
  entry_price_drift: 'The price had moved too far from the research’s entry price.',
  degraded_research_run: 'The research run didn’t pass Alpha Engine’s quality gates.',
  research_tier_not_full: 'The research run didn’t pass Alpha Engine’s quality gates.',
  direction_mismatch: 'The research direction didn’t match this bot.',
}

const sessionLabel = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

const CANCEL_TEXT = {
  emergency_stop: 'Cancelled by the emergency stop.',
  emergency_stop_pre_submit: 'Cancelled by the emergency stop before it was sent.',
  user_cancel: 'Cancelled by you.',
  user_cancel_requested_pre_submit: 'Cancelled by you before it was sent.',
  broker_cancelled_after_user_request: 'Cancelled at the broker, as you requested.',
  cancelled_before_broker_ack: 'Cancelled before the broker confirmed it.',
}
export function cancelText(reason) {
  if (!reason) return 'This order was cancelled.'
  if (CANCEL_TEXT[reason]) return CANCEL_TEXT[reason]
  if (reason.startsWith('broker_status:')) return `Closed by the broker (${reason.slice(14).replace(/_/g, ' ')}).`
  if (reason.startsWith('broker_rejected:')) return `Rejected by the broker: ${reason.slice(16)}.`
  return 'This order was cancelled.'
}

const FAIL_TEXT = {
  max_attempts_exceeded: 'Couldn’t be sent after several attempts. Nothing reached the broker.',
}
export function failText(reason) {
  if (!reason) return 'The order was rejected.'
  if (FAIL_TEXT[reason]) return FAIL_TEXT[reason]
  if (reason.startsWith('broker_rejected:')) return `Rejected by the broker: ${reason.slice(16)}.`
  return 'The order was rejected.'
}

// Pre-submission refusals: the order was never sent.
const REFUSAL_TEXT = {
  bot_allocation_exceeded: 'Over this bot’s capital limit.',
  max_daily_notional: 'Over the daily trading limit.',
  max_symbol_notional: 'Over the per-symbol limit.',
  max_order_value: 'Over the per-order limit.',
  max_daily_executions: 'Over the daily order count.',
  max_daily_loss: 'The daily loss limit was reached.',
  max_concurrent_active_orders: 'Too many open orders.',
  insufficient_buying_power: 'Not enough cash.',
  bot_paused: 'The bot was paused.',
  bot_stopped: 'The bot was stopped.',
  missing_price: 'No current price.',
  stale_price: 'The price was out of date.',
  emergency_stop: 'The emergency stop is on.',
  sell_exceeds_attributable_holdings: 'The bot can only sell shares it bought itself.',
  invalid_credentials: 'Broker credentials aren’t usable.',
  research_evidence_unverified: 'The research evidence couldn’t be verified.',
}
export function refusalText(reason) {
  if (!reason || reason === 'unknown') return 'Stopped before it was sent.'
  return REFUSAL_TEXT[reason] ?? `Stopped before it was sent (${reason.replace(/_/g, ' ')}).`
}

/** Refusal reason in the current shape (status 'refused') or the legacy one (cancelled + 'refused:'). */
export function refusalReasonOf(x) {
  if (x.status === 'refused') return x.refusalReason ?? 'unknown'
  if (x.status === 'cancelled' && typeof x.cancelReason === 'string' && x.cancelReason.startsWith('refused:')) return x.cancelReason.slice(8)
  return null
}

// Simulator order ids: simreplay_<session>_… (historical replay) or simdaily_<session>_… (paper trading on daily closes).
const SIM_ORDER = /^sim(replay|daily)_(\d{4}-\d{2}-\d{2})_/

export function normalizeExecution(x) {
  const sim = typeof x.brokerOrderId === 'string' ? x.brokerOrderId.match(SIM_ORDER) : null
  return {
    brokerOrderId: x.brokerOrderId ?? null,
    replaySession: sim ? sim[2] : null,
    simKind: sim ? (sim[1] === 'daily' ? 'daily' : 'replay') : null,
    id: x.id,
    symbol: x.ticker ?? null,
    side: x.direction ?? null,
    quantity: toNumberOrNull(x.quantity),
    filledQuantity: toNumberOrNull(x.filledQuantity),
    intentPrice: toNumberOrNull(x.price),
    filledPrice: toNumberOrNull(x.filledPrice),
    status: x.status ?? null,
    cancelReason: x.cancelReason ?? null,
    refusalReason: x.refusalReason ?? null,
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
  const refusal = refusalReasonOf(x)
  const diagnostics = { source: 'execution', executionId: x.id, status: refusal ? 'refused' : x.status, brokerStatus: x.brokerStatus, cancelReason: x.cancelReason, refusalReason: refusal, intentPrice: x.intentPrice, quantity: x.quantity }
  const sym = x.symbol ?? 'symbol'
  if (!hasCreatedEvent) {
    items.push({
      id: `exe:${x.id}:created`, at: x.createdAt, symbol: x.symbol, category: 'order', executionId: x.id, diagnostics,
      title: `${cap(sideWord(x.side))} order placed`,
      explanation: x.quantity !== null ? `${x.quantity} ${x.quantity === 1 ? 'share' : 'shares'} of ${sym}.` : `Order for ${sym}.`,
    })
  }
  const qty = x.filledQuantity ?? x.quantity
  if (refusal) {
    items.push({ id: `exe:${x.id}:refused`, at: x.updatedAt, symbol: x.symbol, category: 'order', outcome: true, executionId: x.id, diagnostics, title: 'Order refused', explanation: refusalText(refusal) })
    return items
  }
  switch (x.status) {
    case 'filled':
    case 'partially_filled':
      items.push({
        id: `exe:${x.id}:fill`, at: x.filledAt ?? x.updatedAt, symbol: x.symbol, category: 'fill', executionId: x.id, diagnostics,
        title: x.status === 'filled' ? `${sideWord(x.side, true)} ${qty ?? ''} ${sym}`.replace(/\s+/g, ' ').trim() : `Partly filled: ${sym}`,
        explanation: x.replaySession
          ? `Simulated fill at the ${sessionLabel(x.replaySession)} close${x.filledPrice !== null ? ` (${fmt(x.filledPrice)})` : ''} — ${x.simKind === 'daily' ? 'paper trading on daily closes' : 'historical replay'}, not a broker execution.`
          : [x.filledPrice !== null ? `at ${fmt(x.filledPrice)}` : null, x.costs > 0 ? `costs ${fmt(x.costs)}` : null].filter(Boolean).join(' · ') || 'Paper fill.',
        simulated: Boolean(x.replaySession),
      })
      break
    case 'failed':
      items.push({ id: `exe:${x.id}:failed`, at: x.updatedAt, symbol: x.symbol, category: 'error', outcome: true, executionId: x.id, diagnostics, title: 'Order rejected', explanation: failText(x.cancelReason) })
      break
    case 'cancelled':
      items.push({ id: `exe:${x.id}:cancelled`, at: x.updatedAt, symbol: x.symbol, category: 'order', outcome: true, executionId: x.id, diagnostics, title: 'Order cancelled', explanation: cancelText(x.cancelReason) })
      break
    case 'processing':
    case 'submitted':
      if (x.submittedAt) items.push({ id: `exe:${x.id}:sent`, at: x.submittedAt, symbol: x.symbol, category: 'order', executionId: x.id, diagnostics, title: 'Order sent', explanation: 'Waiting for a fill.' })
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
  // Routine skips are fetched separately so a busy bot's checks never push its
  // decisions, orders and fills out of the window.
  const [events, routine, executions] = await Promise.all([
    settle(get(`/bots/${botId}/events`, { limit, exclude: 'execution_skipped' })),
    settle(get(`/bots/${botId}/events`, { limit, type: 'execution_skipped' })),
    settle(get('/executions', { botId, limit })),
  ])
  const eventRows = events.ok ? [...asArray(events.value), ...(routine.ok ? asArray(routine.value) ?? [] : [])] : null
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
  const [bot, activity] = await Promise.all([
    settle(get(`/bots/${botId}`)),
    loadBotActivity(botId),
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
  if (code === 'EMERGENCY_STOP_ACTIVE') return 'The emergency stop is on. Clear it on Home before resuming bots.'
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


/** Archived, digest-verified research evidence for one execution (trade history). */
export async function getExecutionResearch(executionId) {
  const res = await get(`/executions/${encodeURIComponent(executionId)}/research`)
  return res?.data ?? res
}
