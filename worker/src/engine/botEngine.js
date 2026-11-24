import prisma from '../db/prisma.js'
import { randomUUID } from 'crypto'
import { log } from '../logger.js'
import { getBrokerClient } from '../broker/clientCache.js'
import { priceCache } from '../market/priceCache.js'
import { subscribe, unsubscribe } from '../market/dataStream.js'
import { ACTIVE_EXECUTION_STATUSES, REFUSAL_WHERE, refusalReasonOf } from '../queues/executionStatus.js'
import { evaluateMarketHours }    from './rules/marketHours.js'
import { evaluatePriceThreshold } from './rules/priceThreshold.js'
import { evaluateCooldown, noteCooldownExecution } from './rules/cooldown.js'
import { evaluatePositionLimit }  from './rules/positionLimit.js'
import { evaluateDailyLoss }      from './rules/dailyLoss.js'
import { evaluateTrendFilter }   from './rules/trendFilter.js'
import { evaluateTimeWindow }    from './rules/timeWindow.js'
import { recordExecutionAudit }   from '../audit/executionAudit.js'
import { increment as metricsIncrement } from '../metrics/counters.js'
import { withInflightLock } from '../utils/inflightGuard.js'
import { executeRuleBasedStrategy, executeStrategyBasedAlgorithm } from './predefinedStrategies.js'
import { riskManager } from '../risk/riskManagement.js'
import { engineClient } from '../../../server/src/clients/engine.js'
import { fetchVerifiedResearchTrace, recordResearchDecision } from '../../../server/src/services/researchTraceService.js'
import { linkResearchDecisionToExecution } from '../../../server/src/services/executionResearchService.js'
import { calculateFifoAccounting, loadBotFills } from '../../../server/src/services/botAccountingService.js'
import { computeBuyQuantity as coreBuyQuantity, deriveDirection, runRulePipeline, sellableFrom } from './decisionCore.js'
import { priceChangeDecision, relativeVolumeDecision } from './rules/marketConditions.js'
import { isResearchDriven, resolveResearchPolicy, evaluateResearchDecision } from './researchDecision.js'
import { currentSimSession, simulationConfig } from '../../../server/src/services/simulationService.js'

/** The simulator session now (fixed for replay, latest close for paper_daily); null if none. */
async function simSessionOrNull(sim = simulationConfig()) {
  if (!sim.enabled) return null
  try { return await currentSimSession({ config: sim }) } catch { return null }
}
import { resolveRiskOutcome, riskPolicyConfig } from '../risk/riskOutcome.js'

const REGIME_MAP = { risk_on: 'bull', risk_off: 'bear' }
const marketContextCache = new Map() // ticker → { at, value }

/**
 * Real available market data for risk checks. Daily volume and 20-session average from
 * Alpha Engine; spread only from a real two-sided quote; regime only outside replay (the
 * regime read has no as-of date). Anything unavailable is omitted (scored as unknown).
 */
export async function marketDataFor(ticker, tick) {
  const price = Number(tick?.last ?? tick?.ask)
  const out = { ticker, price }
  const bid = Number(tick?.bid), ask = Number(tick?.ask)
  if (bid > 0 && ask > bid) { out.bid = bid; out.ask = ask; out.spread = ask - bid }
  const sim = simulationConfig()
  const now = Date.now()
  let ctx = marketContextCache.get(ticker)
  if (!ctx || now - ctx.at > 60_000) {
    const value = {}
    try {
      const sc = await engineClient.getSessionClose(ticker, sim.enabled ? await simSessionOrNull(sim) : null)
      if (Number(sc?.volume) > 0) value.volume = Number(sc.volume)
      if (Number(sc?.avgVolume20) > 0) value.avgVolume = Number(sc.avgVolume20)
      if (sc?.session) value.session = sc.session
    } catch { /* unknown */ }
    if (!sim.enabled) {
      try {
        const r = await engineClient.getRegime(ticker)
        if (REGIME_MAP[r?.regime]) value.regime = REGIME_MAP[r.regime]
      } catch { /* unknown */ }
    }
    ctx = { at: now, value }
    marketContextCache.set(ticker, ctx)
  }
  return { ...out, ...ctx.value }
}

const closesCache = new Map() // `${ticker}|${end}` → { at, closes }

/**
 * Completed daily closes up to the current session (the simulator's session, else today),
 * ascending — Alpha Engine's clean session bars. Enough for a `sessions` lookback.
 */
export async function recentCloses(ticker, sessions) {
  const sim = simulationConfig()
  const end = (sim.enabled ? await simSessionOrNull(sim) : null) ?? new Date().toISOString().slice(0, 10)
  const key = `${ticker}|${end}`
  const hit = closesCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000 && hit.closes.length > sessions) return hit.closes
  const start = new Date(`${end}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - Math.ceil(sessions * 1.6) - 10)
  try {
    const r = await engineClient.getDailyBars(ticker, start.toISOString().slice(0, 10), end)
    const closes = (Array.isArray(r?.bars) ? r.bars : []).map((b) => Number(b[4])).filter((c) => c > 0)
    closesCache.set(key, { at: Date.now(), closes })
    return closes
  } catch {
    return []
  }
}

// Simulator (historical replay): locate the replay session's publication and judge it at
// that session's close. Only research decisions use this clock; throttles use real time.
// paper_daily: the latest live publication, judged at real time (research ages normally).
function researchContext() {
  const sim = simulationConfig()
  if (sim.enabled && sim.mode === 'historical_replay') {
    return { locate: { mode: 'historical_replay', session: sim.session }, now: sim.clock, simulation: { mode: sim.mode, session: sim.session } }
  }
  return { locate: {}, now: botEngineConfig.now(), simulation: sim.enabled ? { mode: sim.mode } : null }
}

// Injectable for deterministic tests (mirrors orderWorkerConfig).
export const botEngineConfig = {
  now: () => new Date(),
  // How long a located + verified trace is reused before Alpha Engine is consulted again.
  researchRecheckMs: Number(process.env.BOT_RESEARCH_RECHECK_MS ?? 60_000),
}

// Research state (per process). The DB remains authoritative for "already acted".
const researchCache = new Map()        // `${botId}:${ticker}` → { at, located, trace }
const actedPredictions = new Set()     // `${botId}:${predictionId}` with an accepted, executed decision
const lastResearchEventAt = new Map()  // throttle key → ms

// In-memory state
const botRegistry  = new Map()  // botId → bot (with rules)
const tickerIndex  = new Map()  // ticker → Set<botId>
export const REFUSAL_BACKOFF_MS = 15 * 60_000
export const SESSION_DONE_LOG_MS = 60 * 60_000
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
  researchCache.clear()
  actedPredictions.clear()
  lastResearchEventAt.clear()
  positionCacheByUser.clear()
  lastSkipEventAt.clear()
  lastRuleBlockEventAt.clear()
  lastInflightCheckAt.clear()
  if (previousTickers.size > 0) {
    unsubscribe([...previousTickers])
  }
  previousTickers = new Set()
  log.info('bot_engine_stop')
}

// ─── Bot registry reload ──────────────────────────────────────────────────────

export async function reloadBots() {
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

export async function evaluateBot(bot, ticker) {
  const inflightKey = `${bot.id}:${ticker}`

  // Primary guard: in-memory (no DB hit on every tick). A key can go stale (e.g. a very
  // fast fill finalized before the guard was re-set), so confirm it against the DB at most
  // once per window; the DB unique activeIntentKey still guarantees a single active order.
  if (inflightMap.get(inflightKey)) {
    if (!(await inflightIsStale(bot, ticker, inflightKey))) {
      await maybeLogInflightSkip(bot, ticker, inflightKey)
      return
    }
    inflightMap.delete(inflightKey)
    log.info({ botId: bot.id, ticker }, 'stale_inflight_guard_cleared')
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

  // paper_daily: once the bot has acted on this symbol at the current session's close, it is
  // done until the next close. Say so before the rules run, so the reason shown is accurate
  // (not "cooldown", which would suggest another trade within the hour).
  const simNow = simulationConfig()
  if (simNow.enabled && simNow.mode === 'paper_daily') {
    const session = await simSessionOrNull(simNow)
    if (session && (await prisma.execution.findFirst({ where: { botId: bot.id, ticker, simSession: session }, select: { id: true } }))) {
      // Hourly heartbeat, not every tick: the state can't change until the next close.
      await maybeLogRuleBlock(bot, ticker, bot.config?.direction ?? null, { id: 'session_once', type: 'session_once', name: 'Once per session' },
        { reason: 'acted_this_session', detail: session }, { windowMs: SESSION_DONE_LOG_MS })
      return
    }
  }

  // Prepare context for strategy evaluation
  let positions = null
  let currentQty = null
  let side = null

  async function ensurePositionsLoaded() {
    if (positions) return
    positions = await getPositions(bot.userId)
    currentQty = getPositionQty(positions, ticker)
    // Loading positions must never override a direction already derived from the bot's
    // config or research (a buy bot whose owner holds the ticker would otherwise sell).
    if (side !== 'buy' && side !== 'sell') side = currentQty > 0 ? 'sell' : 'buy'
  }

  const context = {
    positions: positions ?? [],
    currentQty,
    side,
    ensurePositionsLoaded
  }

  // Handle different bot types
  let evaluationResult

  if (bot.botType === 'rule_based') {
    // Research-driven bots take direction and confidence from verified Alpha research;
    // configured rules still gate when the bot may act on it.
    let research = null
    if (isResearchDriven(bot)) {
      research = await evaluateResearchSignal(bot, ticker, tick)
      if (!research) return
      side = research.signal
    } else {
      side = deriveDirection(bot)
    }
    context.side = side

    // Require an explicit, valid trading direction before proceeding
    // Priority 1 requirement: Never default an absent trading direction to 'buy'
    if (!side || (side !== 'buy' && side !== 'sell')) {
      await logBotEvent(bot, 'execution_skipped', `Cannot determine valid trading direction for ${ticker}`, ticker, {
        reason: 'missing_direction',
        side
      })
      return
    }

    if (!research && (!bot.rules || bot.rules.length === 0)) {
      await logBotEvent(bot, 'execution_skipped', `Bot has no configured rules`, ticker, {
        reason: 'no_rules_configured'
      })
      return
    }

    // Rule pipeline (decisionCore): first failure short-circuits.
    const rules = await runRulePipeline(bot.rules, async (rule) => {
      if (rule.type === 'position_limit' || rule.type === 'trend_filter') await ensurePositionsLoaded()
      return evaluateRule(rule, bot, ticker, positions ?? [], { side })
    })
    if (!rules.pass) {
      await maybeLogRuleBlock(bot, ticker, side, rules.rule, rules.result)
      return
    }

    // If we get here, all rules passed - continue with execution
    if (research) {
      // The accepted decision (with its evidence) is written atomically with the execution.
      evaluationResult = { signal: side, confidence: research.confidence, reason: 'Alpha research accepted; configured rules passed', research }
    } else {
      evaluationResult = { signal: side, confidence: 0.8, reason: 'All configured rules passed' }
      await logBotEvent(bot, 'decision_made', `Signal generated: ${side} for ${ticker}`, ticker, {
        signal: side,
        confidence: 0.8,
        reason: evaluationResult.reason
      })
    }
  } else if (bot.botType === 'strategy_based') {
    await logBotEvent(bot, 'execution_skipped', `Strategy-based algorithms are not yet supported for bot ${bot.id}`, ticker, {
      reason: 'strategy_based_unsupported',
      strategyId: bot.strategyId
    })
    return
  } else {
    await logBotEvent(bot, 'execution_skipped', `Unknown bot type: ${bot.botType}`, ticker, {
      reason: 'unknown_bot_type',
      botType: bot.botType
    })
    return
  }

  // Process evaluation result
  if (evaluationResult.signal === 'hold') {
    await logBotEvent(bot, 'decision_made', evaluationResult.reason || 'No trading signal', ticker, {
      signal: 'hold',
      confidence: evaluationResult.confidence || 0,
      metadata: evaluationResult.metadata
    })
    return
  }

  // Ensure positions are loaded for execution
  await ensurePositionsLoaded()
  // Shared portfolio: several bots can hold the same symbol. A bot sells only what it bought
  // (its own FIFO lots), never another bot's shares — and never more than the account holds.
  if (evaluationResult.signal === 'sell') currentQty = await sellableQuantity(bot.id, ticker, currentQty)
  // Sync context so createExecution sees the loaded values (context was created before load)
  context.positions = positions ?? []
  context.currentQty = currentQty
  context.side = side

  // Validate signal against current position
  if (evaluationResult.signal === 'sell' && currentQty <= 0 && evaluationResult.research) {
    // SELL research for an unheld ticker is routine: throttle instead of logging every tick.
    const predictionId = evaluationResult.research.trace.source.predictionId
    await logResearchOnce(bot, ticker, `no_position:${predictionId}`, 'execution_skipped', `No position to sell for ${ticker}`, {
      reason: 'no_position', side: 'sell', signal: 'sell', predictionId
    })
    return
  }
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

/** min(this bot's attributable FIFO quantity, the account's position) for a sell. */
export async function sellableQuantity(botId, ticker, accountQty) {
  const t = String(ticker).toUpperCase()
  const held = calculateFifoAccounting(await loadBotFills(botId, { prismaClient: prisma })).openPositions?.[t]?.quantity ?? 0
  return sellableFrom(held, accountQty)
}

// Helper function to create execution
async function createExecution(bot, ticker, evaluationResult, tick, context) {
  const { signal, confidence, reason, metadata, research } = evaluationResult
  const { currentQty } = context
  const researchRef = research ? researchReference(research) : null

  // Enforce valid user and portfolio context
  if (!bot.userId || !bot.portfolioId) {
    await logBotEvent(bot, 'execution_skipped', `Bot missing user or portfolio context for ${ticker}`, ticker, {
      reason: 'missing_user_context',
      userId: bot.userId,
      portfolioId: bot.portfolioId
    })
    return
  }

  // Priority 1 requirement: strictly require 'buy' or 'sell'
  const direction = signal
  if (!direction || (direction !== 'buy' && direction !== 'sell')) {
    await logBotEvent(bot, 'execution_skipped', `Missing or invalid trading direction for ${ticker}`, ticker, {
      reason: 'invalid_direction',
      signal
    })
    return
  }

  const executionId = `exe_${Date.now()}_${randomUUID().slice(0, 8)}`
  const inflightKey = `${bot.id}:${ticker}`
  const activeIntentKey = buildActiveIntentKey(bot.id, ticker, direction)

  let quantity = direction === 'buy'
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

  // paper_daily: a bot acts at most once per symbol per session. Prices change once a day,
  // so a wall-clock cooldown would otherwise re-buy the same close every cycle. Any order for
  // this session counts — filled, open, cancelled or refused. Stricter only.
  const simCfg = simulationConfig()
  const simSession = await simSessionOrNull(simCfg)
  if (simCfg.enabled && !simSession) {
    await maybeLogRuleBlock(bot, ticker, direction, { id: 'sim_session', type: 'sim_session', name: 'Market data' }, { reason: 'no_current_session' })
    return
  }
  if (simCfg.mode === 'paper_daily' && simSession) {
    const acted = await prisma.execution.findFirst({ where: { botId: bot.id, ticker, simSession }, select: { id: true } })
    if (acted) {
      await maybeLogRuleBlock(bot, ticker, direction, { id: 'session_once', type: 'session_once', name: 'Once per session' },
        { reason: 'acted_this_session', detail: simSession })
      return
    }
  }

  // Back off after a refusal at submission (e.g. allocation or daily notional exceeded):
  // re-submitting the same order every cycle would only be refused again. Stricter only.
  const refusedRecently = await prisma.execution.findFirst({
    where: { botId: bot.id, ticker, direction, createdAt: { gte: new Date(Date.now() - REFUSAL_BACKOFF_MS) }, OR: REFUSAL_WHERE },
    select: { status: true, cancelReason: true, refusalReason: true }
  })
  if (refusedRecently) {
    await maybeLogRuleBlock(bot, ticker, direction, { id: 'refusal_backoff', type: 'refusal_backoff', name: 'Refusal back-off' },
      { reason: 'refused_recently', detail: refusalReasonOf(refusedRecently) })
    return
  }

  // Evaluate risk before creating execution, with the real signal and real available
  // market data (nothing fabricated: unknown inputs stay unknown).
  const executionRequest = {
    portfolioId: bot.portfolioId,
    ticker,
    direction,
    quantity,
    price: tick.last,
    signal: { ticker, direction, botId: bot.id, ...(research ? { confidence } : {}) },
    marketData: await marketDataFor(ticker, tick)
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

  const sim = simulationConfig()
  const outcome = resolveRiskOutcome(riskEvaluation, { quantity, ...riskPolicyConfig(process.env, { simulationEnabled: sim.enabled }) })
  const riskRecord = { basis: outcome.basis, ...outcome.verdict, marketData: executionRequest.marketData,
    ...(outcome.testScenario ? { testScenario: { name: outcome.testScenario, mode: sim.mode, session: simSession ?? sim.session,
      note: 'Isolated simulator test scenario: normal risk policy would not place this order.' } } : {}) }
  if (!outcome.proceed) {
    // No execution exists yet, so the block is recorded on the bot timeline only
    // (ExecutionAudit rows require an existing execution).
    await logBotEvent(bot, 'execution_blocked_by_risk', `Risk management ${outcome.basis === 'restricted_blocked' ? 'restricted' : 'blocked'} execution for ${ticker}`, ticker, {
      signal,
      confidence,
      reason: outcome.verdict.reason,
      riskDecision: riskRecord,
      riskScore: riskEvaluation.riskScore,
      failedChecks: riskEvaluation.failedChecks,
      recommendations: riskEvaluation.recommendations,
      ...(researchRef ? { research: researchRef } : {})
    })
    return
  }
  quantity = outcome.quantity

  const cooldownRule = (bot.rules ?? []).find((r) => r.type === 'cooldown')

  // Pre-insert guard: avoids a noisy P2002 in the normal (non-race) case.
  // The DB unique constraint on activeIntentKey remains the hard guarantee.
  const existingIntent = await prisma.execution.findUnique({
    where: { activeIntentKey },
    select: { id: true }
  })
  if (existingIntent) {
    inflightMap.set(inflightKey, true)
    metricsIncrement('duplicate_prevented')
    log.info({ botId: bot.id, ticker, direction, activeIntentKey, existingId: existingIntent.id }, 'duplicate_prevented')
    await maybeLogInflightSkip(bot, ticker, inflightKey)
    return
  }

  // Clear the DB-checked marker before acquiring the lock so the next cycle
  // re-validates against the DB after this execution resolves.
  dbCheckedKeys.delete(inflightKey)

  let execution
  let decisionEvent = null
  try {
    await withInflightLock(inflightMap, inflightKey, async () => {
      // One transaction: an execution from research never exists without its verified,
      // linked decision, and an accepted decision never exists without its execution.
      await prisma.$transaction(async (tx) => {
        // Cooldown eligibility and the insert are atomic across worker processes: the bot's
        // row is locked for this transaction, then the cooldown is re-read uncached inside it.
        // A concurrent placement for the same bot waits for this commit and then sees it.
        if (cooldownRule) {
          if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM Bot WHERE id = ${bot.id} FOR UPDATE`
          const recheck = await evaluateCooldown(cooldownRule.config ?? {}, bot.id, ticker, { fresh: true, prismaClient: tx })
          if (!recheck.pass) throw Object.assign(new Error('cooldown_active'), { cooldownBlock: recheck })
        }
        execution = await tx.execution.create({
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
            ...(simSession ? { simSession } : {}),
            signalScore:   confidence,
            pnl:           0,
            commission:    0,  // required columns; fees/commission are recorded on fill
            fees:          0
          }
        })
        if (research) {
          decisionEvent = await recordResearchDecision({
            userId: bot.userId,
            botId: bot.id,
            tenantId: research.policy.tenantId,
            trace: research.trace,
            decision: 'accepted',
            detail: `Bot accepted Alpha research: ${direction} ${ticker}`,
            context: { ...research.context, executionId },
            client: tx
          })
          await linkResearchDecisionToExecution({ userId: bot.userId, decisionEventId: decisionEvent.id, executionId, tx })
        }
      })
    }, { keepLockOn: isActiveIntentConflict })
  } catch (err) {
    if (err?.cooldownBlock) {
      await maybeLogRuleBlock(bot, ticker, direction, cooldownRule, err.cooldownBlock)
      return
    }
    if (isActiveIntentConflict(err)) {
      metricsIncrement('duplicate_race_condition')
      log.warn({ botId: bot.id, ticker, direction, activeIntentKey }, 'duplicate_race_condition')
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

  if (research) actedPredictions.add(`${bot.id}:${research.trace.source.predictionId}`)
  const linkedResearch = decisionEvent ? { ...researchRef, decisionEventId: decisionEvent.id } : null

  noteCooldownExecution(bot.id, ticker)
  log.info({ executionId: execution.id, botId: bot.id, ticker, direction, qty: quantity, confidence, predictionId: researchRef?.predictionId }, 'execution_queued')

  await logBotEvent(bot, 'execution_created', `Created ${direction} execution for ${ticker}`, ticker, {
    executionId: execution.id,
    direction,
    quantity,
    price: tick.last,
    signal,
    confidence,
    reason,
    metadata,
    riskScore: riskEvaluation.riskScore,
    riskDecision: riskRecord,
    ...(linkedResearch ? { research: linkedResearch } : {})
  })

  await recordExecutionAudit({
    executionId,
    userId: bot.userId,
    eventType: 'execution_created',
    detail: `Bot ${bot.id} created ${direction} ${quantity} ${ticker}`,
    metadata: {
      botId:      bot.id,
      botType:    bot.botType,
      strategyId: bot.strategyId ?? null,
      templateId: bot.templateId ?? null,
      signal,
      confidence,
      reason,
      riskScore: riskEvaluation.riskScore ?? null,
      riskDecision: riskRecord,
      ...(linkedResearch ? { research: linkedResearch } : {})
    }
  })
}

// ─── Research-driven signal ───────────────────────────────────────────────────

function researchReference(research) {
  return {
    predictionId: research.trace.source.predictionId,
    traceId: research.trace.traceId,
    evidenceSha256: research.trace.evidence.sha256,
    observedAt: research.trace.source.observedAt,
    tenantId: research.policy.tenantId
  }
}

function sameTicker(a, b) {
  const norm = (s) => String(s ?? '').toUpperCase().replace(/[.\-/]/g, '')
  return norm(a) === norm(b)
}

/** Throttled timeline event for research outcomes that do not create an execution. */
async function logResearchOnce(bot, ticker, key, type, detail, metadata) {
  const now = botEngineConfig.now().getTime()
  const throttleKey = `${bot.id}:${ticker}:${key}`
  if (now - (lastResearchEventAt.get(throttleKey) ?? -Infinity) < SKIP_EVENT_WINDOW_MS) return
  if (lastResearchEventAt.size > 5000) lastResearchEventAt.delete(lastResearchEventAt.keys().next().value)
  lastResearchEventAt.set(throttleKey, now)
  if (type === 'decision_made') {
    try {
      await recordResearchDecision(metadata)
    } catch (err) {
      log.error({ err: err.message, botId: bot.id, ticker }, 'research_decision_write_error')
    }
    return
  }
  await logBotEvent(bot, type, detail, ticker, metadata)
}

async function hasActedOnPrediction(bot, predictionId, policy) {
  const key = `${bot.id}:${predictionId}`
  if (actedPredictions.has(key)) return true
  // Accepted research decisions always carry an executionId (written atomically).
  // Exact bound: a prediction still young enough to trade was observed within the age
  // window, so any earlier acceptance of it also falls inside that window.
  const since = new Date(botEngineConfig.now().getTime() - (policy.maxPredictionAgeHours + 1) * 3_600_000)
  const linked = await prisma.botEvent.findMany({
    where: { botId: bot.id, type: 'decision_made', executionId: { not: null }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' }
  })
  const acted = linked.some((e) => e.metadata?.decision === 'accepted' && e.metadata?.predictionId === predictionId)
  if (acted) actedPredictions.add(key)
  return acted
}

/**
 * Locate, verify and evaluate Alpha research for (bot, ticker).
 * Returns { signal, confidence, trace, policy, context } when accepted, otherwise null
 * after recording why (no research / unavailable / unverified → skip event;
 * rejected / suppressed → decision_made with the verified evidence it was judged on).
 */
async function evaluateResearchSignal(bot, ticker, tick) {
  const resolved = resolveResearchPolicy(bot.config)
  if (!resolved.ok) {
    await logResearchOnce(bot, ticker, `policy:${resolved.reason}`, 'execution_skipped', `Invalid research policy for bot ${bot.id}`, { reason: 'invalid_research_policy', detail: resolved.reason })
    return null
  }
  const { policy } = resolved
  const now = botEngineConfig.now()
  const cacheKey = `${bot.id}:${ticker}`
  let cached = researchCache.get(cacheKey)
  if (!cached || now.getTime() - cached.at >= botEngineConfig.researchRecheckMs) {
    cached = null
    let located
    try {
      located = await engineClient.locateResearchPrediction(ticker, policy.tenantId, researchContext().locate)
    } catch (err) {
      await logResearchOnce(bot, ticker, 'unavailable', 'execution_skipped', `Alpha research unavailable for ${ticker}`, { reason: 'research_unavailable', error: err.message })
      return null
    }
    if (!located) {
      await logResearchOnce(bot, ticker, 'none', 'execution_skipped', `No ranked Alpha prediction for ${ticker}`, { reason: 'no_research_prediction' })
      return null
    }
    if (await hasActedOnPrediction(bot, located.predictionId, policy)) {
      await logResearchOnce(bot, ticker, `acted:${located.predictionId}`, 'execution_skipped', `Already acted on Alpha prediction for ${ticker}`, { reason: 'prediction_already_acted', predictionId: located.predictionId })
      return null
    }
    let trace
    try {
      trace = await fetchVerifiedResearchTrace(located.predictionId, policy.tenantId)
    } catch (err) {
      const reason = err.cause ? 'research_unavailable' : 'research_evidence_unverified'
      await logResearchOnce(bot, ticker, `${reason}:${located.predictionId}`, 'execution_skipped', `Alpha research evidence not usable for ${ticker}`, { reason, predictionId: located.predictionId })
      return null
    }
    if (!sameTicker(trace.source.ticker, ticker)) {
      await logResearchOnce(bot, ticker, `ticker:${located.predictionId}`, 'execution_skipped', `Alpha research ticker mismatch for ${ticker}`, { reason: 'research_ticker_mismatch', predictionId: located.predictionId, researchTicker: trace.source.ticker })
      return null
    }
    cached = { at: now.getTime(), located, trace }
    researchCache.set(cacheKey, cached)
  } else if (actedPredictions.has(`${bot.id}:${cached.trace.source.predictionId}`)) {
    return null
  }

  const { located, trace } = cached
  const rc = researchContext()
  const outcome = evaluateResearchDecision({
    trace, located, policy,
    price: tick?.last ?? tick?.ask,
    configDirection: bot.config?.direction === 'buy' || bot.config?.direction === 'sell' ? bot.config.direction : null,
    now: rc.now
  })
  if (rc.simulation) outcome.context = { ...outcome.context, simulation: rc.simulation }
  if (outcome.decision !== 'accepted') {
    await logResearchOnce(bot, ticker, `decision:${trace.source.predictionId}:${outcome.decision}:${outcome.reason}`, 'decision_made', null, {
      userId: bot.userId, botId: bot.id, tenantId: policy.tenantId, trace,
      decision: outcome.decision,
      detail: `Bot ${outcome.decision} Alpha research for ${ticker}: ${outcome.reason}`,
      context: outcome.context
    })
    return null
  }
  return { signal: outcome.signal, confidence: outcome.confidence, trace, policy, context: outcome.context }
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

    case 'relative_volume': {
      const md = await marketDataFor(ticker, priceCache.get(ticker))
      return relativeVolumeDecision(rule.config ?? {}, { volume: md.volume, avgVolume: md.avgVolume })
    }

    case 'price_change':
      return priceChangeDecision(rule.config ?? {}, { closes: await recentCloses(ticker, Number(rule.config?.sessions) || 1) })

    default:
      log.warn({ ruleType: rule.type }, 'unknown_rule_type')
      return { pass: true }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


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
  if (!broker) {
    let reason = 'NO_BROKER'
    try {
      const account = await prisma.brokerAccount.findUnique({
        where: { userId },
        select: { id: true, apiKey: true, apiSecret: true }
      })
      if (account && (!account.apiKey || !account.apiSecret)) {
        reason = 'INVALID_BROKER'
      }
    } catch {
      reason = 'INVALID_BROKER'
    }
    log.error({ userId, botId: null, reason }, 'missing_user_broker_credentials')
    return cached?.positions ?? []
  }

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
  return coreBuyQuantity({ bot, price: quote?.last ?? quote?.ask ?? 0 })
}

async function logBotEvent(bot, type, detail, ticker, metadata = {}) {
  try {
    return await prisma.botEvent.create({
      data: {
        id:          `evt_${randomUUID()}`,
        botId:       bot.id,
        portfolioId: bot.portfolioId,
        type,
        // BotEvent.detail is VARCHAR(191): long error text would make the event itself fail.
        detail:      String(detail ?? '').slice(0, 190),
        metadata:    { ticker, ...metadata }
      }
    })
  } catch (err) {
    log.error({ err: err.message, botId: bot.id, type, ticker }, 'bot_event_write_error')
    throw err
  }
}

const lastInflightCheckAt = new Map()

async function inflightIsStale(bot, ticker, inflightKey) {
  const now = Date.now()
  if (now - (lastInflightCheckAt.get(inflightKey) ?? 0) < SKIP_EVENT_WINDOW_MS / 2) return false
  lastInflightCheckAt.set(inflightKey, now)
  const active = await prisma.execution.findFirst({
    where: { botId: bot.id, ticker, status: { in: ACTIVE_EXECUTION_STATUSES } },
    select: { id: true }
  })
  return !active
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

async function maybeLogRuleBlock(bot, ticker, side, rule, result, { windowMs = SKIP_EVENT_WINDOW_MS } = {}) {
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
  if (Date.now() - lastLoggedAt < windowMs) {
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
