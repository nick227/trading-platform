import os from 'os'
import prisma from '../db/prisma.js'
import { BrokerNetworkError, BrokerRejectionError } from '../broker/alpacaClient.js'
import { getBrokerClient } from '../broker/clientCache.js'
import { recordExecutionAudit } from '../audit/executionAudit.js'
import { evaluateRiskCaps } from '../risk/riskCaps.js'

const WORKER_ID      = `${os.hostname()}-${process.pid}`
const MAX_ATTEMPTS   = 3
const POLL_IDLE_MS   = 500   // sleep when no jobs are queued
const STUCK_AFTER_MS = 120_000 // 2 minutes — locked row is considered stuck
const FILL_POLL_INTERVAL_MS = 2_000  // how often to poll Alpaca for fill status
const FILL_TIMEOUT_MS       = 30_000 // give up waiting for fill after 30s

let running = false

// Called by the bot engine to clear the inflight guard when an order finishes
let inflightMap = null
export function setInflightMap(map) { inflightMap = map }

export async function startOrderWorker() {
  running = true
  console.log(`[orderWorker] started — workerId=${WORKER_ID}`)

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
      console.error(`[orderWorker] unexpected error for ${execution.id}:`, err)
      await releaseForRetry(execution)
    }
  }
}

// ─── Fill polling ─────────────────────────────────────────────────────────────

async function pollUntilFilled(execution, broker) {
  const deadline = Date.now() + FILL_TIMEOUT_MS
  let lastPartialFillQty = execution.filledQuantity ?? 0

  while (Date.now() < deadline) {
    const order = await fetchKnownOrder(execution, broker)
    if (!order) {
      await releaseForRetry(execution)
      return
    }

    await refreshLease(execution.id)

    if (order.status === 'filled') {
      await terminate(execution, 'filled', null, {
        filledAt:       order.filledAt ?? new Date(),
        filledPrice:    order.filledAvgPrice,
        filledQuantity: order.filledQty
      })
      return
    }

    if (order.status === 'partially_filled') {
      // Update progress but keep polling
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

    if (['canceled', 'rejected', 'expired'].includes(order.status)) {
      await terminate(execution, 'cancelled', `broker_status:${order.status}`, {
        brokerStatus: order.status
      })
      return
    }

    if (['new', 'accepted', 'pending_new', 'accepted_for_bidding', 'pending_replace', 'replaced', 'calculated'].includes(order.status)) {
      await applyBrokerSnapshot(execution.id, order)
    }

    await sleep(FILL_POLL_INTERVAL_MS)
  }

  // Timeout — release the lock so it retries on the next poll cycle
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
  await prisma.execution.update({
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

  console.log(`[orderWorker] ${execution.id} → ${status}${cancelReason ? ` (${cancelReason})` : ''}`)
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
  console.log(`[orderWorker] ${execution.id} released for retry (attempt ${nextAttempts}/${MAX_ATTEMPTS})`)
}

// ─── Stuck-job recovery ────────────────────────────────────────────────────────

async function recoverStuckJobs() {
  const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS)
  const { count } = await prisma.execution.updateMany({
    where: { status: { in: ['processing', 'submitted', 'partially_filled'] }, lockedAt: { lt: stuckBefore } },
    data:  { status: 'queued', lockedAt: null, lockedBy: null }
  })
  if (count > 0) {
    console.log(`[orderWorker] recovered ${count} stuck job(s)`)
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
  if (brokerStatus === 'partially_filled') return 'partially_filled'
  if (brokerStatus === 'filled') return 'filled'
  if (['canceled', 'rejected', 'expired'].includes(brokerStatus)) return 'cancelled'
  return 'submitted'
}

async function refreshLease(executionId) {
  await prisma.execution.update({
    where: { id: executionId },
    data: { lockedAt: new Date() }
  })
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
