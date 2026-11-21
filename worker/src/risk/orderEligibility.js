/**
 * Final order-eligibility boundary, evaluated immediately before a broker submit.
 *
 * Every check fails closed: missing data is a refusal with a reason, never a pass.
 * Returns { allowed: true } or { allowed: false, reason, metrics }.
 * Broker network errors while reading buying power propagate (retryable, nothing submitted).
 */
import prisma from '../db/prisma.js'
import { BrokerRejectionError } from '../broker/alpacaClient.js'
import { evaluateRiskCaps } from './riskCaps.js'
import { ACTIVE_EXECUTION_STATUSES } from '../queues/executionStatus.js'
import { readEmergencyStop } from '../../../server/src/services/emergencyStopService.js'
import { calculateFifoAccounting, loadBotFills, realizedPnlSince } from '../../../server/src/services/botAccountingService.js'

function envNumber(name, fallback) {
  const v = Number(process.env[name])
  return process.env[name] != null && process.env[name] !== '' && Number.isFinite(v) ? v : fallback
}

export const eligibilityConfig = {
  // An intent's reference price older than this is not trusted for sizing/limits.
  maxPriceAgeMs: envNumber('WORKER_MAX_INTENT_PRICE_AGE_MS', 5 * 60_000),
}

function refuse(reason, metrics = {}) {
  return { allowed: false, reason, metrics }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function startOfDay(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

export async function evaluateOrderEligibility(execution, { broker, now = new Date(), prismaClient = prisma } = {}) {
  // 1. Emergency stop (user-wide) — applies to manual and bot orders alike.
  const user = await prismaClient.user.findUnique({ where: { id: execution.userId }, select: { riskSettings: true } })
  if (!user) return refuse('unknown_user')
  const es = readEmergencyStop(user.riskSettings)
  if (es.active) return refuse('emergency_stop', { activatedAt: es.activatedAt })

  // 2. Order shape and price.
  const quantity = num(execution.quantity)
  if (quantity === null || quantity <= 0) return refuse('invalid_quantity', { quantity: execution.quantity })
  const price = num(execution.price)
  if (price === null || price <= 0) return refuse('missing_price', { price: execution.price })
  const priceAgeMs = now.getTime() - new Date(execution.createdAt).getTime()
  if (!Number.isFinite(priceAgeMs) || priceAgeMs > eligibilityConfig.maxPriceAgeMs) {
    return refuse('stale_price', { priceAgeMs: Number.isFinite(priceAgeMs) ? priceAgeMs : null, maxPriceAgeMs: eligibilityConfig.maxPriceAgeMs })
  }
  const notional = quantity * price
  const direction = String(execution.direction).toLowerCase()

  // 3. Bot state and bot-level limits.
  if (execution.botId) {
    const bot = await prismaClient.bot.findUnique({ where: { id: execution.botId } })
    if (!bot || bot.deletedAt) return refuse('bot_stopped')
    if (bot.userId !== execution.userId) return refuse('bot_owner_mismatch')
    if (!bot.enabled) return refuse('bot_paused')
    const config = bot.config && typeof bot.config === 'object' ? bot.config : {}

    const fills = await loadBotFills(bot.id, { prismaClient })
    const accounting = calculateFifoAccounting(fills)
    const others = await prismaClient.execution.findMany({
      where: { botId: bot.id, id: { not: execution.id }, status: { in: ACTIVE_EXECUTION_STATUSES } },
      select: { direction: true, ticker: true, quantity: true, price: true, filledQuantity: true }
    })

    if (direction === 'buy') {
      const maxOrder = num(config.maxOrderNotional)
      if (maxOrder !== null && maxOrder > 0 && notional > maxOrder + 1e-6) {
        return refuse('max_order_value', { notional, maxOrderNotional: maxOrder })
      }
      const allocation = num(config.allocatedAmount)
      if (allocation !== null && allocation > 0) {
        const inUse = accounting.capitalInUse ?? 0
        // Unfilled remainder of this bot's other open buys is committed against its allocation.
        const pending = others
          .filter((o) => String(o.direction).toLowerCase() === 'buy')
          .reduce((s, o) => s + Math.max(0, (num(o.quantity) ?? 0) - (num(o.filledQuantity) ?? 0)) * (num(o.price) ?? 0), 0)
        if (inUse + pending + notional > allocation + 1e-6) {
          return refuse('bot_allocation_exceeded', { allocation, inUse, pending, notional })
        }
      }
    } else if (direction === 'sell') {
      const ticker = String(execution.ticker).toUpperCase()
      const held = accounting.openPositions?.[ticker]?.quantity ?? 0
      const pendingSells = others
        .filter((o) => String(o.direction).toLowerCase() === 'sell' && String(o.ticker).toUpperCase() === ticker)
        .reduce((s, o) => s + Math.max(0, (num(o.quantity) ?? 0) - (num(o.filledQuantity) ?? 0)), 0)
      if (quantity > held - pendingSells + 1e-7) {
        return refuse('sell_exceeds_attributable_holdings', { quantity, held, pendingSells })
      }
    } else {
      return refuse('invalid_direction', { direction: execution.direction })
    }

    // Bot daily loss: realized FIFO P/L today against the bot's daily_loss rule / config.
    const rules = await prismaClient.botRule.findMany({ where: { botId: bot.id, type: 'daily_loss', enabled: true } })
    const limits = [num(config.maxDailyLoss), ...rules.map((r) => num(r.config?.maxLoss))].filter((v) => v !== null && v > 0)
    if (limits.length > 0) {
      const limit = Math.min(...limits)
      const today = realizedPnlSince(fills, startOfDay(now))
      if (today <= -limit) return refuse('daily_loss_limit', { realizedToday: today, limit })
    }
  } else if (direction !== 'buy' && direction !== 'sell') {
    return refuse('invalid_direction', { direction: execution.direction })
  }

  // 4. User-wide caps (existing).
  const caps = await evaluateRiskCaps(execution)
  if (!caps.allowed) return refuse(caps.reason, caps.metrics)

  // 5. Paper buying power (buys). Network errors propagate as retryable.
  if (direction === 'buy') {
    if (!broker) return refuse('invalid_credentials')
    let account
    try {
      account = await broker.getAccount()
    } catch (err) {
      if (err instanceof BrokerRejectionError) {
        return refuse(err.credentialError ? 'invalid_credentials' : 'buying_power_unavailable', { broker: err.reason })
      }
      throw err
    }
    const buyingPower = num(account?.buying_power ?? account?.buyingPower)
    if (buyingPower === null) return refuse('buying_power_unavailable')
    if (notional > buyingPower + 1e-6) return refuse('insufficient_buying_power', { notional, buyingPower })
  }

  return { allowed: true, notional }
}
