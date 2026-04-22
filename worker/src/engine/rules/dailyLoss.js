import prisma from '../../db/prisma.js'

// Cache per-portfolio daily loss to avoid a DB scan on every tick.
// 30s TTL means worst-case 30s lag before a new fill affects the rule — acceptable
// given fills are the rare case and the inflight guard prevents over-trading anyway.
const lossCache = new Map() // portfolioId → { loss, fetchedAt, dayStart }
const LOSS_CACHE_TTL_MS = 30_000

// config: { maxLoss: number }  — maxLoss is a positive dollar amount e.g. 500
export async function evaluateDailyLoss(config, portfolioId) {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const dayKey = startOfDay.getTime()

  const now = Date.now()
  const cached = lossCache.get(portfolioId)
  let loss
  if (cached && cached.dayStart === dayKey && now - cached.fetchedAt < LOSS_CACHE_TTL_MS) {
    loss = cached.loss
  } else {
    // Aggregate today's filled executions for this portfolio
    const fills = await prisma.execution.findMany({
      where: {
        portfolioId,
        status: 'filled',
        filledAt: { gte: startOfDay }
      },
      select: { direction: true, filledPrice: true, filledQuantity: true }
    })

    let realizedPnL = 0
    for (const fill of fills) {
      const value = (fill.filledPrice ?? 0) * (fill.filledQuantity ?? 0)
      realizedPnL += fill.direction === 'sell' ? value : -value
    }
    loss = Math.abs(Math.min(0, realizedPnL))
    lossCache.set(portfolioId, { loss, fetchedAt: now, dayStart: dayKey })
  }

  if (loss >= config.maxLoss) {
    return {
      pass:   false,
      reason: 'daily_loss_limit_reached',
      detail: `realized loss $${loss.toFixed(2)} >= limit $${config.maxLoss}`
    }
  }

  return { pass: true, currentLoss: loss }
}
