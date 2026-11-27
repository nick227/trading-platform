
import { createHash } from 'node:crypto'
import prisma from '../../loaders/prisma.js'

/**
 * Research-only budget scopes share AI usage tables but NEVER require a Bot or
 * the flagship enable flags. The feature defaults OFF and all sums use integer cents.
 */
export function createResearchUsageGovernor({ db = prisma, env = process.env, now = () => new Date() } = {}) {
  const positive = x => Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : 0
  const platformCap = positive(env.RESEARCH_PARTNER_PLATFORM_BUDGET_CENTS)
  const userCap = positive(env.RESEARCH_PARTNER_USER_BUDGET_CENTS)
  const partnerCap = positive(env.RESEARCH_PARTNER_PARTNER_BUDGET_CENTS)
  const reserveCents = positive(env.RESEARCH_PARTNER_RESERVE_CENTS_PER_CALL) || 10
  const enabled = () => env.ENABLE_RESEARCH_PARTNER_AI_CALLS === 'true'
  const scopes = (userId, partnerId, period) => [
    { id: 'rp:platform:' + period, budgetCents: platformCap },
    { id: 'rp:user:' + userId + ':' + period, budgetCents: userCap },
    { id: 'rp:partner:' + partnerId + ':' + period, budgetCents: partnerCap }
  ]
  async function reserve({ userId, partnerId, jobKey, model }) {
    if (!enabled()) throw new Error('Research Partner AI calls are disabled')
    if (!userId || !partnerId || !jobKey || !model) throw new Error('Research AI call attribution required')
    if (!platformCap || !userCap || !partnerCap || reserveCents > Math.min(platformCap, userCap, partnerCap)) {
      throw new Error('Research AI budgets are missing or too small')
    }
    const period = now().toISOString().slice(0, 7)
    const id = 'ai_call_' + createHash('sha256').update(partnerId + ':' + jobKey).digest('hex').slice(0, 40)
    await db.$transaction(async tx => {
      await tx.aiUsageCall.create({
        data: { id, botId: 'research:' + partnerId, period, jobKey, model, status: 'reserved', reservedCents: reserveCents }
      })
      for (const scope of scopes(userId, partnerId, period)) {
        await tx.aiUsageBucket.upsert({
          where: { id: scope.id },
          create: { ...scope, period, reservedCents: 0, spentCents: 0 },
          update: { budgetCents: scope.budgetCents }
        })
        const changed = await tx.$executeRaw`UPDATE AiUsageBucket SET reservedCents = reservedCents + ${reserveCents} WHERE id = ${scope.id} AND (reservedCents + spentCents + ${reserveCents}) <= budgetCents`
        if (Number(changed) !== 1) throw new Error('Research AI spending budget exhausted')
      }
    })
    return { id, userId, partnerId, period, reservedCents: reserveCents }
  }
  async function settle(reservation, { usage = null, uncertain = false } = {}) {
    if (!reservation?.id || !reservation.userId || !reservation.partnerId) throw new Error('Reservation required')
    const promptTokens = positive(usage?.prompt_tokens)
    const outputTokens = positive(usage?.completion_tokens)
    const inRate = Number(env.RESEARCH_PARTNER_INPUT_USD_PER_MILLION ?? 0.15)
    const outRate = Number(env.RESEARCH_PARTNER_OUTPUT_USD_PER_MILLION ?? 0.60)
    if (![inRate, outRate].every(x => Number.isFinite(x) && x >= 0)) throw new Error('Invalid model pricing')
    const actualCents = uncertain || !usage ? reservation.reservedCents
      : Math.max(1, Math.ceil(100 * (promptTokens * inRate + outputTokens * outRate) / 1000000))
    return db.$transaction(async tx => {
      const claimed = await tx.aiUsageCall.updateMany({
        where: { id: reservation.id, status: 'reserved' },
        data: { status: uncertain || !usage ? 'uncertain' : 'completed', actualCents,
          promptTokens, outputTokens, completedAt: now() }
      })
      if (claimed.count !== 1) return { settled: false }
      for (const scope of scopes(reservation.userId, reservation.partnerId, reservation.period)) {
        await tx.aiUsageBucket.update({
          where: { id: scope.id },
          data: { reservedCents: { decrement: reservation.reservedCents },
            spentCents: { increment: actualCents } }
        })
      }
      return { settled: true, actualCents }
    })
  }
  return { reserve, settle, enabled }
}
