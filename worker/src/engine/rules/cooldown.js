import prisma from '../../db/prisma.js'

// config: { minutes: number }
export async function evaluateCooldown(config, botId, ticker) {
  const since = new Date(Date.now() - config.minutes * 60_000)

  const recentFill = await prisma.execution.findFirst({
    where: {
      botId,
      ticker,
      status: 'filled',
      filledAt: { gte: since }
    },
    orderBy: { filledAt: 'desc' }
  })

  if (recentFill) {
    const filledMinsAgo = Math.round((Date.now() - recentFill.filledAt.getTime()) / 60_000)
    return {
      pass:   false,
      reason: `cooldown_active`,
      detail: `last fill was ${filledMinsAgo}m ago, cooldown is ${config.minutes}m`
    }
  }

  return { pass: true }
}
