import os from 'os'
import prisma from '../db/prisma.js'
import { BrokerNetworkError, BrokerRejectionError } from '../broker/alpacaClient.js'
import { getBrokerClient } from '../broker/clientCache.js'
import { recordExecutionAudit } from '../audit/executionAudit.js'
import { evaluateRiskCaps } from '../risk/riskCaps.js'
import { log } from '../logger.js'
import metricsService from '../../../server/src/services/metricsService.js'

const WORKER_ID      = `${os.hostname()}-${process.pid}`
const MAX_ATTEMPTS   = 3
const POLL_IDLE_MS   = 500   // sleep when no jobs are queued
const STUCK_AFTER_MS = 120_000 // 2 minutes — locked row is considered stuck
const FILL_POLL_INTERVAL_MS = 2_000  // how often to poll Alpaca for fill status
const FILL_TIMEOUT_MS       = 30_000 // give up waiting for fill after 30s

// Hoisted outside polling loops to avoid per-iteration array allocation
const TERMINAL_BROKER_STATUSES  = new Set(['canceled', 'rejected', 'expired'])
const PENDING_BROKER_STATUSES   = new Set(['new', 'accepted', 'pending_new', 'accepted_for_bidding', 'pending_replace', 'replaced', 'calculated'])

let running = false

// Called by the bot engine to clear the inflight guard when an order finishes
let inflightMap = null
export function setInflightMap(map) { inflightMap = map }

export async function startOrderWorker() {
  running = true
  log.info({ workerId: WORKER_ID }, 'order_worker_start')

  // Run stuck-job recovery in the background every 60s
  const recoveryInterval = setInterval(recoverStuckJobs, 60_000)
  recoverStuckJobs() // run once immediately on startup

  while (running) {
    const job = await claimNextExecution()
    if (!job) {
      await sleep(POLL_IDLE_MS)
      continue
    }
    // Job found — process immediately, no sleep
    await processExecution(job)
  }

  clearInterval(recoveryInterval)
}

export function stopOrderWorker() {
  running = false
}

// ─── Claim ──────────────────────────────────────────────────────────────────

async function claimNextExecution() {
  // Step 1 — find oldest unclaimed queued job
  const job = await prisma.execution.findFirst({
    where: { status: 'queued', lockedAt: null },
    orderBy: { createdAt: 'asc' }
  })
  if (!job) return null

  // Step 2 — atomic claim via updateMany with same WHERE predicate
  // If another worker claimed it between step 1 and step 2, count = 0
  const claimed = await prisma.execution.updateMany({
    where: { id: job.id, status: 'queued', lockedAt: null },
    data: {
      status:   'processing',
      lockedAt: new Date(),
      lockedBy: WORKER_ID,
      attempts: { increment: 1 }
    }
  })

  if (claimed.count === 0) return null // lost the race
  return job
}

// ─── Process ─────────────────────────────────────────────────────────────────

async function processExecution(job) {
  // Reload to get the updated fields after the claim write
  const execution = await prisma.execution.findUnique({ where: { id: job.id } })
  log.info({
    executionId: execution.id,
    botId: execution.botId,
    userId: execution.userId,
    ticker: execution.ticker,
    direction: execution.direction,
    qty: execution.quantity
  }, 'order_claimed')
  await recordExecutionAudit({
    executionId: execution.id,
    userId: execution.userId,
    workerId: WORKER_ID,
    eventType: 'claimed',
    detail: `Execution claimed by ${WORKER_ID}`,
    metadata: {
      attempts: execution.attempts ?? 0,
      status: execution.status
    }
  })

  try {
    const broker = await getBrokerClient(execution.userId)
    if (!broker) {
      await terminate(execution, 'cancelled', 'no_broker_account')
      return
    }

    // Idempotency guard — reconcile previously-submitted work before any new submit
    // Cancellation intent takes precedence over everything else.
    // Never submit a new broker order if the user requested cancellation.
    if (execution.cancelRequestedAt) {
      await handleCancelRequested(execution, broker)
      return
    }

    if (execution.brokerOrderId || execution.submittedAt) {
      await syncOrderStatus(execution, broker)
      return
    }

    if (execution.clientOrderId) {
      const existingOrder = await broker.getOrderByClientOrderId(execution.clientOrderId)
      if (existingOrder) {
        await recordExecutionAudit({
          executionId: execution.id,
          userId: execution.userId,
          workerId: WORKER_ID,
          eventType: 'reconciled',
          detail: 'Existing Alpaca order found by clientOrderId before submit',
          metadata: {
            clientOrderId: execution.clientOrderId,
            brokerOrderId: existingOrder.alpacaOrderId,
            brokerStatus: existingOrder.status
          }
        })
        await applyBrokerSnapshot(execution.id, existingOrder)
        await pollUntilFilled({ ...execution, brokerOrderId: existingOrder.alpacaOrderId }, broker)
        return
      }
    }

    const riskDecision = await evaluateRiskCaps(execution)
    if (!riskDecision.allowed) {
      log.warn({ executionId: execution.id, ticker: execution.ticker, reason: riskDecision.reason }, 'risk_blocked')
      await recordExecutionAudit({
        executionId: execution.id,
        userId: execution.userId,
        workerId: WORKER_ID,
        eventType: 'risk_blocked',
        detail: `Risk cap blocked execution: ${riskDecision.reason}`,
        metadata: riskDecision.metrics
      })
      await terminate(execution, 'cancelled', `risk_cap:${riskDecision.reason}`)
      return
    }

    const marketOpen = await assertMarketIsOpen(broker, execution)
    if (!marketOpen) return

    // Last-chance cancellation check before broker submission.
    const cancelBeforeSubmit = await prisma.execution.findUnique({
      where: { id: execution.id },
      select: { cancelRequestedAt: true }
    })
    if (cancelBeforeSubmit?.cancelRequestedAt) {
      await handleCancelRequested(execution, broker)
      return
    }

    // Submit to Alpaca
    await recordExecutionAudit({
      executionId: execution.id,
      userId: execution.userId,
      workerId: WORKER_ID,
      eventType: 'submit_attempted',
      detail: 'Submitting order to Alpaca',
      metadata: {
        ticker: execution.ticker,
        direction: execution.direction,
        quantity: execution.quantity,
        clientOrderId: execution.clientOrderId
      }
    })
    const order = await broker.submitOrder({
      ticker:     execution.ticker,
      side:       execution.direction, // 'buy' | 'sell'
      qty:        execution.quantity,
      type:       'market',
      clientOrderId: execution.clientOrderId
    })

    await applyBrokerSnapshot(execution.id, order)
    await recordExecutionAudit({
      executionId: execution.id,
      userId: execution.userId,
      workerId: WORKER_ID,
      eventType: 'submit_confirmed',
      detail: 'Alpaca accepted order',
      metadata: {
        brokerOrderId: order.alpacaOrderId,
        clientOrderId: order.clientOrderId ?? execution.clientOrderId,
        brokerStatus: order.status
      }
    })

    // Poll Alpaca until fill or timeout
    await pollUntilFilled({ ...execution, brokerOrderId: order.alpacaOrderId }, broker)

  } catch (err) {
    if (err instanceof BrokerRejectionError) {
      if (shouldReconcileFromRejection(err)) {
        const broker = await getBrokerClient(execution.userId)
        if (broker) {
          await syncOrderStatus(execution, broker)
          return
        }
      }
      await terminate(execution, 'cancelled', err.reason)
    } else if (err instanceof BrokerNetworkError) {
      await releaseForRetry(execution)
    } else {
      log.error({ err, executionId: execution.id }, 'order_unexpected_error')
      await releaseForRetry(execution)
    }
  }
}

// ─── Fill polling ─────────────────────────────────────────────────────────────

async function handleCancelRequested(execution, broker) {
  // If we have not submitted to the broker yet, cancel locally immediately.
  if (!execution.brokerOrderId && !execution.submittedAt) {
    await terminate(execution, 'cancelled', 'user_cancel_requested_pre_submit')
    return
  }

  // Attempt broker-side cancellation and reconcile to the truth.
  const order = await fetchKnownOrder(execution, broker)
  if (!order) {
    await releaseForRetry(execution)
    return
  }

  // Too late: already filled.
  if (order.status === 'filled') {
    await terminate(execution, 'filled', null, {
      filledAt:       order.filledAt ?? new Date(),
      filledPrice:    order.filledAvgPrice,
      filledQuantity: order.filledQty
    })
    return
  }

  try {
    await broker.cancelOrder(order.alpacaOrderId)
  } catch (err) {
    if (err instanceof BrokerNetworkError) {
      await releaseForRetry(execution)
      return
    }
    // For non-network errors (already filled/cancelled/etc), fall through to reconcile.
  }

  // Poll briefly for terminal cancel/fill so the UI updates quickly.
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const snapshot = await fetchKnownOrder(execution, broker)
    if (!snapshot) {
      await releaseForRetry(execution)
      return
    }

    if (snapshot.status === 'filled') {
      await terminate(execution, 'filled', null, {
        filledAt:       snapshot.filledAt ?? new Date(),
        filledPrice:    snapshot.filledAvgPrice,
        filledQuantity: snapshot.filledQty
      })
      return
    }

    if (TERMINAL_BROKER_STATUSES.has(snapshot.status)) {
      await terminate(execution, 'cancelled', 'broker_cancelled_after_user_request', {
        brokerStatus: snapshot.status,
        filledPrice: snapshot.filledAvgPrice ?? undefined,
        filledQuantity: snapshot.filledQty ?? undefined
      })
      return
    }

    // Keep broker snapshot fresh while waiting.
    await applyBrokerSnapshot(execution.id, snapshot)
    await sleep(1_000)
  }

  // Not yet terminal â€” release and retry cancellation on next loop.
  await releaseForRetry(execution)
}

async function pollUntilFilled(execution, broker) {
  const deadline = Date.now() + FILL_TIMEOUT_MS
  let lastPartialFillQty = execution.filledQuantity ?? 0

  while (Date.now() < deadline) {
    // Renew the lease and check for cancel in one DB write instead of two.
    const refreshed = await prisma.execution.update({
      where: { id: execution.id },
      data:  { lockedAt: new Date() },
      select: { cancelRequestedAt: true }
    })
    if (refreshed.cancelRequestedAt) {
      await handleCancelRequested(execution, broker)
      return
    }

    const order = await fetchKnownOrder(execution, broker)
    if (!order) {
      await releaseForRetry(execution)
      return
    }

    if (order.status === 'filled') {
      await terminate(execution, 'filled', null, {
        filledAt:       order.filledAt ?? new Date(),
        filledPrice:    order.filledAvgPrice,
        filledQuantity: order.filledQty
      })
      return
    }

    if (order.status === 'partially_filled') {
      // applyBrokerSnapshot already writes lockedAt — no separate refreshLease needed
      await applyBrokerSnapshot(execution.id, order)
      if ((order.filledQty ?? 0) !== lastPartialFillQty) {
        lastPartialFillQty = order.filledQty ?? 0
        await recordExecutionAudit({
          executionId: execution.id,
          userId: execution.userId,
          workerId: WORKER_ID,
          eventType: 'partial_fill',
          detail: 'Order partially filled',
          metadata: {
            brokerOrderId: order.alpacaOrderId,
            filledQuantity: order.filledQty,
            filledPrice: order.filledAvgPrice
          }
        })
      }
    }

    if (TERMINAL_BROKER_STATUSES.has(order.status)) {
      await terminate(execution, 'cancelled', `broker_status:${order.status}`, {
        brokerStatus: order.status
      })
      return
    }

    if (PENDING_BROKER_STATUSES.has(order.status)) {
      await applyBrokerSnapshot(execution.id, order)
    }

    await sleep(FILL_POLL_INTERVAL_MS)
  }

  await releaseForRetry(execution)
}

// Poll Alpaca for an already-submitted order (idempotency path)
async function syncOrderStatus(execution, broker) {
  const existingOrder = await fetchKnownOrder(execution, broker)
  if (!existingOrder) {
    await releaseForRetry(execution)
    return
  }

  await recordExecutionAudit({
    executionId: execution.id,
    userId: execution.userId,
    workerId: WORKER_ID,
    eventType: 'reconciled',
    detail: 'Reconciled execution against existing Alpaca order',
    metadata: {
      clientOrderId: execution.clientOrderId,
      brokerOrderId: existingOrder.alpacaOrderId,
      brokerStatus: existingOrder.status
    }
  })
  await applyBrokerSnapshot(execution.id, existingOrder)
  await pollUntilFilled({
    ...execution,
    brokerOrderId: existingOrder.alpacaOrderId ?? execution.brokerOrderId
  }, broker)
}

// ─── Terminal state helpers ───────────────────────────────────────────────────

async function terminate(execution, status, cancelReason, fillData = {}) {
  // Update execution with fill data
  const updatedExecution = await prisma.execution.update({
    where: { id: execution.id },
    data: {
      status,
      lockedAt: null,
      lockedBy: null,
      activeIntentKey: null,
      cancelReason: cancelReason ?? undefined,
      ...fillData
    }
  })

  // Process metrics for filled executions
  if (status === 'filled') {
    try {
      await metricsService.processExecutionFill(updatedExecution)
    } catch (metricsError) {
      log.error({ 
        executionId: execution.id, 
        error: metricsError.message 
      }, 'metrics_processing_failed')
      // Don't fail the execution processing for metrics errors
    }
  }

  // Clear the bot engine's in-memory inflight guard
  if (execution.botId && inflightMap) {
    inflightMap.delete(`${execution.botId}:${execution.ticker}`)
  }

  const eventType = mapTerminalStatusToAuditEvent(status, cancelReason)
  if (eventType) {
    await recordExecutionAudit({
      executionId: execution.id,
      userId: execution.userId,
      workerId: WORKER_ID,
      eventType,
      detail: `${status}${cancelReason ? ` (${cancelReason})` : ''}`,
      metadata: {
        cancelReason,
        ...fillData
      }
    })
  }

  const queuedMs = execution.createdAt ? Date.now() - new Date(execution.createdAt).getTime() : null
  if (status === 'filled') {
    log.info({
      executionId: execution.id,
      botId: execution.botId,
      userId: execution.userId,
      ticker: execution.ticker,
      direction: execution.direction,
      qty: execution.quantity,
      fillPrice: fillData.filledPrice,
      queuedMs
    }, 'order_filled')
  } else if (status === 'failed') {
    log.error({ executionId: execution.id, ticker: execution.ticker, cancelReason, queuedMs }, 'order_failed')
  } else {
    log.warn({ executionId: execution.id, ticker: execution.ticker, cancelReason }, 'order_cancelled')
  }
}

async function releaseForRetry(execution) {
  const nextAttempts = (execution.attempts ?? 1)

  if (nextAttempts >= MAX_ATTEMPTS) {
    await terminate(execution, 'failed', `max_attempts_exceeded`)
    return
  }

  await prisma.execution.update({
    where: { id: execution.id },
    data: { status: 'queued', lockedAt: null, lockedBy: null }
  })
  await recordExecutionAudit({
    executionId: execution.id,
    userId: execution.userId,
    workerId: WORKER_ID,
    eventType: 'retry_scheduled',
    detail: 'Execution released for retry',
    metadata: {
      attempts: nextAttempts,
      maxAttempts: MAX_ATTEMPTS
    }
  })
  log.warn({ executionId: execution.id, attempt: nextAttempts, maxAttempts: MAX_ATTEMPTS }, 'order_retry')
}

// ─── Stuck-job recovery ────────────────────────────────────────────────────────

async function recoverStuckJobs() {
  const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS)
  const { count } = await prisma.execution.updateMany({
    where: { status: { in: ['processing', 'submitted', 'partially_filled'] }, lockedAt: { lt: stuckBefore } },
    data:  { status: 'queued', lockedAt: null, lockedBy: null }
  })
  if (count > 0) {
    log.warn({ count }, 'stuck_jobs_recovered')
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchKnownOrder(execution, broker) {
  if (execution.brokerOrderId) {
    return broker.getOrder(execution.brokerOrderId)
  }
  if (execution.clientOrderId) {
    return broker.getOrderByClientOrderId(execution.clientOrderId)
  }
  return null
}

async function applyBrokerSnapshot(executionId, order) {
  await prisma.execution.update({
    where: { id: executionId },
    data: {
      brokerOrderId: order.alpacaOrderId ?? undefined,
      brokerStatus: order.status,
      submittedAt: order.submittedAt ?? new Date(),
      lastBrokerSyncAt: new Date(),
      lockedAt: new Date(),
      status: mapBrokerStatusToExecutionStatus(order.status),
      filledPrice: order.filledAvgPrice ?? undefined,
      filledQuantity: order.filledQty ?? undefined
    }
  })
}

function mapBrokerStatusToExecutionStatus(brokerStatus) {
  if (brokerStatus === 'filled')           return 'filled'
  if (brokerStatus === 'partially_filled') return 'partially_filled'
  if (TERMINAL_BROKER_STATUSES.has(brokerStatus)) return 'cancelled'
  return 'submitted'
}

async function assertMarketIsOpen(broker, execution) {
  const clock = await broker.getClock()
  if (!clock?.is_open) {
    await terminate(execution, 'cancelled', 'market_closed_at_submission')
    return false
  }
  return true
}

function shouldReconcileFromRejection(err) {
  const message = `${err?.message ?? ''} ${err?.reason ?? ''}`.toLowerCase()
  return message.includes('client_order_id') || message.includes('client order id')
}

function mapTerminalStatusToAuditEvent(status, cancelReason) {
  if (status === 'filled') return 'filled'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return null
}
