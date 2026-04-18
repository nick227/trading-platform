import prisma from '../loaders/prisma.js'
import { generateId, ID_PREFIXES } from '../utils/idGenerator.js'
import { validateEventMetadata } from '../utils/validation.js'
import { buildExecutionWhere } from '../utils/pagination.js'

export default {
  async createExecution(data) {
    const execution = await prisma.execution.create({
      data: {
        id: generateId(ID_PREFIXES.EXECUTION),
        ...data,
        direction: data.direction.toLowerCase(), // Normalize direction input
        status: 'proposed'
      }
    })
    
    // Create bot event if automated
    if (data.botId) {
      const eventType = 'execution_created'
      const metadata = {
        executionId: execution.id,
        quantity: data.quantity,
        price: data.price,
        direction: data.direction
      }
      
      validateEventMetadata(eventType, metadata)
      
      await prisma.botEvent.create({
        data: {
          id: generateId(ID_PREFIXES.EVENT),
          botId: data.botId,
          portfolioId: data.portfolioId,
          executionId: execution.id,
          type: eventType,
          detail: `Created ${data.direction} order for ${data.ticker}`,
          metadata
        }
      })
    }
    
    return execution
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
    
    const directionCounts = countResult.reduce((acc, group) => {
      acc[group.direction] = group._count
      return acc
    }, {})
    
    const summary = {
      totalExecutions: aggregate._count,
      buyExecutions: directionCounts.buy || 0,
      sellExecutions: directionCounts.sell || 0,
      winRate: 0, // Calculate based on sell prices vs avg cost
      totalVolume: aggregate._sum.quantity || 0,
      avgExecutionSize: aggregate._count > 0 ? (aggregate._sum.quantity || 0) / aggregate._count : 0,
      latestExecution: latest,
      oldestExecution: oldest
    }
    
    return summary
  }
}
