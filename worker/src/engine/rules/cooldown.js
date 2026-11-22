import prisma from '../../db/prisma.js'
import { ACTIVE_EXECUTION_STATUSES } from '../../queues/executionStatus.js'

// Cache last-execution timestamp per (botId, ticker) to avoid a DB query every tick.
// TTL is half the minimum practical cooldown (30s) — short enough to stay accurate,
// long enough to eliminate the query for rapidly ticking symbols.
const cooldownCache = new Map() // `${botId}:${ticker}` → { lastAt, fetchedAt }
const COOLDOWN_CACHE_TTL_MS = 30_000

function windowMsFromConfig(config) {
  if (!config || typeof config !== 'object') return null

  if (config.windowMs != null) {
    const ms = Number(config.windowMs)
    return Number.isFinite(ms) && ms > 0 ? ms : null
  }

  if (config.cooldownHours != null) {
    const hours = Number(config.cooldownHours)
    return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60_000 : null
  }

  if (config.minutes != null) {
    const minutes = Number(config.minutes)
    return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : null
  }

  return null
}

/**
 * Records a just-created execution so the cached cooldown can't let further orders
 * through before the cache would otherwise refresh. Only ever makes the rule stricter.
 */
export function noteCooldownExecution(botId, ticker, at = Date.now()) {
  cooldownCache.set(`${botId}:${ticker}`, { lastAt: at, fetchedAt: at })
}

// config supports: { windowMs } | { cooldownHours } | { minutes }
/** Test/restart helper: forget every cached cooldown result (as a fresh process would). */
export function resetCooldownCache() {
  cooldownCache.clear()
}

// `fresh: true` skips the cache and asks the database (used right before an order is
// inserted, so a cached pass can never outlive an order placed by another evaluation).
export async function evaluateCooldown(config, botId, ticker, { fresh = false, prismaClient = prisma } = {}) {
  const windowMs = windowMsFromConfig(config)
  if (!windowMs) {
    return { pass: false, reason: 'cooldown_invalid_config' }
  }

  const cacheKey = `${botId}:${ticker}`
  const now = Date.now()
  const since = new Date(now - windowMs)

  const cached = cooldownCache.get(cacheKey)
  let lastAt

  if (!fresh && cached && now - cached.fetchedAt < COOLDOWN_CACHE_TTL_MS) {
    lastAt = cached.lastAt
  } else {
    const recent = await prismaClient.execution.findFirst({
      where: {
        botId,
        ticker,
        OR: [
          { status: { in: ACTIVE_EXECUTION_STATUSES }, createdAt: { gte: since } },
          { status: 'filled', filledAt: { gte: since } },
          // An order refused at submission (e.g. a daily notional cap) counts as an attempt,
          // so the bot backs off for its cooldown instead of re-submitting every cycle.
          { status: 'cancelled', cancelReason: { startsWith: 'refused:' }, createdAt: { gte: since } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, status: true }
    })
    lastAt = recent ? recent.createdAt.getTime() : 0
    cooldownCache.set(cacheKey, { lastAt, fetchedAt: now })
  }

  if (lastAt && now - lastAt < windowMs) {
    const minsAgo = Math.round((now - lastAt) / 60_000)
    return {
      pass:   false,
      reason: 'cooldown_active',
      detail: `last execution was ${minsAgo}m ago`
    }
  }

  return { pass: true }
}
