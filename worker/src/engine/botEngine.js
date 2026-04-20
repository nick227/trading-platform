import prisma from '../db/prisma.js'
import { randomUUID } from 'crypto'
import { getBrokerClient } from '../broker/clientCache.js'
import { priceCache } from '../market/priceCache.js'
import { subscribe, unsubscribe } from '../market/dataStream.js'
import { evaluateMarketHours }    from './rules/marketHours.js'
import { evaluatePriceThreshold } from './rules/priceThreshold.js'
import { evaluateCooldown }       from './rules/cooldown.js'
import { evaluatePositionLimit }  from './rules/positionLimit.js'
import { evaluateDailyLoss }      from './rules/dailyLoss.js'
import { recordExecutionAudit }   from '../audit/executionAudit.js'

// In-memory state
const botRegistry  = new Map()  // botId → bot (with rules)
const tickerIndex  = new Map()  // ticker → Set<botId>
export const inflightMap = new Map()  // `${botId}:${ticker}` → true
const lastSkipEventAt = new Map()

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

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export async function startBotEngine() {
  if (reloadTimer) {
    return
  }
  console.log('[botEngine] starting')
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
      console.log(`[botEngine] pre-loaded ${active.length} inflight guard(s) from DB`)
    }
  } catch (err) {
    console.error('[botEngine] initInflightMap error:', err.message)
  }
}

export function stopBotEngine() {
  if (reloadTimer) clearInterval(reloadTimer)
  reloadTimer = null
  botRegistry.clear()
  tickerIndex.clear()
  // Unsubscribe all tickers
  if (previousTickers.size > 0) {
    unsubscribe([...previousTickers])
  }
  previousTickers = new Set()
  console.log('[botEngine] stopped')
}

// ─── Bot registry reload ──────────────────────────────────────────────────────

async function reloadBots() {
  try {
    const bots = await prisma.bot.findMany({
      where: { enabled: true, deletedAt: null },
      include: { rules: { where: { enabled: true } } }
    })

    botRegistry.clear()
    const newTickerIndex = new Map()

    for (const bot of bots) {
      botRegistry.set(bot.id, bot)
      const tickers = bot.config?.tickers ?? []
      for (const ticker of tickers) {
        if (!newTickerIndex.has(ticker)) newTickerIndex.set(ticker, new Set())
        newTickerIndex.get(ticker).add(bot.id)
      }
    }

    tickerIndex.clear()
    for (const [k, v] of newTickerIndex) tickerIndex.set(k, v)

    // Compute delta and update subscriptions — explicit loops avoid intermediate array allocations
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
    console.error('[botEngine] reloadBots error:', err.message)
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
        console.error(`[botEngine] evaluateBot error (${botId}/${ticker}):`, err.message)
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

  // Fallback guard: DB check (covers restart where map was cleared)
  const inflight = await prisma.execution.findFirst({
    where: { botId: bot.id, ticker, status: { in: ACTIVE_EXECUTION_STATUSES } }
  })
  if (inflight) {
    inflightMap.set(inflightKey, true)
    return
  }

  // Run rule pipeline — first failure short-circuits
  // Avoid per-tick broker REST calls unless a rule actually needs positions.
  const needsPositions = bot.rules.some(r => r.type === 'position_limit')
  const positions = needsPositions ? await getPositions(bot.userId) : []
  for (const rule of bot.rules) {
    const result = await evaluateRule(rule, bot, ticker, positions)
    if (!result.pass) {
      const eventType = result.stale ? 'execution_skipped' : 'execution_skipped'
      await logBotEvent(bot, eventType, `Rule "${rule.name}" blocked: ${result.reason}`, ticker, {
        ruleId:   rule.id,
        rule:     rule.type,
        reason:   result.reason,
        detail:   result.detail ?? null
      })
      return
    }
  }

  // All rules passed — create execution (enters order pipeline)
  const quote = priceCache.get(ticker)
  const executionId = `exe_${Date.now()}_${randomUUID().slice(0, 8)}`
  const direction = deriveDirection(bot)
  const activeIntentKey = buildActiveIntentKey(bot.id, ticker, direction)

  let execution
  try {
    execution = await prisma.execution.create({
      data: {
        id:              executionId,
        userId:          bot.userId,
        portfolioId:     bot.portfolioId,
        strategyId:      bot.strategyId ?? null,  // null for rule_based bots
        botId:           bot.id,
        ticker,
        direction,
        quantity:        bot.config?.quantity ?? 1,
        price:           quote?.last ?? 0,  // intent price — filledPrice is the truth
        origin:          'bot',
        status:          'queued',
        clientOrderId:   `tp_${executionId}`,
        activeIntentKey,
        commission:      0,
        fees:            0
      }
    })
  } catch (err) {
    if (isActiveIntentConflict(err)) {
      inflightMap.set(inflightKey, true)
      await maybeLogInflightSkip(bot, ticker, inflightKey)
      return
    }
    throw err
  }

  // Set inflight guard immediately so subsequent ticks skip this bot+ticker
  inflightMap.set(inflightKey, true)

  await logBotEvent(bot, 'execution_created', `Order queued for ${ticker}`, ticker, {
    executionId: execution.id,
    price:       execution.price,
    quantity:    execution.quantity,
    direction:   execution.direction
  })
  await recordExecutionAudit({
    executionId: execution.id,
    userId: execution.userId,
    eventType: 'execution_created',
    detail: `Bot execution queued for ${ticker}`,
    metadata: {
      origin: 'bot',
      botId: bot.id,
      clientOrderId: execution.clientOrderId,
      activeIntentKey,
      quantity: execution.quantity,
      direction: execution.direction,
      price: execution.price
    }
  })
}

// ─── Rule dispatching ─────────────────────────────────────────────────────────

async function evaluateRule(rule, bot, ticker, positions) {
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

    default:
      console.warn(`[botEngine] unknown rule type: ${rule.type}`)
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

async function logBotEvent(bot, type, detail, ticker, metadata = {}) {
  try {
    await prisma.botEvent.create({
      data: {
        id:          `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        botId:       bot.id,
        portfolioId: bot.portfolioId,
        type,
        detail,
        metadata:    { ticker, ...metadata }
      }
    })
  } catch (err) {
    console.error('[botEngine] failed to log BotEvent:', err.message)
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
