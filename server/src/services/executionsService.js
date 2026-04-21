import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { validateEventMetadata } from '../utils/validation.js'
import { buildExecutionWhere } from '../utils/pagination.js'

function buildClientOrderId(executionId) {
  return `tp_${executionId}`
}

export default {
  async createExecution(data) {
    const executionId = generateId(ID_PREFIXES.EXECUTION)
    const direction = data.direction.toLowerCase()
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
    
    // Create bot event if automated
    if (data.botId) {
      const eventType = 'execution_created'
      const metadata = {
        executionId: execution.id,
        quantity: data.quantity,
        price: data.price,
        direction
      }
      
      validateEventMetadata(eventType, metadata)
      
      await prisma.botEvent.create({
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
    }

    await prisma.executionAudit.create({
      data: {
        id: generateId('aud'),
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
    
    return execution
  },

  async cancelExecution(id, userId) {
    const execution = await prisma.execution.findUnique({ where: { id } })
    if (!execution) return null

    if (execution.userId !== userId) {
      const err = new Error('Forbidden')
      err.code = 'FORBIDDEN'
      throw err
    }

    const cancellable = execution.status === 'queued' || execution.status === 'processing'
    if (!cancellable) {
      const err = new Error(`Execution not cancellable from status: ${execution.status}`)
      err.code = 'NOT_CANCELLABLE'
      throw err
    }

    const updated = await prisma.execution.update({
      where: { id },
      data: { status: 'cancelled' }
    })

    await prisma.executionAudit.create({
      data: {
        id: generateId('aud'),
        executionId: updated.id,
        userId: updated.userId,
        eventType: 'execution_cancelled',
        detail: `Execution cancelled for ${updated.ticker}`,
        metadata: {
          previousStatus: execution.status,
          origin: updated.origin,
          clientOrderId: updated.clientOrderId,
          quantity: updated.quantity,
          direction: updated.direction,
          price: updated.price
        }
      }
    })

    return updated
  },

  async getExecutions(query) {
    const where = buildExecutionWhere(query)
    const take = Math.min(parseInt(query.limit || 50), 100)
    
    const executions = await prisma.execution.findMany({
      where,
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
    return prisma.execution.findUnique({ where: { id } })
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
