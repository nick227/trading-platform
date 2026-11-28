/**
 * Durable, compare-and-swap paper execution claims.
 *
 * An unknown broker outcome must not silently return to the queued state:
 * an operator/reconciler must inspect needs_reconciliation before retry.
 * The worker token fences a delayed worker from overwriting another claim.
 */
export async function claimQueuedAiPaperExecution({
  prismaClient,
  executionId,
  workerToken,
  now = new Date()
}) {
  if (!prismaClient?.execution || !executionId || !workerToken) {
    throw new Error('Paper execution claim requires a DB, execution and worker identity')
  }
  const result = await prismaClient.execution.updateMany({
    where: { id: executionId, status: 'queued' },
    data: {
      status: 'processing',
      lockedAt: now,
      lockedBy: workerToken,
      attempts: { increment: 1 }
    }
  })
  return result.count === 1
}

export async function completeClaimedAiPaperExecution({
  prismaClient,
  execution,
  workerToken,
  fill,
  workerId = 'ai_daily_job'
}) {
  if (!execution?.id || !workerToken || !fill?.brokerOrderId ||
      !Number.isFinite(fill.price) || fill.price <= 0 ||
      !Number.isFinite(fill.quantity) || fill.quantity <= 0) {
    throw new Error('A valid claimed paper fill is required')
  }
  return prismaClient.$transaction(async tx => {
    const updated = await tx.execution.updateMany({
      where: { id: execution.id, status: 'processing', lockedBy: workerToken },
      data: {
        status: 'filled',
        brokerOrderId: fill.brokerOrderId,
        brokerStatus: 'filled',
        filledPrice: fill.price,
        filledQuantity: fill.quantity,
        filledAt: fill.filledAt,
        pnl: fill.pnl,
        lockedAt: null,
        lockedBy: null
      }
    })
    if (updated.count !== 1) throw new Error('Paper execution ownership lost before finalization')
    await tx.executionAudit.create({
      data: {
        id: fill.auditId,
        executionId: execution.id,
        userId: execution.userId,
        workerId,
        eventType: 'filled',
        detail: `Simulated ${fill.priceModel} fill for ${execution.direction.toUpperCase()} ${fill.quantity} ${execution.ticker} @ $${fill.price.toFixed(2)} (${fill.session})`,
        metadata: {
          session: fill.session,
          executionModel: fill.priceModel,
          fillPrice: fill.price,
          fillQty: fill.quantity,
          pnl: fill.pnl,
          isReplay: fill.isReplay,
          brokerOrderId: fill.brokerOrderId,
          ...(fill.marketObservation ? { marketObservation: fill.marketObservation } : {})
        }
      }
    })
    return true
  })
}

export async function quarantineClaimedAiPaperExecution({
  prismaClient,
  executionId,
  workerToken
}) {
  const result = await prismaClient.execution.updateMany({
    where: { id: executionId, status: 'processing', lockedBy: workerToken },
    data: { status: 'needs_reconciliation', lockedAt: null, lockedBy: null }
  })
  return result.count === 1
}
