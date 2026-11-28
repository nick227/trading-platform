/**
 * Central Policy, Provenance & Atomic Portfolio Reservation Engine (P4)
 *
 * Sits between Trade Generation (Manual, Rule-Based Bots, AI Trader, Copilot Proposals)
 * and ExecutionGateway. Enforces inside a portfolio-serialized transaction:
 *   1. Identity, EmergencyStop, Portfolio active status, and `alpaca_live` containment.
 *   2. Verifiable `AuthorizationEnvelope` (AI never self-authorizes; `paper_veto_sim_only`
 *      and `platform_sim_showcase` are permanently restricted to `internal_sim`).
 *   3. `MarketObservation` provenance & freshness compatibility with portfolio environment
 *      and execution timing.
 *   4. Atomic portfolio-locked cash & attributable share-lot reservations (`PortfolioCapitalReservation`),
 *      preventing concurrent independent bots on a shared portfolio from over-allocating cash
 *      or selling external unmanaged shares.
 */
import { createHash, randomUUID } from 'node:crypto'
import prisma from '../loaders/prisma.js'
import {
  microsTo4Decimals,
  microsToDollars,
  mulMicros,
  toMicros
} from '../domain/money.js'
import { readEmergencyStop } from '../services/emergencyStopService.js'
import {
  isLiveTradingEnabled,
  normalizePortfolioEnvironment,
  PORTFOLIO_ENVIRONMENTS,
  PORTFOLIO_STATUSES
} from '../services/accountDomainService.js'
import { simulationConfig } from '../services/simulationService.js'
import { computeOwnedPortfolioLots } from '../services/portfolioAccountingService.js'
import { isBrokerFill } from '../services/botAccountingService.js'
import { MARKET_LATENCY_CLASSES } from '../execution/providers/ExecutionProvider.js'

export const AUTHORIZATION_MODES = Object.freeze({
  USER_MANUAL: 'user_manual',
  USER_RULE_MANDATE: 'user_rule_mandate',
  USER_EXPLICIT_PROPOSAL_APPROVAL: 'user_explicit_proposal_approval',
  PAPER_VETO_SIM_ONLY: 'paper_veto_sim_only',
  PLATFORM_SIM_SHOWCASE: 'platform_sim_showcase'
})

export const EXECUTION_TIMINGS = Object.freeze({
  IMMEDIATE: 'immediate',
  NEXT_OPEN: 'next_open',
  SESSION_CLOSE: 'session_close'
})

const VALID_LATENCY_CLASSES = new Set(Object.values(MARKET_LATENCY_CLASSES))
const ACTIVE_ORDER_STATUSES = ['queued', 'processing', 'submitted', 'partially_filled', 'needs_reconciliation']
const DEFAULT_MAX_BROKERAGE_OBSERVATION_AGE_MS = 5 * 60_000

export function buildAuthorizationEnvelope({
  authorizationMode,
  actorUserId,
  botId = null,
  proposalId = null,
  mandatePayload = null,
  authorizedAt = new Date()
}) {
  const mandateHash = mandatePayload
    ? createHash('sha256').update(JSON.stringify(mandatePayload)).digest('hex').slice(0, 24)
    : null
  return {
    authorizationMode,
    actorUserId: String(actorUserId ?? ''),
    botId: botId ? String(botId) : null,
    proposalId: proposalId ? String(proposalId) : null,
    mandateHash,
    authorizedAt: new Date(authorizedAt).toISOString()
  }
}

export function buildMarketObservation({
  symbol,
  price,
  bid = null,
  ask = null,
  observedAt = new Date(),
  asOfSession = null,
  source = 'alpha-engine',
  feed = null,
  latencyClass = MARKET_LATENCY_CLASSES.SESSION_CLOSE
}) {
  return {
    symbol: String(symbol ?? '').toUpperCase(),
    price: Number(price),
    ...(bid != null ? { bid: Number(bid) } : {}),
    ...(ask != null ? { ask: Number(ask) } : {}),
    observedAt: new Date(observedAt).toISOString(),
    asOfSession: asOfSession ?? null,
    source,
    ...(feed ? { feed } : {}),
    latencyClass
  }
}

function validateAuthorizationEnvelope(auth, { userId, portfolioEnv, bot, proposalId }) {
  if (!auth || typeof auth !== 'object' || !auth.authorizationMode) {
    return { ok: false, reason: 'missing_authorization_provenance' }
  }
  const mode = auth.authorizationMode
  if (!Object.values(AUTHORIZATION_MODES).includes(mode)) {
    return { ok: false, reason: `unsupported_authorization_mode:${mode}` }
  }
  if (!auth.actorUserId || auth.actorUserId !== String(userId)) {
    return { ok: false, reason: 'authorization_actor_mismatch' }
  }

  if (mode === AUTHORIZATION_MODES.USER_MANUAL) {
    if (bot) return { ok: false, reason: 'manual_authorization_forbids_bot' }
    return { ok: true }
  }

  if (mode === AUTHORIZATION_MODES.USER_RULE_MANDATE) {
    if (!bot || !bot.enabled || bot.deletedAt) {
      return { ok: false, reason: 'bot_mandate_inactive' }
    }
    return { ok: true }
  }

  if (mode === AUTHORIZATION_MODES.USER_EXPLICIT_PROPOSAL_APPROVAL) {
    if (!proposalId && !auth.proposalId) {
      return { ok: false, reason: 'missing_proposal_approval_reference' }
    }
    return { ok: true }
  }

  if (mode === AUTHORIZATION_MODES.PAPER_VETO_SIM_ONLY) {
    if (portfolioEnv !== PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM) {
      return { ok: false, reason: 'silent_auth_forbidden_outside_sim' }
    }
    return { ok: true }
  }

  if (mode === AUTHORIZATION_MODES.PLATFORM_SIM_SHOWCASE) {
    if (portfolioEnv !== PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM) {
      return { ok: false, reason: 'platform_showcase_restricted_to_sim' }
    }
    return { ok: true }
  }

  return { ok: false, reason: 'authorization_denied' }
}

function validateMarketObservation(obs, { symbol, portfolioEnv, executionTiming, now, maxObservationAgeMs }) {
  if (!obs || typeof obs !== 'object') {
    return { ok: false, reason: 'missing_market_observation' }
  }
  if (String(obs.symbol ?? '').toUpperCase() !== symbol) {
    return { ok: false, reason: 'market_observation_symbol_mismatch' }
  }
  const px = Number(obs.price)
  if (!Number.isFinite(px) || px <= 0) {
    return { ok: false, reason: 'invalid_observation_price' }
  }
  if (!VALID_LATENCY_CLASSES.has(obs.latencyClass)) {
    return { ok: false, reason: `invalid_latency_class:${obs.latencyClass}` }
  }

  // Brokerage environments with immediate intraday timing cannot trade on historical replay data
  // or stale market observations.
  if (portfolioEnv !== PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM && executionTiming === EXECUTION_TIMINGS.IMMEDIATE) {
    if (obs.latencyClass === MARKET_LATENCY_CLASSES.HISTORICAL_REPLAY) {
      return { ok: false, reason: 'historical_data_forbidden_on_brokerage' }
    }
    const observedMs = Date.parse(obs.observedAt ?? '')
    if (!Number.isFinite(observedMs) || now.getTime() - observedMs > maxObservationAgeMs) {
      return { ok: false, reason: 'stale_market_observation' }
    }
  }

  if (
    (executionTiming === EXECUTION_TIMINGS.NEXT_OPEN || executionTiming === EXECUTION_TIMINGS.SESSION_CLOSE) &&
    !/^\d{4}-\d{2}-\d{2}$/.test(String(obs.asOfSession ?? ''))
  ) {
    return { ok: false, reason: 'missing_session_provenance' }
  }

  return { ok: true }
}

/**
 * Computes unreserved cash and owned shares for `portfolio` inside an already-locked transaction `tx`.
 */
async function computePortfolioAvailableResourcesTx(tx, portfolio, { simConfig = simulationConfig() } = {}) {
  const portfolioEnv = normalizePortfolioEnvironment(portfolio)

  const [executions, activeReservations, cashEntries, externalLots] = await Promise.all([
    tx.execution.findMany({
      where: { portfolioId: portfolio.id }
    }),
    typeof tx.portfolioCapitalReservation?.findMany === 'function'
      ? tx.portfolioCapitalReservation.findMany({
          where: { portfolioId: portfolio.id, status: 'active' }
        })
      : [],
    typeof tx.portfolioCashEntry?.findMany === 'function'
      ? tx.portfolioCashEntry.findMany({
          where: {
            portfolioId: portfolio.id,
            entryType: { in: ['external_deposit', 'external_withdrawal', 'dividend', 'adjustment'] }
          }
        }).catch(() => [])
      : [],
    typeof tx.positionLot?.findMany === 'function'
      ? tx.positionLot.findMany({
          where: { portfolioId: portfolio.id, ownerType: 'external_unmanaged', status: 'open' }
        }).catch(() => [])
      : []
  ])

  const reservedExecIds = new Set(activeReservations.map((r) => r.executionId).filter(Boolean))

  // Active cash reservations from PortfolioCapitalReservation + any legacy unreserved active buy orders
  let reservedCashMicros = 0n
  for (const r of activeReservations) {
    if (r.side === 'buy') reservedCashMicros += BigInt(r.reservedCashMicros ?? 0)
  }
  for (const e of executions) {
    if (reservedExecIds.has(e.id)) continue
    if (!ACTIVE_ORDER_STATUSES.includes(e.status)) continue
    if (String(e.direction).toLowerCase() !== 'buy') continue
    const remQtyMicros = toMicros(Math.max(0, Number(e.quantity ?? 0) - Number(e.filledQuantity ?? 0)))
    const pxMicros = toMicros(e.price ?? 0)
    reservedCashMicros += mulMicros(remQtyMicros, pxMicros)
  }

  // Available cash ceiling for internal_sim portfolios (derived deterministically from starting cash + fills + external cash flows)
  let availableCashMicros = null
  if (portfolioEnv === PORTFOLIO_ENVIRONMENTS.INTERNAL_SIM) {
    const rawBalance = Number(portfolio.cashBalance ?? 0)
    const startingCash = rawBalance > 0
      ? rawBalance
      : (simConfig.enabled && Number(simConfig.startingCash) > 0 ? Number(simConfig.startingCash) : 10_000)
    let settledCashMicros = toMicros(startingCash)

    for (const f of executions) {
      if (!isBrokerFill(f)) continue
      const qMicros = toMicros(f.filledQuantity)
      const pMicros = toMicros(f.filledPrice)
      const feeMicros = toMicros(f.fees ?? 0) + toMicros(f.commission ?? 0)
      const grossMicros = mulMicros(qMicros, pMicros)
      const isSell = String(f.direction).toLowerCase() === 'sell'
      settledCashMicros += isSell ? (grossMicros - feeMicros) : -(grossMicros + feeMicros)
    }
    for (const ce of cashEntries) {
      settledCashMicros += BigInt(ce.amountMicros ?? 0)
    }
    availableCashMicros = settledCashMicros - reservedCashMicros
  }

  // Ownership-separated sellable shares minus active sell reservations
  const ownedLots = computeOwnedPortfolioLots({
    executions,
    externalUnmanagedLots: externalLots
  })

  const reservedSellByOwnerSymbol = new Map() // `${ownerType}:${ownerId}:${symbol}` -> BigInt micros
  for (const r of activeReservations) {
    if (r.side !== 'sell') continue
    const key = `${r.ownerType}:${r.ownerId}:${String(r.symbol).toUpperCase()}`
    reservedSellByOwnerSymbol.set(key, (reservedSellByOwnerSymbol.get(key) ?? 0n) + BigInt(r.reservedQtyMicros ?? 0))
  }
  for (const e of executions) {
    if (reservedExecIds.has(e.id)) continue
    if (!ACTIVE_ORDER_STATUSES.includes(e.status)) continue
    if (String(e.direction).toLowerCase() !== 'sell') continue
    const ownerType = e.botId ? 'bot' : 'manual_platform'
    const ownerId = e.botId ? String(e.botId) : String(e.userId)
    const key = `${ownerType}:${ownerId}:${String(e.ticker).toUpperCase()}`
    const remMicros = toMicros(Math.max(0, Number(e.quantity ?? 0) - Number(e.filledQuantity ?? 0)))
    reservedSellByOwnerSymbol.set(key, (reservedSellByOwnerSymbol.get(key) ?? 0n) + remMicros)
  }

  return {
    portfolioEnv,
    availableCashMicros,
    reservedCashMicros,
    ownedLots,
    reservedSellByOwnerSymbol
  }
}

/**
 * Evaluates a UnifiedTradeIntent inside transaction `tx` (acquiring an exclusive row lock on `Portfolio`)
 * and atomically inserts `TradeIntentRecord` + `PortfolioCapitalReservation` when approved.
 */
export async function evaluateAndReserveTradeIntentTx(
  tx,
  {
    intentId = `int_${randomUUID()}`,
    executionId = null,
    userId,
    portfolioId,
    botId = null,
    proposalId = null,
    preloadedPortfolio = null,
    preloadedBot = null,
    symbol,
    side,
    quantity,
    referencePrice,
    executionTiming = EXECUTION_TIMINGS.IMMEDIATE,
    authorization,
    marketObservation,
    brokerAvailableCash = null,
    now = new Date(),
    maxObservationAgeMs = DEFAULT_MAX_BROKERAGE_OBSERVATION_AGE_MS,
    env = process.env
  }
) {
  const cleanSymbol = String(symbol ?? '').trim().toUpperCase()
  const cleanSide = String(side ?? '').trim().toLowerCase()
  const qtyMicros = toMicros(quantity ?? 0)
  const pxMicros = toMicros(referencePrice ?? 0)
  const notionalMicros = qtyMicros > 0n && pxMicros > 0n ? mulMicros(qtyMicros, pxMicros) : 0n

  const recordOutcome = async (allowed, reason, details = {}) => {
    const decisionPayload = {
      allowed,
      reason,
      evaluatedAt: new Date(now).toISOString(),
      ...details
    }
    let intentRecord = null
    if (typeof tx?.tradeIntentRecord?.create === 'function') {
      intentRecord = await tx.tradeIntentRecord.create({
        data: {
          id: intentId,
          userId: String(userId ?? ''),
          portfolioId: String(portfolioId ?? ''),
          botId: botId ? String(botId) : null,
          proposalId: proposalId ? String(proposalId) : null,
          symbol: cleanSymbol || 'UNKNOWN',
          side: cleanSide || 'unknown',
          quantityMicros: qtyMicros,
          referencePriceMicros: pxMicros,
          notionalMicros,
          executionTiming,
          authorization: authorization ?? {},
          marketObservation: marketObservation ?? {},
          policyDecision: decisionPayload,
          status: allowed ? 'approved' : 'rejected',
          rejectionReason: allowed ? null : String(reason).slice(0, 190),
          executionId: allowed && executionId ? String(executionId) : null
        }
      })
    }
    return { allowed, reason, intentId, intentRecord, decision: decisionPayload }
  }

  if (!cleanSymbol || (cleanSide !== 'buy' && cleanSide !== 'sell') || qtyMicros <= 0n || pxMicros <= 0n) {
    return recordOutcome(false, 'invalid_intent_parameters')
  }

  // Serialize concurrent capital/lot allocation on this exact Portfolio row
  if (typeof tx.$queryRaw === 'function') {
    await tx.$queryRaw`SELECT id FROM Portfolio WHERE id = ${String(portfolioId)} FOR UPDATE`
  }

  const [user, portfolio, bot] = await Promise.all([
    tx.user?.findUnique ? tx.user.findUnique({ where: { id: String(userId) } }) : null,
    tx.portfolio?.findUnique ? tx.portfolio.findUnique({ where: { id: String(portfolioId) } }) : preloadedPortfolio,
    botId ? (tx.bot?.findUnique ? tx.bot.findUnique({ where: { id: String(botId) } }) : preloadedBot) : null
  ])

  if (!user) return recordOutcome(false, 'unknown_user')
  if (readEmergencyStop(user.riskSettings).active) {
    return recordOutcome(false, 'emergency_stop_active')
  }
  if (!portfolio || portfolio.userId !== String(userId)) {
    return recordOutcome(false, 'portfolio_owner_mismatch')
  }
  if (portfolio.status && portfolio.status !== PORTFOLIO_STATUSES.ACTIVE) {
    return recordOutcome(false, `portfolio_not_active:${portfolio.status}`)
  }

  const portfolioEnv = normalizePortfolioEnvironment(portfolio)
  if (portfolioEnv === PORTFOLIO_ENVIRONMENTS.ALPACA_LIVE && !isLiveTradingEnabled(env)) {
    return recordOutcome(false, 'live_execution_disabled')
  }

  if (botId) {
    if (!bot || bot.userId !== String(userId) || bot.portfolioId !== portfolio.id) {
      return recordOutcome(false, 'bot_portfolio_mismatch')
    }
  }

  // 2. Authorization Provenance Gate
  const authCheck = validateAuthorizationEnvelope(authorization, {
    userId,
    portfolioEnv,
    bot,
    proposalId
  })
  if (!authCheck.ok) {
    return recordOutcome(false, authCheck.reason)
  }

  // 3. Market-Data Provenance Gate
  const obsCheck = validateMarketObservation(marketObservation, {
    symbol: cleanSymbol,
    portfolioEnv,
    executionTiming,
    now: new Date(now),
    maxObservationAgeMs
  })
  if (!obsCheck.ok) {
    return recordOutcome(false, obsCheck.reason)
  }

  // 4. Atomic Portfolio Capital & Owned-Lot Reservation Check
  const resources = await computePortfolioAvailableResourcesTx(tx, portfolio)
  const ownerType = botId ? 'bot' : 'manual_platform'
  const ownerId = botId ? String(botId) : String(userId)

  if (cleanSide === 'buy') {
    const effectiveAvailableMicros = brokerAvailableCash != null
      ? toMicros(brokerAvailableCash) - resources.reservedCashMicros
      : resources.availableCashMicros

    if (effectiveAvailableMicros !== null && notionalMicros > effectiveAvailableMicros) {
      return recordOutcome(false, 'insufficient_unreserved_portfolio_cash', {
        attemptedDollars: microsToDollars(notionalMicros),
        availableAfterReservationsDollars: microsToDollars(effectiveAvailableMicros),
        reservedCashDollars: microsToDollars(resources.reservedCashMicros)
      })
    }

    if (bot?.config) {
      const maxOrder = Number(bot.config.maxOrderNotional)
      if (Number.isFinite(maxOrder) && maxOrder > 0 && notionalMicros > toMicros(maxOrder)) {
        return recordOutcome(false, 'bot_max_order_notional_exceeded', {
          attemptedDollars: microsToDollars(notionalMicros),
          maxOrderNotional: maxOrder
        })
      }
    }
  } else {
    // SELL: strictly bounded to unreserved shares owned by THIS actor (never external_unmanaged!)
    const bucketKey = `${ownerType}:${ownerId}`
    const ownedPos = resources.ownedLots.buckets[bucketKey]?.openPositions?.[cleanSymbol]
    const ownedQtyMicros = toMicros(ownedPos?.quantity ?? 0)
    const reservedQtyMicros = resources.reservedSellByOwnerSymbol.get(`${ownerType}:${ownerId}:${cleanSymbol}`) ?? 0n
    const unreservedOwnedMicros = ownedQtyMicros - reservedQtyMicros

    if (qtyMicros > unreservedOwnedMicros) {
      return recordOutcome(false, 'sell_exceeds_unreserved_attributable_lots', {
        attemptedQty: microsTo4Decimals(qtyMicros),
        unreservedOwnedQty: microsTo4Decimals(unreservedOwnedMicros > 0n ? unreservedOwnedMicros : 0n)
      })
    }
  }

  // 5. Persist TradeIntentRecord + Active PortfolioCapitalReservation atomically
  const approved = await recordOutcome(true, 'policy_approved_and_reserved', {
    portfolioEnvironment: portfolioEnv,
    reservedCashDollars: cleanSide === 'buy' ? microsToDollars(notionalMicros) : 0,
    reservedQty: cleanSide === 'sell' ? microsTo4Decimals(qtyMicros) : 0
  })

  let reservation = null
  if (typeof tx?.portfolioCapitalReservation?.create === 'function') {
    reservation = await tx.portfolioCapitalReservation.create({
      data: {
        id: `rsv_${randomUUID()}`,
        portfolioId: portfolio.id,
        userId: String(userId),
        intentId,
        executionId: executionId ? String(executionId) : null,
        ownerType,
        ownerId,
        side: cleanSide,
        symbol: cleanSymbol,
        reservedCashMicros: cleanSide === 'buy' ? notionalMicros : 0n,
        reservedQtyMicros: cleanSide === 'sell' ? qtyMicros : 0n,
        status: 'active'
      }
    })
  }

  return {
    ...approved,
    reservation
  }
}

/**
 * Atomically transitions an execution's active `PortfolioCapitalReservation` to `settled` (on fill)
 * or `released` (on cancel / refusal / failure). Safe when called inside or outside a transaction.
 */
export async function finalizeReservationForExecution(
  dbClient,
  { executionId, status, reason = null }
) {
  if (!executionId || typeof dbClient?.portfolioCapitalReservation?.updateMany !== 'function') {
    return 0
  }
  const nextStatus = status === 'filled' ? 'settled' : 'released'
  const res = await dbClient.portfolioCapitalReservation.updateMany({
    where: { executionId: String(executionId), status: 'active' },
    data: {
      status: nextStatus,
      releasedReason: reason ? String(reason).slice(0, 120) : nextStatus
    }
  })
  return res.count
}
