/**
 * Durable, fail-closed AI spending governor.
 *
 * Uses atomic SQL updates inside one database transaction to enforce both
 * platform and bot budgets under concurrent workers. Units are integer cents.
 */
import { createHash } from 'node:crypto'
import prisma from '../../loaders/prisma.js'

const positiveInt = value => {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : 0
}

export function createAiUsageGovernor({
  prismaClient = prisma,
  env = process.env,
  now = () => new Date()
} = {}) {
  const platformCap = positiveInt(env.AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS)
  const botCap = positiveInt(env.AI_STOCK_TRADER_BOT_BUDGET_CENTS)
  const reserveCents = positiveInt(env.AI_STOCK_TRADER_RESERVE_CENTS_PER_CALL) || 5

  function scopeIds(botId, period) {
    return [
      { id: `platform:${period}`, budgetCents: platformCap },
      { id: `bot:${botId}:${period}`, budgetCents: botCap }
    ]
  }

  async function reserve({ botId, jobKey, model }) {
    if (env.ENABLE_FLAGSHIP_STOCK_TRADER !== 'true' || env.ENABLE_AI_PAID_CALLS !== 'true') {
      throw new Error('AI provider spending is not enabled')
    }
    if (!platformCap || !botCap || reserveCents > Math.min(platformCap, botCap)) {
      throw new Error('AI budget missing or too small for reserved call')
    }
    if (!botId || !jobKey || !model) throw new Error('AI call attribution required')
    const period = now().toISOString().slice(0, 7)
    const id = 'ai_call_' + createHash('sha256').update(`${botId}:${jobKey}`).digest('hex').slice(0, 40)

    await prismaClient.$transaction(async tx => {
      await tx.aiUsageCall.create({
        data: { id, botId, period, jobKey, model, status: 'reserved', reservedCents: reserveCents }
      })
      for (const scope of scopeIds(botId, period)) {
        await tx.aiUsageBucket.upsert({
          where: { id: scope.id },
          create: { ...scope, period, reservedCents: 0, spentCents: 0 },
          update: { budgetCents: scope.budgetCents }
        })
        const changed = await tx.$executeRaw`
          UPDATE AiUsageBucket
          SET reservedCents = reservedCents + ${reserveCents}
          WHERE id = ${scope.id}
            AND (reservedCents + spentCents + ${reserveCents}) <= budgetCents
        `
        if (Number(changed) !== 1) throw new Error(`AI budget exhausted: ${scope.id}`)
      }
    })
    return { id, botId, period, reservedCents: reserveCents }
  }

  async function settle(reservation, { usage = null, uncertain = false } = {}) {
    if (!reservation?.id || !reservation.botId || !reservation.period) throw new Error('AI reservation required')
    const inputTokens = positiveInt(usage?.prompt_tokens)
    const outputTokens = positiveInt(usage?.completion_tokens)
    const inputRate = Number(env.AI_OPENAI_INPUT_USD_PER_MILLION ?? 0.15)
    const outputRate = Number(env.AI_OPENAI_OUTPUT_USD_PER_MILLION ?? 0.60)
    if (![inputRate, outputRate].every(n => Number.isFinite(n) && n >= 0)) {
      throw new Error('Invalid AI token pricing configuration')
    }
    const calculated = Math.ceil(100 * (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000)
    // Missing usage is uncertain, so conservatively charge the entire reservation.
    const actualCents = uncertain || !usage ? reservation.reservedCents : Math.max(1, calculated)
    const status = uncertain || !usage ? 'uncertain' : 'completed'
    return prismaClient.$transaction(async tx => {
      const changed = await tx.aiUsageCall.updateMany({
        where: { id: reservation.id, status: 'reserved' },
        data: {
          status, actualCents, promptTokens: inputTokens, outputTokens: outputTokens,
          completedAt: now()
        }
      })
      if (changed.count !== 1) return { settled: false, reason: 'already_settled' }
      for (const scope of scopeIds(reservation.botId, reservation.period)) {
        await tx.aiUsageBucket.update({
          where: { id: scope.id },
          data: {
            reservedCents: { decrement: reservation.reservedCents },
            spentCents: { increment: actualCents }
          }
        })
      }
      return { settled: true, status, actualCents }
    })
  }

  return { reserve, settle }
}

/**
 * Durable per-user AI spending governor for Personal AI Traders.
 * Enforces both platform-wide (`AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS`) and
 * per-user (`AI_USER_TRADER_MONTHLY_BUDGET_CENTS`) monthly caps atomically,
 * gated by `ENABLE_USER_AI_TRADERS=true` and `ENABLE_AI_PAID_CALLS=true`.
 */
export function createPersonalAiUsageGovernor({
  userId,
  prismaClient = prisma,
  env = process.env,
  now = () => new Date()
} = {}) {
  const cleanUserId = String(userId ?? '').trim()
  const platformCap = positiveInt(env.AI_STOCK_TRADER_MONTHLY_BUDGET_CENTS)
  const userCap = positiveInt(env.AI_USER_TRADER_MONTHLY_BUDGET_CENTS)
  const reserveCents = positiveInt(env.AI_STOCK_TRADER_RESERVE_CENTS_PER_CALL) || 5

  function scopeIds(period) {
    return [
      { id: `platform:${period}`, budgetCents: platformCap },
      { id: `user_trader:${cleanUserId}:${period}`, budgetCents: userCap }
    ]
  }

  async function reserve({ botId, jobKey, model }) {
    if (!cleanUserId) throw new Error('User attribution required for Personal AI Trader budget')
    if (env.ENABLE_USER_AI_TRADERS !== 'true' || env.ENABLE_AI_PAID_CALLS !== 'true') {
      throw new Error('Personal AI Trader provider spending is not enabled')
    }
    if (!platformCap || !userCap || reserveCents > Math.min(platformCap, userCap)) {
      throw new Error('Personal AI Trader budget missing or too small for reserved call')
    }
    if (!botId || !jobKey || !model) throw new Error('AI call attribution required')
    const period = now().toISOString().slice(0, 7)
    const id = 'ai_call_' + createHash('sha256').update(`user:${cleanUserId}:${botId}:${jobKey}`).digest('hex').slice(0, 40)

    await prismaClient.$transaction(async tx => {
      await tx.aiUsageCall.create({
        data: { id, botId, period, jobKey, model, status: 'reserved', reservedCents: reserveCents }
      })
      for (const scope of scopeIds(period)) {
        await tx.aiUsageBucket.upsert({
          where: { id: scope.id },
          create: { ...scope, period, reservedCents: 0, spentCents: 0 },
          update: { budgetCents: scope.budgetCents }
        })
        const changed = await tx.$executeRaw`
          UPDATE AiUsageBucket
          SET reservedCents = reservedCents + ${reserveCents}
          WHERE id = ${scope.id}
            AND (reservedCents + spentCents + ${reserveCents}) <= budgetCents
        `
        if (Number(changed) !== 1) throw new Error(`AI budget exhausted: ${scope.id}`)
      }
    })
    return { id, botId, userId: cleanUserId, period, reservedCents: reserveCents }
  }

  async function settle(reservation, { usage = null, uncertain = false } = {}) {
    if (!reservation?.id || !reservation.botId || !reservation.period) throw new Error('AI reservation required')
    const inputTokens = positiveInt(usage?.prompt_tokens)
    const outputTokens = positiveInt(usage?.completion_tokens)
    const inputRate = Number(env.AI_OPENAI_INPUT_USD_PER_MILLION ?? 0.15)
    const outputRate = Number(env.AI_OPENAI_OUTPUT_USD_PER_MILLION ?? 0.60)
    if (![inputRate, outputRate].every(n => Number.isFinite(n) && n >= 0)) {
      throw new Error('Invalid AI token pricing configuration')
    }
    const calculated = Math.ceil(100 * (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000)
    const actualCents = uncertain || !usage ? reservation.reservedCents : Math.max(1, calculated)
    const status = uncertain || !usage ? 'uncertain' : 'completed'

    return prismaClient.$transaction(async tx => {
      const changed = await tx.aiUsageCall.updateMany({
        where: { id: reservation.id, status: 'reserved' },
        data: {
          status,
          actualCents,
          promptTokens: inputTokens,
          outputTokens,
          completedAt: now()
        }
      })
      if (changed.count !== 1) return { settled: false, reason: 'already_settled' }
      for (const scope of scopeIds(reservation.period)) {
        await tx.aiUsageBucket.update({
          where: { id: scope.id },
          data: {
            reservedCents: { decrement: reservation.reservedCents },
            spentCents: { increment: actualCents }
          }
        })
      }
      return { settled: true, status, actualCents }
    })
  }

  return { reserve, settle }
}
