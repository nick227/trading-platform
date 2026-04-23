import prisma from '../db/prisma.js'
import { randomUUID } from 'crypto'
import { log } from '../logger.js'
import { getBrokerClient } from '../broker/clientCache.js'
import { priceCache } from '../market/priceCache.js'
import { subscribe, unsubscribe } from '../market/dataStream.js'
import { evaluateMarketHours }    from './rules/marketHours.js'
import { evaluatePriceThreshold } from './rules/priceThreshold.js'
import { evaluateCooldown }       from './rules/cooldown.js'
import { evaluatePositionLimit }  from './rules/positionLimit.js'
import { evaluateDailyLoss }      from './rules/dailyLoss.js'
import { evaluateTrendFilter }   from './rules/trendFilter.js'
import { evaluateTimeWindow }    from './rules/timeWindow.js'
import { recordExecutionAudit }   from '../audit/executionAudit.js'
import { executeRuleBasedStrategy, executeStrategyBasedAlgorithm } from './predefinedStrategies.js'
import { riskManager } from '../risk/riskManagement.js'

// In-memory state
const botRegistry  = new Map()  // botId → bot (with rules)
const tickerIndex  = new Map()  // ticker → Set<botId>
export const inflightMap = new Map()  // `${botId}:${ticker}` → true
const lastSkipEventAt = new Map()
const lastRuleBlockEventAt = new Map()
// Keys confirmed clean (no active execution) since last restart.
// Prevents the DB fallback from re-querying the same key on every tick.
const dbCheckedKeys = new Set()

let previousTickers = new Set()
let reloadTimer     = null

// Per-user position cache: Map<userId, { positions: [], updatedAt: number }>
// Keyed by userId so each user's bot evaluates against their own Alpaca account.
const positionCacheByUser = new Map()

const RELOAD_INTERVAL_MS         = Number(process.env.BOT_RELOAD_INTERVAL_MS ?? 10_000)
const POSITION_CACHE_MAX_MS      = 60_000
const POSITION_CACHE_MAX_USERS   = 500   // LRU eviction threshold
const ACTIVE_EXECUTION_STATUSES  = ['queued', 'processing', 'submitted', 'partially_filled']
const SKIP_EVENT_WINDOW_MS       = 60_000

// Rules sorted cheapest-first so fast in-memory checks short-circuit before any DB/broker call.
const RULE_COST_ORDER = {
  market_hours:    0,  // in-memory
  time_window:     1,  // in-memory
  price_threshold: 2,  // Map lookup
  cooldown:        3,  // DB (30s cache)
  daily_loss:      4,  // DB (30s cache)
  trend_filter:    5,  // DB (5min cache)
  position_limit:  6,  // broker REST (60s cache)
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export async function startBotEngine() {
  if (reloadTimer) {
    return
  }
  log.info('bot_engine_start')
  await initInflightMap()
  reloadBots()
  reloadTimer = setInterval(reloadBots, RELOAD_INTERVAL_MS)
}

// Pre-populate inflightMap from DB so the cold-start DB fallback in evaluateBot
// is never hit on the first tick after a restart.
async function initInflightMap() {
  try {
    const active = await prisma.execution.findMany({
      where: { status: { in: ACTIVE_EXECUTION_STATUSES }, botId: { not: null } },
      select: { botId: true, ticker: true }
    })
    for (const { botId, ticker } of active) {
      inflightMap.set(`${botId}:${ticker}`, true)
    }
    if (active.length > 0) {
      log.info({ count: active.length }, 'inflight_guards_preloaded')
    }
  } catch (err) {
    log.error({ err: err.message }, 'inflight_init_error')
  }
}

export function stopBotEngine() {
  if (reloadTimer) clearInterval(reloadTimer)
  reloadTimer = null
  botRegistry.clear()
  tickerIndex.clear()
  dbCheckedKeys.clear()
  if (previousTickers.size > 0) {
    unsubscribe([...previousTickers])
  }
  previousTickers = new Set()
  log.info('bot_engine_stop')
}

// ─── Bot registry reload ──────────────────────────────────────────────────────

async function reloadBots() {
  try {
    const bots = await prisma.bot.findMany({
      where: { enabled: true, deletedAt: null },
      include: { rules: { where: { enabled: true } } }
    })

    botRegistry.clear()
    tickerIndex.clear()

    for (const bot of bots) {
      // Sort rules cheapest-first to maximize short-circuit (in-memory before DB/broker)
      bot.rules.sort((a, b) => (RULE_COST_ORDER[a.type] ?? 99) - (RULE_COST_ORDER[b.type] ?? 99))
      // Pre-compute derived flags so per-tick evaluateBot never re-scans rules
      bot._hasTrendFilter = bot.rules.some(r => r.type === 'trend_filter')
      botRegistry.set(bot.id, bot)
      for (const ticker of bot.config?.tickers ?? []) {
        if (!tickerIndex.has(ticker)) tickerIndex.set(ticker, new Set())
        tickerIndex.get(ticker).add(bot.id)
      }
    }

    const newTickers = new Set(tickerIndex.keys())
    const toAdd = []
    for (const t of newTickers) {
      if (!previousTickers.has(t)) toAdd.push(t)
    }
    const toRemove = []
    for (const t of previousTickers) {
      if (!newTickers.has(t)) toRemove.push(t)
    }

    if (toAdd.length)    subscribe(toAdd)
    if (toRemove.length) unsubscribe(toRemove)

    previousTickers = newTickers
  } catch (err) {
    log.error({ err: err.message }, 'reload_bots_error')
  }
}

// ─── Tick handler (called by dataStream onQuote) ──────────────────────────────

export async function onPriceTick(ticker) {
  const botIds = tickerIndex.get(ticker)
  if (!botIds) return

  for (const botId of botIds) {
    const bot = botRegistry.get(botId)
    if (bot) {
      evaluateBot(bot, ticker).catch(err =>
        log.error({ err: err.message, botId, ticker }, 'evaluate_bot_error')
      )
    }
  }
}

// ─── Bot evaluation ───────────────────────────────────────────────────────────

async function evaluateBot(bot, ticker) {
  const inflightKey = `${bot.id}:${ticker}`

  // Primary guard: in-memory (no DB hit on every tick)
  if (inflightMap.get(inflightKey)) {
    await maybeLogInflightSkip(bot, ticker, inflightKey)
    return
  }

  // Fallback guard: one-time DB check per key to cover the startup window before
  // initInflightMap completes. After the first negative result the key is marked
  // clean and subsequent ticks skip the query entirely.
  if (!dbCheckedKeys.has(inflightKey)) {
    dbCheckedKeys.add(inflightKey)
    const inflight = await prisma.execution.findFirst({
      where: { botId: bot.id, ticker, status: { in: ACTIVE_EXECUTION_STATUSES } }
    })
    if (inflight) {
      inflightMap.set(inflightKey, true)
      return
    }
  }

  // Get current tick data
  const tick = priceCache.get(ticker)
  if (!tick) {
    return // No price data available
  }

  // Prepare context for strategy evaluation
  let positions = null
  let currentQty = null
  let side = null

  async function ensurePositionsLoaded() {
    if (positions) return
    positions = await getPositions(bot.userId)
    currentQty = getPositionQty(positions, ticker)
    side = currentQty > 0 ? 'sell' : 'buy'
  }

  const context = {
    positions: positions ?? [],
    currentQty,
    side,
    ensurePositionsLoaded
  }

  // Handle different bot types
  let evaluationResult

  if (bot.botType === 'rule_based' && bot.templateId) {
    // Execute predefined rule-based strategy
    try {
      evaluationResult = await executeRuleBasedStrategy(bot, tick, context)
    } catch (error) {
      log.error({ err: error.message, botId: bot.id, ticker }, 'strategy_error')
      await logBotEvent(bot, 'strategy_error', `Rule-based strategy failed: ${error.message}`, ticker)
      return
    }
  } else if (bot.botType === 'strategy_based' && bot.strategyId) {
    // Execute predefined strategy-based algorithm
    try {
      evaluationResult = await executeStrategyBasedAlgorithm(bot, tick, context)
    } catch (error) {
      log.error({ err: error.message, botId: bot.id, ticker }, 'strategy_error')
      await logBotEvent(bot, 'strategy_error', `Strategy-based algorithm failed: ${error.message}`, ticker)
      return
    }
  } else {
    // Fall back to traditional rule evaluation for custom bots
    const hasTrendFilter = bot._hasTrendFilter
    side = hasTrendFilter ? null : deriveDirection(bot)
    context.side = side

    // Run rule pipeline - first failure short-circuits
    for (const rule of bot.rules) {
      if (rule.type === 'position_limit' || rule.type === 'trend_filter') {
        await ensurePositionsLoaded()
      }

      const result = await evaluateRule(rule, bot, ticker, positions ?? [], { side })
      if (!result.pass) {
        await maybeLogRuleBlock(bot, ticker, side ?? 'buy', rule, result)
        return
      }
    }

    // If we get here, all rules passed - continue with execution
    evaluationResult = { signal: side || 'buy', confidence: 0.8, reason: 'All custom rules passed' }
  }

  // Process evaluation result
  if (evaluationResult.signal === 'hold') {
    await logBotEvent(bot, 'signal_hold', evaluationResult.reason || 'No trading signal', ticker, {
      confidence: evaluationResult.confidence || 0,
      metadata: evaluationResult.metadata
    })
    return
  }

  // Ensure positions are loaded for execution
  await ensurePositionsLoaded()
  // Sync context so createExecution sees the loaded values (context was created before load)
  context.positions = positions ?? []
  context.currentQty = currentQty
  context.side = side

  // Validate signal against current position
  if (evaluationResult.signal === 'sell' && currentQty <= 0) {
    await logBotEvent(bot, 'execution_skipped', `No position to sell for ${ticker}`, ticker, {
      reason: 'no_position',
      side: 'sell',
      signal: evaluationResult.signal
    })
    return
  }

  // Create execution if signal is valid
  await createExecution(bot, ticker, evaluationResult, tick, context)
}

// Helper function to create execution
async function createExecution(bot, ticker, evaluationResult, tick, context) {
  const { signal, confidence, reason, metadata } = evaluationResult
  const { currentQty } = context

  const executionId = `exe_${Date.now()}_${randomUUID().slice(0, 8)}`
  const direction = signal
  const inflightKey = `${bot.id}:${ticker}`
  const activeIntentKey = buildActiveIntentKey(bot.id, ticker, direction)

  const quantity = direction === 'buy'
    ? computeBuyQuantity({ bot, quote: tick })
    : currentQty

  if (!Number.isFinite(quantity) || quantity <= 0) {
    await logBotEvent(bot, 'execution_skipped', `Computed quantity is not tradable for ${ticker}`, ticker, {
      reason: 'invalid_quantity',
      quantity,
      side: direction,
      price: tick?.last ?? null,
      signal,
      confidence
    })
    return
  }

  // Evaluate risk before creating execution
  const executionRequest = {
    portfolioId: bot.portfolioId,
    ticker,
    direction,
    quantity,
    price: tick.last
  }

  let riskEvaluation
  try {
    riskEvaluation = await riskManager.evaluateExecutionRisk(executionRequest)
  } catch (error) {
    log.error({ err: error.message, botId: bot.id, ticker }, 'risk_eval_error')
    await logBotEvent(bot, 'risk_evaluation_failed', `Risk evaluation failed for ${ticker}: ${error.message}`, ticker, {
      error: error.message,
      signal,
      confidence
    })
    return
  }

  if (!riskEvaluation.approved) {
    await logBotEvent(bot, 'execution_blocked_by_risk', `Risk management blocked execution for ${ticker}`, ticker, {
      signal,
      confidence,
      reason,
      riskScore: riskEvaluation.riskScore,
      failedChecks: riskEvaluation.failedChecks,
      recommendations: riskEvaluation.recommendations
    })
    await recordExecutionAudit(executionId, 'risk_blocked', {
      botId: bot.id,
      botType: bot.botType,
      signal,
      confidence,
      riskEvaluation
    })
    return
  }

  // Risk approved — create the execution record
  let execution
  try {
    execution = await prisma.execution.create({
      data: {
        id:            executionId,
        userId:        bot.userId,
        portfolioId:   bot.portfolioId,
        strategyId:    bot.strategyId ?? null,
        botId:         bot.id,
        ticker,
        direction,
        quantity,
        price:         tick.last,
        origin:        'bot',
        status:        'queued',
        clientOrderId: `tp_${executionId}`,
        activeIntentKey,
        signalScore:   confidence,
        pnl:           0
      }
    })
  } catch (err) {
    if (isActiveIntentConflict(err)) {
      // DB unique constraint fired — a concurrent tick snuck in; restore in-memory guard
      inflightMap.set(inflightKey, true)
      dbCheckedKeys.delete(inflightKey)
      await maybeLogInflightSkip(bot, ticker, inflightKey)
      return
    }
    log.error({ err: err.message, botId: bot.id, ticker }, 'execution_create_error')
    await logBotEvent(bot, 'execution_failed', `Failed to create execution: ${err.message}`, ticker, {
      error: err.message,
      signal,
      confidence
    })
    return
  }

  // Mark as inflight to prevent duplicates on subsequent ticks
  inflightMap.set(inflightKey, true)
  dbCheckedKeys.delete(inflightKey)

  log.info({ executionId: execution.id, botId: bot.id, ticker, direction, qty: quantity, confidence }, 'execution_queued')

  await logBotEvent(bot, 'execution_created', `Created ${direction} execution for ${ticker}`, ticker, {
    executionId: execution.id,
    direction,
    quantity,
    price: tick.last,
    signal,
    confidence,
    reason,
    metadata,
    riskScore: riskEvaluation.riskScore
  })

  await recordExecutionAudit(executionId, 'created', {
    botId:      bot.id,
    botType:    bot.botType,
    strategyId: bot.strategyId,
    templateId: bot.templateId,
    signal,
    confidence,
    reason,
    metadata,
    riskEvaluation
  })
}

// ─── Rule dispatching ─────────────────────────────────────────────────────────

async function evaluateRule(rule, bot, ticker, positions, ctx = {}) {
  const side = typeof ctx?.side === 'string' ? ctx.side.toLowerCase() : null
  switch (rule.type) {
    case 'market_hours':
      return evaluateMarketHours(rule.config)

    case 'price_threshold':
      return evaluatePriceThreshold(rule.config, ticker)

    case 'cooldown':
      return evaluateCooldown(rule.config, bot.id, ticker)

    case 'position_limit':
      return evaluatePositionLimit(rule.config, ticker, positions)

    case 'daily_loss':
      return evaluateDailyLoss(rule.config, bot.portfolioId)

    case 'trend_filter':
      return evaluateTrendFilter({ ...rule.config, side })

    case 'time_window':
      return evaluateTimeWindow(rule.config)

    default:
      log.warn({ ruleType: rule.type }, 'unknown_rule_type')
      return { pass: true }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Derive trade direction from bot config (default to buy for signal bots)
function deriveDirection(bot) {
  return bot.config?.direction ?? 'buy'
}

function buildActiveIntentKey(botId, ticker, direction) {
  return `bot:${botId}:${ticker}:${direction}`
}

function isActiveIntentConflict(err) {
  return err?.code === 'P2002' && Array.isArray(err?.meta?.target) && err.meta.target.includes('activeIntentKey')
}

// Per-user position cache refreshed every 60s via Alpaca REST.
// Each user has their own Alpaca account — never mix positions across users.
async function getPositions(userId) {
  const cached = positionCacheByUser.get(userId)
  if (cached && Date.now() - cached.updatedAt < POSITION_CACHE_MAX_MS) {
    return cached.positions
  }

  const broker = await getBrokerClient(userId)
  if (!broker) return cached?.positions ?? []

  try {
    const positions = await broker.getPositions()
    setPositionCache(userId, positions)
    return positions
  } catch {
    // Return stale rather than crashing rule evaluation
    return cached?.positions ?? []
  }
}

// LRU-evicting write: Map preserves insertion order, so the first key is the oldest.
function setPositionCache(userId, positions) {
  positionCacheByUser.delete(userId) // remove to re-insert at end (most-recently-used)
  positionCacheByUser.set(userId, { positions, updatedAt: Date.now() })
  if (positionCacheByUser.size > POSITION_CACHE_MAX_USERS) {
    positionCacheByUser.delete(positionCacheByUser.keys().next().value)
  }
}

function getPositionQty(positions, ticker) {
  const symbol = String(ticker).toUpperCase()
  for (const pos of positions ?? []) {
    const s = String(pos?.symbol ?? pos?.ticker ?? '').toUpperCase()
    if (s !== symbol) continue

    const rawQty = pos?.qty ?? pos?.quantity ?? pos?.shares ?? pos?.position_qty
    const qty = typeof rawQty === 'number' ? rawQty : Number(rawQty)
    if (Number.isFinite(qty)) return qty
    return 0
  }
  return 0
}

function computeBuyQuantity({ bot, quote }) {
  const price = Number(quote?.last ?? 0)
  if (!Number.isFinite(price) || price <= 0) {
    return 0
  }

  // Allocated sizing (Bot #1)
  const allocated = bot.config?.allocatedAmount
  const capitalMode = bot.config?.capitalMode
  if (capitalMode === 'allocated' || allocated != null) {
    const allocatedAmount = Number(allocated ?? 0)
    const riskOnExposure = Number(bot.config?.riskOnExposure ?? 1)
    const maxOrderNotional = bot.config?.maxOrderNotional != null ? Number(bot.config.maxOrderNotional) : null

    if (!Number.isFinite(allocatedAmount) || allocatedAmount <= 0) return 0
    if (!Number.isFinite(riskOnExposure) || riskOnExposure <= 0) return 0

    let notional = allocatedAmount * riskOnExposure
    if (Number.isFinite(maxOrderNotional) && maxOrderNotional > 0) {
      notional = Math.min(notional, maxOrderNotional)
    }

    const shares = Math.floor(notional / price)
    return shares > 0 ? shares : 0
  }

  // Legacy sizing
  const qty = Number(bot.config?.quantity ?? 1)
  return Number.isFinite(qty) && qty > 0 ? qty : 0
}

async function logBotEvent(bot, type, detail, ticker, metadata = {}) {
  try {
    await prisma.botEvent.create({
      data: {
        id:          `evt_${randomUUID()}`,
        botId:       bot.id,
        portfolioId: bot.portfolioId,
        type,
        detail,
        metadata:    { ticker, ...metadata }
      }
    })
  } catch (err) {
    log.error({ err: err.message }, 'bot_event_write_error')
  }
}

async function maybeLogInflightSkip(bot, ticker, inflightKey) {
  const lastLoggedAt = lastSkipEventAt.get(inflightKey) ?? 0
  if (Date.now() - lastLoggedAt < SKIP_EVENT_WINDOW_MS) {
    return
  }
  lastSkipEventAt.set(inflightKey, Date.now())
  await logBotEvent(bot, 'execution_skipped', `Inflight order exists for ${ticker} — skipping tick`, ticker, {
    reason: 'inflight_exists'
  })
}

async function maybeLogRuleBlock(bot, ticker, side, rule, result) {
  // Throttle identical block events to prevent DB write amplification on fast tick streams.
  // Key includes rule.id + reason + side so we still see distinct blocks.
  const reason = result?.reason ?? 'unknown'
  const key = `${bot.id}:${ticker}:${side}:${rule.id}:${reason}`
  if (lastRuleBlockEventAt.size > 5000) {
    // Evict the oldest 20% of entries rather than clearing everything at once,
    // which would cause a thundering herd of DB writes on the next tick.
    const evictCount = Math.ceil(lastRuleBlockEventAt.size * 0.2)
    const iter = lastRuleBlockEventAt.keys()
    for (let i = 0; i < evictCount; i++) lastRuleBlockEventAt.delete(iter.next().value)
  }
  const lastLoggedAt = lastRuleBlockEventAt.get(key) ?? 0
  if (Date.now() - lastLoggedAt < SKIP_EVENT_WINDOW_MS) {
    return
  }
  lastRuleBlockEventAt.set(key, Date.now())

  log.warn({ botId: bot.id, ticker, rule: rule.type, reason }, 'bot_blocked')
  await logBotEvent(bot, 'execution_skipped', `Rule "${rule.name}" blocked: ${reason}`, ticker, {
    ruleId:   rule.id,
    rule:     rule.type,
    reason,
    detail:   result?.detail ?? null,
    side
  })
}
