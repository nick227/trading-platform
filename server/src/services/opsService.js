import prisma from '../loaders/prisma.js'

const ACTIVE_STATUSES = ['queued', 'processing', 'submitted', 'partially_filled']
const WORKER_STALE_AFTER_MS = Number(process.env.WORKER_STALE_AFTER_MS ?? 15_000)

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

    const staleBefore = Date.now() - WORKER_STALE_AFTER_MS
    const liveWorkers = workers.filter((worker) => worker.lastSeen && worker.lastSeen.getTime() >= staleBefore)
    const staleWorkers = workers.filter((worker) => !worker.lastSeen || worker.lastSeen.getTime() < staleBefore)
    const queueLagMs = liveWorkers.reduce((max, worker) => Math.max(max, worker.queueLagMs ?? 0), 0)

    return {
      summary: {
        workerCount: liveWorkers.length,
        staleWorkerCount: staleWorkers.length,
        workerFreshnessMs: WORKER_STALE_AFTER_MS,
        queueLagMs,
        activeExecutions,
        queuedExecutions,
        partialFills: partialFills.length,
        rejectedToday
      },
      workers: liveWorkers,
      staleWorkers,
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
