import os from 'os'
import { randomUUID } from 'crypto'
import prisma from '../db/prisma.js'
import { BrokerNetworkError, BrokerRejectionError } from '../broker/alpacaClient.js'
import { getBrokerClient } from '../broker/clientCache.js'
import { recordExecutionAudit } from '../audit/executionAudit.js'
import { evaluateOrderEligibility } from '../risk/orderEligibility.js'
import { BROKER_OPEN_STATUSES, PENDING_BROKER_STATUSES, TERMINAL_BROKER_STATUSES } from './executionStatus.js'
import { log } from '../logger.js'
import metricsService from '../../../server/src/services/metricsService.js'
import { calculateFillPnl } from '../../../server/src/services/botAccountingService.js'

/**
 * Order lifecycle (paper broker).
 *
 * Invariants:
 * - One writer per execution: every write after a claim is fenced on lockedBy = this worker,
 *   and is committed together with its audit event.
 * - A broker submit happens at most once per clientOrderId attempt window: submitAttemptedAt is
 *   persisted before submitting; an unknown outcome moves the row to `needs_reconciliation`,
 *   which is only ever resolved by broker lookup. Any resubmit reuses the same clientOrderId,
 *   which the broker de-duplicates.
 * - Retry limits apply only to work the broker has never seen. An order known to the broker is
 *   never marked failed locally; it is reconciled until the broker reports a final state.
 */

export const WORKER_ID = `${os.hostname()}-${process.pid}`

export const orderWorkerConfig = {
  maxAttempts: 3,
  pollIdleMs: 500,
  stuckAfterMs: 120_000,          // a lock older than this belongs to a dead/stalled worker
  fillPollIntervalMs: 2_000,
  fillTimeoutMs: 30_000,          // then release; the reconciliation sweep continues
  reconcileIntervalMs: 15_000,    // min gap between broker lookups for an open order
  notFoundGraceMs: 60_000,        // a submit not visible at the broker after this is presumed not received
  cancelPollMs: 10_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
}

class LeaseLostError extends Error {
  constructor(executionId) {
    super(`lease lost for execution ${executionId}`)
    this.name = 'LeaseLostError'
  }
}

let running = false
let inflightMap = null
export function setInflightMap(map) { inflightMap = map }

export async function startOrderWorker() {
  running = true
  log.info({ workerId: WORKER_ID }, 'order_worker_start')
  const recoveryInterval = setInterval(() => recoverStuckJobs().catch((err) => log.error({ err: err.message }, 'recover_stuck_failed')), 60_000)
  await recoverStuckJobs()

  while (running) {
    const worked = await runOnce()
    if (!worked) await orderWorkerConfig.sleep(orderWorkerConfig.pollIdleMs)
  }
  clearInterval(recoveryInterval)
}

export function stopOrderWorker() {
  running = false
}

/** One unit of work: new submission first, otherwise one reconciliation. Returns true if it did work. */
export async function runOnce() {
  const job = await claimNextExecution()
  if (job) {
    await processExecution(job)
    return true
  }
  const open = await claimNextReconciliation()
  if (open) {
    await reconcileExecution(open)
    return true
  }
  return false
}

// ─── Claims (atomic: conditional updateMany; count 0 = another worker won) ────

export async function claimNextExecution() {
  const job = await prisma.execution.findFirst({
    where: { status: 'queued', lockedAt: null },
    orderBy: { createdAt: 'asc' }
  })
  if (!job) return null
  const claimed = await prisma.execution.updateMany({
    where: { id: job.id, status: 'queued', lockedAt: null },
    data: { status: 'processing', lockedAt: orderWorkerConfig.now(), lockedBy: WORKER_ID, attempts: { increment: 1 } }
  })
  return claimed.count === 0 ? null : prisma.execution.findUnique({ where: { id: job.id } })
}

export async function claimNextReconciliation() {
  const now = orderWorkerConfig.now()
  const due = new Date(now.getTime() - orderWorkerConfig.reconcileIntervalMs)
  const job = await prisma.execution.findFirst({
    where: {
      status: { in: BROKER_OPEN_STATUSES },
      lockedAt: null,
      OR: [{ lastBrokerSyncAt: null }, { lastBrokerSyncAt: { lt: due } }]
    },
    // Least-recently checked first (never-checked first) so every open order gets a turn.
    orderBy: [{ lastBrokerSyncAt: 'asc' }, { createdAt: 'asc' }]
  })
  if (!job) return null
  const claimed = await prisma.execution.updateMany({
    where: { id: job.id, status: job.status, lockedAt: null },
    data: { lockedAt: now, lockedBy: WORKER_ID, lastBrokerSyncAt: now }
  })
  return claimed.count === 0 ? null : prisma.execution.findUnique({ where: { id: job.id } })
}

// ─── Fenced state transitions (state change + audit in one transaction) ───────

async function transition(execution, data, audit = null) {
  await prisma.$transaction(async (tx) => {
    const res = await tx.execution.updateMany({ where: { id: execution.id, lockedBy: WORKER_ID }, data })
    if (res.count === 0) throw new LeaseLostError(execution.id)
    if (audit) {
      await tx.executionAudit.create({
        data: {
          id: `aud_${randomUUID()}`,
          executionId: execution.id,
          userId: execution.userId,
          workerId: WORKER_ID,
          eventType: audit.eventType,
          detail: audit.detail,
          metadata: audit.metadata ?? null
        }
      })
    }
  })
}

function auditFor(eventType, detail, metadata) {
  return { eventType, detail, metadata }
}

// ─── New work ─────────────────────────────────────────────────────────────────

export async function processExecution(execution) {
  log.info({ executionId: execution.id, botId: execution.botId, userId: execution.userId, ticker: execution.ticker, direction: execution.direction, qty: execution.quantity }, 'order_claimed')
  await recordExecutionAudit({ executionId: execution.id, userId: execution.userId, workerId: WORKER_ID, eventType: 'claimed', detail: `Execution claimed by ${WORKER_ID}`, metadata: { attempts: execution.attempts ?? 0 } })

  try {
    // Anything that may already be at the broker is reconciled, never resubmitted blindly.
    if (execution.brokerOrderId || execution.submittedAt || execution.submitAttemptedAt) {
      await reconcileExecution(execution)
      return
    }

    const broker = await getBrokerClient(execution.userId)
    if (!broker) {
      await refuse(execution, 'invalid_credentials', { detail: 'No usable broker credentials for this user' })
      return
    }

    if (execution.cancelRequestedAt) {
      await handleCancelRequested(execution, broker)
      return
    }

    // Safety net: an order with this clientOrderId already at the broker is adopted, not duplicated.
    const existing = await broker.getOrderByClientOrderId(execution.clientOrderId)
    if (existing) {
      await applyBrokerSnapshot(execution, existing, auditFor('reconciled', 'Existing broker order found by clientOrderId before submit', { brokerOrderId: existing.alpacaOrderId, brokerStatus: existing.status }))
      await followOrder({ ...execution, brokerOrderId: existing.alpacaOrderId }, broker, existing)
      return
    }

    const decision = await evaluateOrderEligibility(execution, { broker, now: orderWorkerConfig.now() })
    if (!decision.allowed) {
      await refuse(execution, decision.reason, decision.metrics)
      return
    }

    const clock = await broker.getClock()
    if (!clock?.is_open) {
      await finalize(execution, 'cancelled', 'market_closed_at_submission')
      return
    }

    const latest = await prisma.execution.findUnique({ where: { id: execution.id }, select: { cancelRequestedAt: true } })
    if (latest?.cancelRequestedAt) {
      await handleCancelRequested({ ...execution, cancelRequestedAt: latest.cancelRequestedAt }, broker)
      return
    }

    // Durable marker BEFORE the broker call: from here on the outcome may be unknown.
    const attemptedAt = orderWorkerConfig.now()
    await transition(execution, { submitAttemptedAt: attemptedAt }, auditFor('submit_attempted', 'Submitting order to broker', {
      ticker: execution.ticker, direction: execution.direction, quantity: execution.quantity, clientOrderId: execution.clientOrderId
    }))

    let order
    try {
      order = await broker.submitOrder({ ticker: execution.ticker, side: execution.direction, qty: execution.quantity, type: 'market', clientOrderId: execution.clientOrderId })
    } catch (err) {
      if (err instanceof BrokerRejectionError && isDuplicateClientOrderId(err)) {
        await reconcileExecution({ ...execution, submitAttemptedAt: attemptedAt })
        return
      }
      if (err instanceof BrokerRejectionError) {
        // A 4xx is a definitive "not accepted".
        await finalize(execution, 'cancelled', err.credentialError ? 'invalid_credentials' : `broker_rejected:${err.reason}`, {}, { refusal: err.credentialError })
        return
      }
      // Lost response / timeout: the broker may have the order. Reconcile, never resubmit blindly.
      await transition(execution, { status: 'needs_reconciliation', lockedAt: null, lockedBy: null },
        auditFor('reconcile_required', 'Submit outcome unknown; will reconcile by clientOrderId', { error: err?.message ?? String(err), clientOrderId: execution.clientOrderId }))
      return
    }

    await applyBrokerSnapshot(execution, order, auditFor('submit_confirmed', 'Broker accepted order', { brokerOrderId: order.alpacaOrderId, brokerStatus: order.status }))
    await followOrder({ ...execution, brokerOrderId: order.alpacaOrderId, submitAttemptedAt: attemptedAt }, broker, order)
  } catch (err) {
    await handleUnexpected(execution, err)
  }
}

async function handleUnexpected(execution, err) {
  if (err instanceof LeaseLostError) {
    log.warn({ executionId: execution.id, workerId: WORKER_ID }, 'lease_lost')
    await recordExecutionAudit({ executionId: execution.id, userId: execution.userId, workerId: WORKER_ID, eventType: 'lease_lost', detail: 'Another worker owns this execution; stopped without writing' })
    return
  }
  const fresh = await prisma.execution.findUnique({ where: { id: execution.id } })
  if (!fresh || fresh.lockedBy !== WORKER_ID) return
  if (fresh.submitAttemptedAt || fresh.brokerOrderId) {
    // Possibly at the broker: hand to reconciliation, keeping the broker-facing status.
    await transition(fresh, {
      status: fresh.brokerOrderId ? fresh.status === 'processing' ? 'submitted' : fresh.status : 'needs_reconciliation',
      lockedAt: null,
      lockedBy: null
    }, auditFor('reconcile_required', 'Error after submit; will reconcile', { error: err?.message ?? String(err) })).catch(() => {})
    return
  }
  if (err instanceof BrokerRejectionError && err.credentialError) {
    // Nothing was sent; this user's credentials are unusable. Refuse (other users are unaffected).
    await refuse(fresh, 'invalid_credentials', { broker: err.reason })
    return
  }
  log.error({ err: err?.message ?? String(err), executionId: execution.id }, 'order_pre_submit_error')
  await releaseForRetry(fresh, err)
}

async function releaseForRetry(execution, err) {
  const attempts = execution.attempts ?? 1
  if (attempts >= orderWorkerConfig.maxAttempts) {
    await finalize(execution, 'failed', 'max_attempts_exceeded', {}, { error: err?.message })
    return
  }
  await transition(execution, { status: 'queued', lockedAt: null, lockedBy: null },
    auditFor('retry_scheduled', 'Released for retry (nothing was sent to the broker)', { attempts, maxAttempts: orderWorkerConfig.maxAttempts, error: err?.message ?? null }))
}

// ─── Reconciliation (restart recovery, unknown outcomes, open orders) ─────────

export async function reconcileExecution(execution) {
  try {
    const broker = await getBrokerClient(execution.userId)
    if (!broker) {
      // Cannot verify. Never assume failure for something that may be at the broker.
      await releaseOpen(execution)
      return
    }

    let order
    try {
      order = await fetchKnownOrder(execution, broker)
    } catch (err) {
      if (err instanceof BrokerNetworkError || err instanceof BrokerRejectionError) {
        await releaseOpen(execution)
        return
      }
      throw err
    }

    if (!order) {
      await handleNotFound(execution)
      return
    }

    if (execution.cancelRequestedAt && !isFinal(order) ) {
      await handleCancelRequested({ ...execution, brokerOrderId: order.alpacaOrderId }, broker)
      return
    }

    const known = { ...execution, brokerOrderId: order.alpacaOrderId }
    // A final broker state is recorded once, by the terminal transition itself.
    if (await settleIfFinal(known, order)) return
    await applyBrokerSnapshot(execution, order, statusChanged(execution, order)
      ? auditFor(order.status === 'partially_filled' ? 'partial_fill' : 'reconciled', 'Reconciled against broker order', { brokerOrderId: order.alpacaOrderId, brokerStatus: order.status, filledQuantity: order.filledQty })
      : null)
    await releaseOpen(execution)
  } catch (err) {
    if (err instanceof LeaseLostError) return handleUnexpected(execution, err)
    log.error({ err: err?.message ?? String(err), executionId: execution.id }, 'reconcile_error')
    await releaseOpen(execution).catch(() => {})
  }
}

async function handleNotFound(execution) {
  const submitted = execution.brokerOrderId || execution.submittedAt
  if (submitted) {
    // The broker acknowledged this order before; a miss now is an anomaly, not proof of absence.
    await releaseOpen(execution)
    return
  }
  const attemptedAt = execution.submitAttemptedAt ? new Date(execution.submitAttemptedAt).getTime() : null
  if (attemptedAt && orderWorkerConfig.now().getTime() - attemptedAt < orderWorkerConfig.notFoundGraceMs) {
    await releaseOpen(execution) // too early to conclude
    return
  }
  if (execution.cancelRequestedAt) {
    await finalize(execution, 'cancelled', 'cancelled_before_broker_ack')
    return
  }
  // Never reached the broker. Safe to try again with the SAME clientOrderId (broker de-duplicates).
  if ((execution.attempts ?? 1) >= orderWorkerConfig.maxAttempts) {
    await finalize(execution, 'failed', 'not_received_by_broker')
    return
  }
  await transition(execution, { status: 'queued', submitAttemptedAt: null, lockedAt: null, lockedBy: null },
    auditFor('retry_scheduled', 'Submit not received by broker; resubmitting with the same clientOrderId', { clientOrderId: execution.clientOrderId, attempts: execution.attempts ?? 1 }))
}

/** Release the lock without changing broker-facing status (open or unknown orders). */
async function releaseOpen(execution) {
  await transition(execution, { lockedAt: null, lockedBy: null })
}

export async function recoverStuckJobs() {
  const stuckBefore = new Date(orderWorkerConfig.now().getTime() - orderWorkerConfig.stuckAfterMs)
  const stuck = await prisma.execution.findMany({
    where: { status: { in: ['processing', ...BROKER_OPEN_STATUSES] }, lockedAt: { lt: stuckBefore } }
  })
  let recovered = 0
  for (const row of stuck) {
    const next = row.status !== 'processing'
      ? row.status
      : row.brokerOrderId ? 'submitted'
        : row.submitAttemptedAt ? 'needs_reconciliation'
          : 'queued'
    await prisma.$transaction(async (tx) => {
      const res = await tx.execution.updateMany({
        where: { id: row.id, lockedBy: row.lockedBy, lockedAt: { lt: stuckBefore } },
        data: { status: next, lockedAt: null, lockedBy: null }
      })
      if (res.count === 0) return
      recovered += 1
      if (next !== row.status) {
        await tx.executionAudit.create({
          data: {
            id: `aud_${randomUUID()}`, executionId: row.id, userId: row.userId, workerId: WORKER_ID,
            eventType: next === 'queued' ? 'retry_scheduled' : 'reconcile_required',
            detail: `Recovered from stalled worker ${row.lockedBy ?? 'unknown'} (${row.status} -> ${next})`,
            metadata: { previousStatus: row.status, previousWorker: row.lockedBy }
          }
        })
      }
    })
  }
  if (recovered > 0) log.warn({ count: recovered }, 'stuck_jobs_recovered')
  return recovered
}

// ─── Following an order at the broker ─────────────────────────────────────────

async function followOrder(execution, broker, order, { poll = true } = {}) {
  if (await settleIfFinal(execution, order)) return
  if (!poll) {
    await releaseOpen(execution)
    return
  }

  const deadline = Date.now() + orderWorkerConfig.fillTimeoutMs
  let last = order
  while (Date.now() < deadline) {
    await orderWorkerConfig.sleep(orderWorkerConfig.fillPollIntervalMs)
    // Renew the lease (fenced) and pick up cancel requests.
    await transition(execution, { lockedAt: orderWorkerConfig.now() })
    const latest = await prisma.execution.findUnique({ where: { id: execution.id }, select: { cancelRequestedAt: true } })
    if (latest?.cancelRequestedAt) {
      await handleCancelRequested({ ...execution, cancelRequestedAt: latest.cancelRequestedAt }, broker)
      return
    }
    let snapshot
    try {
      snapshot = await fetchKnownOrder(execution, broker)
    } catch (err) {
      if (err instanceof BrokerNetworkError) break
      throw err
    }
    if (!snapshot) break
    if (statusChanged(last, snapshot)) {
      await applyBrokerSnapshot(execution, snapshot, snapshot.status === 'partially_filled'
        ? auditFor('partial_fill', 'Order partially filled', { brokerOrderId: snapshot.alpacaOrderId, filledQuantity: snapshot.filledQty, filledPrice: snapshot.filledAvgPrice })
        : null)
    }
    last = snapshot
    if (await settleIfFinal(execution, snapshot)) return
  }
  // Still open: keep broker-facing status; the reconciliation sweep continues. Never a local failure.
  await releaseOpen(execution)
}

async function settleIfFinal(execution, order) {
  if (order.status === 'filled') {
    if (!(order.filledQty > 0 && order.filledAvgPrice > 0)) return false // inconsistent snapshot; check again later
    await finalize(execution, 'filled', null, await fillDataFrom(execution, order))
    return true
  }
  if (TERMINAL_BROKER_STATUSES.has(order.status)) {
    // A canceled/expired/rejected order keeps any real partial fill.
    const reason = execution.cancelRequestedAt && order.status === 'canceled' ? 'broker_cancelled_after_user_request' : `broker_status:${order.status}`
    await finalize(execution, 'cancelled', reason, order.filledQty > 0 ? await fillDataFrom(execution, order) : { brokerStatus: order.status, filledQuantity: 0 })
    return true
  }
  return false
}

async function fillDataFrom(execution, order) {
  let pnl = 0
  if (String(execution.direction).toLowerCase() === 'sell' && execution.botId && order.filledQty > 0 && order.filledAvgPrice > 0) {
    try {
      pnl = await calculateFillPnl({ execution, fillPrice: order.filledAvgPrice, fillQty: order.filledQty })
    } catch (err) {
      log.warn({ err: err.message, executionId: execution.id }, 'calculate_fill_pnl_failed')
    }
  }
  return {
    brokerStatus: order.status,
    filledPrice: order.filledAvgPrice ?? null,
    filledQuantity: order.filledQty ?? 0,
    filledAt: order.filledAt ?? (order.filledQty > 0 ? orderWorkerConfig.now() : null),
    pnl
  }
}

async function handleCancelRequested(execution, broker) {
  if (!execution.brokerOrderId && !execution.submittedAt && !execution.submitAttemptedAt) {
    await finalize(execution, 'cancelled', execution.cancelRequestReason === 'emergency_stop' ? 'emergency_stop_pre_submit' : 'user_cancel_requested_pre_submit')
    return
  }
  let order
  try {
    order = await fetchKnownOrder(execution, broker)
  } catch (err) {
    if (err instanceof BrokerNetworkError) return releaseOpen(execution)
    throw err
  }
  if (!order) return handleNotFound(execution)
  if (await settleIfFinal(execution, order)) return

  try {
    await broker.cancelOrder(order.alpacaOrderId)
  } catch (err) {
    if (err instanceof BrokerNetworkError) return releaseOpen(execution)
    // Other errors: fall through and reconcile to the broker's truth.
  }

  const deadline = Date.now() + orderWorkerConfig.cancelPollMs
  while (Date.now() < deadline) {
    let snapshot
    try {
      snapshot = await fetchKnownOrder({ ...execution, brokerOrderId: order.alpacaOrderId }, broker)
    } catch (err) {
      if (err instanceof BrokerNetworkError) break
      throw err
    }
    if (!snapshot) break
    if (await settleIfFinal({ ...execution, cancelRequestedAt: execution.cancelRequestedAt ?? orderWorkerConfig.now() }, snapshot)) return
    await applyBrokerSnapshot(execution, snapshot, null)
    await orderWorkerConfig.sleep(Math.min(1_000, orderWorkerConfig.fillPollIntervalMs))
  }
  await releaseOpen(execution)
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

async function applyBrokerSnapshot(execution, order, audit) {
  const now = orderWorkerConfig.now()
  await transition(execution, {
    brokerOrderId: order.alpacaOrderId ?? undefined,
    brokerStatus: order.status,
    submittedAt: order.submittedAt ?? execution.submittedAt ?? now,
    lastBrokerSyncAt: now,
    lockedAt: now,
    status: order.status === 'partially_filled' ? 'partially_filled' : 'submitted',
    // Cumulative broker values: overwriting (never adding) keeps repeated updates idempotent.
    ...(order.filledQty > 0 ? { filledQuantity: order.filledQty } : {}),
    ...(order.filledAvgPrice > 0 ? { filledPrice: order.filledAvgPrice } : {})
  }, audit)
}

/** Records a refusal: nothing is sent to the broker. */
async function refuse(execution, reason, metrics = {}) {
  log.warn({ executionId: execution.id, botId: execution.botId, reason }, 'order_refused')
  await finalize(execution, 'cancelled', `refused:${reason}`, {}, { refusal: true, metrics })
}

async function finalize(execution, status, cancelReason, fillData = {}, { refusal = false, metrics = undefined, error = undefined } = {}) {
  const eventType = refusal ? 'risk_blocked' : status === 'filled' ? 'filled' : status === 'failed' ? 'failed' : 'cancelled'
  await transition(execution, {
    status,
    lockedAt: null,
    lockedBy: null,
    activeIntentKey: null,
    ...(cancelReason ? { cancelReason } : {}),
    ...fillData
  }, auditFor(eventType, `${status}${cancelReason ? ` (${cancelReason})` : ''}`, { cancelReason, ...fillData, ...(metrics ? { metrics } : {}), ...(error ? { error } : {}) }))

  if (refusal && execution.botId) await recordBotRefusal(execution, cancelReason, metrics)

  if (status === 'filled') {
    try {
      const updated = await prisma.execution.findUnique({ where: { id: execution.id } })
      await metricsService.processExecutionFill(updated)
    } catch (err) {
      log.error({ executionId: execution.id, error: err.message }, 'metrics_processing_failed')
    }
  }
  if (execution.botId && inflightMap) inflightMap.delete(`${execution.botId}:${execution.ticker}`)
  const level = status === 'filled' ? 'info' : status === 'failed' ? 'error' : 'warn'
  log[level]({ executionId: execution.id, ticker: execution.ticker, status, cancelReason, filledQuantity: fillData.filledQuantity }, `order_${status}`)
}

async function recordBotRefusal(execution, reason, metrics) {
  try {
    await prisma.botEvent.create({
      data: {
        id: `evt_${randomUUID()}`,
        botId: execution.botId,
        portfolioId: execution.portfolioId,
        executionId: execution.id,
        type: 'execution_blocked_by_risk',
        detail: `Order refused at submission: ${reason}`,
        metadata: { ticker: execution.ticker, reason: String(reason).replace(/^refused:/, ''), executionId: execution.id, side: execution.direction, ...(metrics ?? {}) }
      }
    })
  } catch (err) {
    log.error({ err: err.message, executionId: execution.id }, 'bot_refusal_event_failed')
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

async function fetchKnownOrder(execution, broker) {
  if (execution.brokerOrderId) return broker.getOrder(execution.brokerOrderId)
  if (execution.clientOrderId) return broker.getOrderByClientOrderId(execution.clientOrderId)
  return null
}

function isFinal(order) {
  return order.status === 'filled' || TERMINAL_BROKER_STATUSES.has(order.status)
}

function statusChanged(a, order) {
  const prevStatus = a?.brokerStatus ?? a?.status ?? null
  const prevQty = Number(a?.filledQuantity ?? a?.filledQty ?? 0)
  return prevStatus !== order.status || prevQty !== Number(order.filledQty ?? 0)
}

function isDuplicateClientOrderId(err) {
  const message = `${err?.message ?? ''} ${err?.reason ?? ''}`.toLowerCase()
  return message.includes('client_order_id') || message.includes('client order id')
}

export { PENDING_BROKER_STATUSES }
