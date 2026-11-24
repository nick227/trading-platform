import prisma from '../../db/prisma.js'
import { realizedPnlSince } from '../../../../server/src/services/botAccountingService.js'

// Cache per-portfolio daily loss to avoid a DB scan on every tick.
// 30s TTL means worst-case 30s lag before a new fill affects the rule — acceptable
// given fills are the rare case and the inflight guard prevents over-trading anyway.
const lossCache = new Map() // portfolioId → { loss, fetchedAt, dayStart }

export function resetDailyLossCache() {
  lossCache.clear()
}
const LOSS_CACHE_TTL_MS = 30_000

// config: { maxLoss?: number, maxDailyLoss?: number } — maxLoss is a positive dollar amount e.g. 500
export async function evaluateDailyLoss(config, portfolioId) {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const dayKey = startOfDay.getTime()

  const maxLoss = Number(config.maxLoss ?? config.maxDailyLoss ?? Infinity)

  const now = Date.now()
  const cached = lossCache.get(portfolioId)
  let loss
  if (cached && cached.dayStart === dayKey && now - cached.fetchedAt < LOSS_CACHE_TTL_MS) {
    loss = cached.loss
  } else {
    // Realized P/L of today's sells, FIFO against the portfolio's full fill history — the
    // same accounting as Home. (Previously a buy's cost counted as a "loss", so any bot
    // with a daily-loss limit stopped buying after a few purchases.)
    const fills = await prisma.execution.findMany({
      where: { portfolioId, filledQuantity: { gt: 0 }, filledPrice: { gt: 0 } },
      orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, ticker: true, direction: true, filledPrice: true, filledQuantity: true, filledAt: true, createdAt: true, fees: true, commission: true }
    })
    const realizedToday = realizedPnlSince(fills, startOfDay)
    loss = Math.abs(Math.min(0, realizedToday))
    lossCache.set(portfolioId, { loss, fetchedAt: now, dayStart: dayKey })
  }

  return dailyLossDecision(maxLoss, loss)
}

/** Pure decision: today's realized loss (positive number) against the limit. */
export function dailyLossDecision(maxLoss, loss) {
  if (loss >= maxLoss) {
    return {
      pass:   false,
      reason: 'daily_loss_limit_reached',
      detail: `realized loss $${loss.toFixed(2)} >= limit $${maxLoss}`
    }
  }

  return { pass: true, currentLoss: loss }
}
