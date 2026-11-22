import { ACTIVE_EXECUTION_STATUSES } from '../../../worker/src/queues/executionStatus.js'
import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { validateEventMetadata } from '../utils/validation.js'
import { buildExecutionWhere } from '../utils/pagination.js'

function buildClientOrderId(executionId) {
  return `tp_${executionId}`
}

export default {
  async createExecution(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Execution data object is required')
    }
    if (!data.userId || typeof data.userId !== 'string') {
      throw new Error('userId is required for execution creation')
    }
    if (!data.portfolioId || typeof data.portfolioId !== 'string') {
      throw new Error('portfolioId is required for execution creation')
    }
    if (!data.ticker || typeof data.ticker !== 'string') {
      throw new Error('ticker is required for execution creation')
    }
    const direction = String(data.direction ?? '').toLowerCase().trim()
    if (direction !== 'buy' && direction !== 'sell') {
      throw new Error(`Invalid direction: "${data.direction}". Direction must be strictly 'buy' or 'sell'.`)
    }

    const executionId = generateId(ID_PREFIXES.EXECUTION)
    const execution = await prisma.execution.create({
      data: {
        id: executionId,
        ...data,
        direction,
        status: 'queued',
        origin: data.botId ? 'bot' : 'manual',
        clientOrderId: buildClientOrderId(executionId),
        activeIntentKey: null
      }
    })
    
    const auditCreate = prisma.executionAudit.create({
      data: {
        id: generateId(ID_PREFIXES.AUDIT),
        executionId: execution.id,
        userId: execution.userId,
        eventType: 'execution_created',
        detail: `Execution queued for ${execution.ticker}`,
        metadata: {
          origin: execution.origin,
          clientOrderId: execution.clientOrderId,
          quantity: execution.quantity,
          direction: execution.direction,
          price: execution.price
        }
      }
    })

    if (data.botId) {
      const eventType = 'execution_created'
      const metadata = {
        executionId: execution.id,
        quantity: data.quantity,
        price: data.price,
        direction
      }
      validateEventMetadata(eventType, metadata)
      await Promise.all([
        auditCreate,
        prisma.botEvent.create({
          data: {
            id: generateId(ID_PREFIXES.EVENT),
            botId: data.botId,
            portfolioId: data.portfolioId,
            executionId: execution.id,
            type: eventType,
            detail: `Created ${direction} order for ${data.ticker}`,
            metadata
          }
        })
      ])
    } else {
      await auditCreate
    }
    
    return execution
  },

  /**
   * User cancellation. An order no worker has claimed is cancelled outright and releases its
   * active-intent key (otherwise the bot could never place that order again). An order a
   * worker has claimed or sent is only marked cancel-requested; the order worker finalizes it
   * (it checks the request before submitting and cancels at the broker). Atomic, audited with
   * valid event types. Returns the execution with `cancelOutcome: 'cancelled' | 'requested'`.
   */
  async cancelExecution(id, userId) {
    const execution = await prisma.execution.findUnique({ where: { id } })
    if (!execution) return null

    if (execution.userId !== userId) {
      const err = new Error('Forbidden')
      err.code = 'FORBIDDEN'
      throw err
    }

    const notCancellable = () => {
      const err = new Error(`Execution not cancellable from status: ${execution.status}`)
      err.code = 'NOT_CANCELLABLE'
      return err
    }
    if (!ACTIVE_EXECUTION_STATUSES.includes(execution.status)) throw notCancellable()

    return prisma.$transaction(async (tx) => {
      const now = new Date()
      const audit = (eventType, detail) => tx.executionAudit.create({
        data: {
          id: generateId('aud'), executionId: id, userId, eventType, detail,
          metadata: { previousStatus: execution.status, origin: execution.origin, clientOrderId: execution.clientOrderId, quantity: execution.quantity, direction: execution.direction, price: execution.price, reason: 'user_cancel' }
        }
      })

      const direct = await tx.execution.updateMany({
        where: { id, userId, status: 'queued', lockedAt: null },
        data: { status: 'cancelled', activeIntentKey: null, cancelReason: 'user_cancel', cancelRequestedAt: now, cancelRequestedBy: userId, cancelRequestReason: 'user_cancel' }
      })
      if (direct.count === 1) {
        await audit('cancelled', `Cancelled by the user before it was sent (${execution.ticker})`)
        return { ...(await tx.execution.findUnique({ where: { id } })), cancelOutcome: 'cancelled' }
      }

      const requested = await tx.execution.updateMany({
        where: { id, userId, status: { in: ACTIVE_EXECUTION_STATUSES }, cancelRequestedAt: null },
        data: { cancelRequestedAt: now, cancelRequestedBy: userId, cancelRequestReason: 'user_cancel' }
      })
      if (requested.count === 1) {
        await audit('cancel_requested', `Cancellation requested by the user (${execution.ticker})`)
        return { ...(await tx.execution.findUnique({ where: { id } })), cancelOutcome: 'requested' }
      }
      const current = await tx.execution.findUnique({ where: { id } })
      if (current?.cancelRequestedAt && ACTIVE_EXECUTION_STATUSES.includes(current.status)) return { ...current, cancelOutcome: 'requested' }
      throw notCancellable()
    })
  },

  async getExecutions(query) {
    const where = buildExecutionWhere(query)
    const take = Math.min(parseInt(query.limit || 50), 100)
    
    const executions = await prisma.execution.findMany({
      where,
      include: {
        bot: {
          select: { id: true, name: true, templateId: true }
        }
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      take: take + 1 // Get one extra to determine next cursor
    })
    
    const hasMore = executions.length > take
    const results = hasMore ? executions.slice(0, -1) : executions
    
    const nextCursor = hasMore && results.length > 0
      ? `${results[results.length - 1].createdAt.getTime()}|${results[results.length - 1].id}`
      : null
    
    return { data: results, pagination: { hasMore, nextCursor } }
  },

  async getExecution(id) {
    return prisma.execution.findUnique({
      where: { id },
      include: {
        bot: {
          select: { id: true, name: true, templateId: true }
        },
        events: true
      }
    })
  },

  async getExecutionSummary(query) {
    const where = buildExecutionWhere(query)
    
    // Use aggregation for accurate totals (better at scale)
    const [aggregate, countResult, latest, oldest] = await Promise.all([
      prisma.execution.aggregate({
        where,
        _count: true,
        _sum: { quantity: true }
      }),
      prisma.execution.groupBy({
        where,
        by: ['direction'],
        _count: true
      }),
      prisma.execution.findFirst({
        where,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.execution.findFirst({
        where,
        orderBy: { createdAt: 'asc' }
      })
    ])
    
    let buyExecutions = 0, sellExecutions = 0
    for (const group of countResult) {
      if (group.direction === 'buy') buyExecutions = group._count
      else sellExecutions = group._count
    }

    const summary = {
      totalExecutions: aggregate._count,
      buyExecutions,
      sellExecutions,
      winRate: 0, // Calculate based on sell prices vs avg cost
      totalVolume: aggregate._sum.quantity || 0,
      avgExecutionSize: aggregate._count > 0 ? (aggregate._sum.quantity || 0) / aggregate._count : 0,
      latestExecution: latest,
      oldestExecution: oldest
    }
    
    return summary
  }
}
