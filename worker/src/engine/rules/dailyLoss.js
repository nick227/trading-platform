import prisma from '../../db/prisma.js'

// config: { maxLoss: number }  — maxLoss is a positive dollar amount e.g. 500
export async function evaluateDailyLoss(config, portfolioId) {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  // Aggregate today's filled executions for this portfolio
  const fills = await prisma.execution.findMany({
    where: {
      portfolioId,
      status: 'filled',
      filledAt: { gte: startOfDay }
    },
    select: { direction: true, filledPrice: true, filledQuantity: true }
  })

  // Realized P&L: sells - buys (negative = loss)
  let realizedPnL = 0
  for (const fill of fills) {
    const value = (fill.filledPrice ?? 0) * (fill.filledQuantity ?? 0)
    realizedPnL += fill.direction === 'sell' ? value : -value
  }

  // realizedPnL < 0 means we're losing money
  const loss = Math.abs(Math.min(0, realizedPnL))

  if (loss >= config.maxLoss) {
    return {
      pass:   false,
      reason: 'daily_loss_limit_reached',
      detail: `realized loss $${loss.toFixed(2)} >= limit $${config.maxLoss}`
    }
  }

  return { pass: true, currentLoss: loss }
}
