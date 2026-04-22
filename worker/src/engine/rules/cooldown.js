import prisma from '../../db/prisma.js'

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

// config supports: { windowMs } | { cooldownHours } | { minutes }
export async function evaluateCooldown(config, botId, ticker) {
  const windowMs = windowMsFromConfig(config)
  if (!windowMs) {
    return { pass: false, reason: 'cooldown_invalid_config' }
  }

  const cacheKey = `${botId}:${ticker}`
  const now = Date.now()
  const since = new Date(now - windowMs)

  const cached = cooldownCache.get(cacheKey)
  let lastAt

  if (cached && now - cached.fetchedAt < COOLDOWN_CACHE_TTL_MS) {
    lastAt = cached.lastAt
  } else {
    const recent = await prisma.execution.findFirst({
      where: {
        botId,
        ticker,
        OR: [
          { status: { in: ['queued', 'processing', 'submitted', 'partially_filled'] }, createdAt: { gte: since } },
          { status: 'filled', filledAt: { gte: since } }
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
