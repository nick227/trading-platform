import prisma from '../loaders/prisma.js'

const ACTIVE_STATUSES = ['queued', 'processing', 'submitted', 'partially_filled']

export default {
  async getOverview() {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)

    const [
      workers,
      activeExecutions,
      queuedExecutions,
      partialFills,
      rejectedToday,
      recentAudits
    ] = await Promise.all([
      prisma.workerStatus.findMany({
        orderBy: { lastSeen: 'desc' }
      }),
      prisma.execution.count({
        where: { status: { in: ACTIVE_STATUSES } }
      }),
      prisma.execution.count({
        where: { status: 'queued' }
      }),
      prisma.execution.findMany({
        where: { status: 'partially_filled' },
        orderBy: { createdAt: 'asc' },
        take: 10
      }),
      prisma.execution.count({
        where: {
          status: 'cancelled',
          createdAt: { gte: dayStart },
          OR: [
            { cancelReason: { contains: 'broker_status:rejected' } },
            { cancelReason: { contains: 'risk_cap:' } },
            { cancelReason: 'no_broker_account' }
          ]
        }
      }),
      prisma.executionAudit.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50
      })
    ])

    const queueLagMs = workers.reduce((max, worker) => Math.max(max, worker.queueLagMs ?? 0), 0)

    return {
      summary: {
        workerCount: workers.length,
        queueLagMs,
        activeExecutions,
        queuedExecutions,
        partialFills: partialFills.length,
        rejectedToday
      },
      workers,
      partialFills,
      recentAudits
    }
  },

  async getAudits(query) {
    const take = Math.min(Number(query.limit ?? 100), 200)
    const where = {}

    if (query.executionId) where.executionId = query.executionId
    if (query.userId) where.userId = query.userId
    if (query.eventType) where.eventType = query.eventType

    return prisma.executionAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take
    })
  }
}
