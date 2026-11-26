/**
 * TradeLoom Administrative Service
 * 
 * Central coordinator for admin dashboard metrics, live activity feeds,
 * user role management (RBAC), worker status monitoring, and operational controls.
 */
import prisma from '../loaders/prisma.js'
import { getAiPipelineStatus } from './ai/aiPipelineTracker.js'
import { runAiStrategyDailyJob } from '../jobs/aiStrategyDailyJob.js'
import { runAiStrategyMarketOpenJob } from '../jobs/aiStrategyMarketOpenJob.js'
import { generateStrategyEvidence } from './strategyEvidenceService.js'
import { activateEmergencyStop, clearEmergencyStop, getEmergencyStop } from './emergencyStopService.js'
import { PLATFORM_USER_ID } from './ai/aiBotService.js'

export const VALID_ROLES = ['user', 'operator', 'admin']

/**
 * Returns a high-level bird's-eye view of platform metrics, autonomous pipeline state,
 * bot fleets, order queues, worker health, and system status.
 */
export async function getAdminOverview({ prismaClient = prisma } = {}) {
  const now = new Date()
  const activeWorkerThreshold = new Date(Date.now() - 2 * 60 * 1000) // Heartbeat within 2 minutes

  // Execute independent metric queries in parallel
  const [
    users,
    subscriptions,
    bots,
    executions,
    workers,
    emergencyStop,
    pipeline
  ] = await Promise.all([
    // User metrics
    prismaClient.user.findMany({
      select: { id: true, role: true, createdAt: true }
    }).catch(() => []),

    // Active subscriptions
    prismaClient.subscription.count({
      where: { status: 'ACTIVE' }
    }).catch(() => 0),

    // Bot fleet metrics
    prismaClient.bot.findMany({
      where: { deletedAt: null },
      select: { id: true, enabled: true, botType: true, templateId: true }
    }).catch(() => []),

    // Execution queue counts
    prismaClient.execution.findMany({
      select: { id: true, status: true, side: true, notional: true, quantity: true, price: true, createdAt: true }
    }).catch(() => []),

    // Worker status heartbeats
    prismaClient.workerStatus.findMany({
      orderBy: { lastSeen: 'desc' },
      take: 20
    }).catch(() => []),

    // Canonical emergency stop state
    getEmergencyStop(PLATFORM_USER_ID, { prismaClient }).catch(() => ({ active: false })),

    // Autonomous AI Pipeline status
    getAiPipelineStatus({ templateId: 'tmpl_ai_catalyst_momentum', prismaClient }).catch((err) => ({
      status: 'error',
      message: err?.message || 'Pipeline status unavailable'
    }))
  ])

  // Process user breakdown
  const byRole = { admin: 0, operator: 0, user: 0 }
  for (const u of users) {
    const r = u.role || 'user'
    byRole[r] = (byRole[r] || 0) + 1
  }

  // Process bot fleet breakdown
  let enabledBots = 0
  let pausedBots = 0
  let aiBots = 0
  let ruleBots = 0
  for (const b of bots) {
    if (b.enabled) enabledBots++
    else pausedBots++

    if (b.botType?.includes('ai') || b.templateId?.startsWith('tmpl_ai_')) aiBots++
    else ruleBots++
  }

  // Process execution breakdown
  const executionBreakdown = {
    total: executions.length,
    queued: 0,
    pending_fill: 0,
    filled: 0,
    cancelled: 0,
    rejected: 0,
    failed: 0,
    filledNotional: 0
  }
  for (const e of executions) {
    const s = e.status || 'unknown'
    if (executionBreakdown[s] !== undefined) {
      executionBreakdown[s]++
    }
    if (s === 'filled') {
      const notional = e.notional != null ? Number(e.notional) : (Number(e.quantity || 0) * Number(e.price || 0))
      executionBreakdown.filledNotional += notional
    }
  }

  // Process worker heartbeats
  const activeWorkers = workers.filter(w => new Date(w.lastSeen) >= activeWorkerThreshold)
  const staleWorkers = workers.filter(w => new Date(w.lastSeen) < activeWorkerThreshold)
  const avgQueueLag = activeWorkers.length > 0
    ? Math.round(activeWorkers.reduce((acc, w) => acc + (w.queueLagMs || 0), 0) / activeWorkers.length)
    : 0

  return {
    timestamp: now.toISOString(),
    users: {
      total: users.length,
      activeSubscriptions: subscriptions,
      byRole
    },
    bots: {
      total: bots.length,
      enabled: enabledBots,
      paused: pausedBots,
      ai: aiBots,
      rule: ruleBots
    },
    executions: executionBreakdown,
    workers: {
      total: workers.length,
      activeCount: activeWorkers.length,
      staleCount: staleWorkers.length,
      avgQueueLagMs: avgQueueLag,
      list: workers.map(w => ({
        id: w.id,
        lastSeen: w.lastSeen,
        startedAt: w.startedAt,
        queueLagMs: w.queueLagMs,
        isActive: new Date(w.lastSeen) >= activeWorkerThreshold
      }))
    },
    emergencyStop,
    pipeline
  }
}

/**
 * Returns a unified stream of operational bot events and execution audit events.
 */
export async function getAdminActivity({
  limit = 50,
  offset = 0,
  category = null,
  prismaClient = prisma
} = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50))
  const safeOffset = Math.max(0, Number(offset) || 0)

  // Fetch recent BotEvents and ExecutionAudits
  const [botEvents, executionAudits] = await Promise.all([
    prismaClient.botEvent.findMany({
      take: safeLimit + safeOffset,
      orderBy: { createdAt: 'desc' }
    }).catch(() => []),

    prismaClient.executionAudit.findMany({
      take: safeLimit + safeOffset,
      orderBy: { createdAt: 'desc' }
    }).catch(() => [])
  ])

  // Normalize and merge both streams
  const normalized = []

  for (const be of botEvents) {
    normalized.push({
      id: be.id,
      timestamp: be.createdAt,
      source: 'bot_event',
      type: be.type,
      detail: be.detail,
      refId: be.botId,
      metadata: be.metadata || {}
    })
  }

  for (const ea of executionAudits) {
    normalized.push({
      id: ea.id,
      timestamp: ea.createdAt,
      source: 'execution_audit',
      type: ea.eventType,
      detail: ea.detail,
      refId: ea.executionId,
      metadata: ea.metadata || {}
    })
  }

  // Sort unified stream descending by timestamp
  normalized.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  // Apply optional category/source filtering
  let filtered = normalized
  if (category) {
    filtered = normalized.filter(item => item.source === category || item.type?.includes(category))
  }

  const paginated = filtered.slice(safeOffset, safeOffset + safeLimit)

  return {
    total: filtered.length,
    offset: safeOffset,
    limit: safeLimit,
    events: paginated
  }
}

/**
 * Lists users with their role, subscription, and bot count for administrative review.
 */
export async function listAdminUsers({
  limit = 20,
  offset = 0,
  search = '',
  prismaClient = prisma
} = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20))
  const safeOffset = Math.max(0, Number(offset) || 0)

  const where = {}
  if (search && search.trim()) {
    where.OR = [
      { email: { contains: search.trim() } },
      { fullName: { contains: search.trim() } }
    ]
  }

  const [users, total] = await Promise.all([
    prismaClient.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
        subscription: true
      },
      orderBy: { createdAt: 'desc' },
      skip: safeOffset,
      take: safeLimit
    }),
    prismaClient.user.count({ where })
  ])

  return {
    total,
    offset: safeOffset,
    limit: safeLimit,
    users
  }
}

/**
 * Updates a user's role (user | operator | admin).
 * Protected against demoting the canonical platform user or an admin demoting themselves.
 */
export async function updateUserRole({
  targetUserId,
  newRole,
  actorUserId,
  prismaClient = prisma
}) {
  if (!VALID_ROLES.includes(newRole)) {
    throw new Error(`Invalid role '${newRole}'. Allowed roles: ${VALID_ROLES.join(', ')}`)
  }

  if (targetUserId === PLATFORM_USER_ID) {
    throw new Error('Cannot change role of canonical platform system user')
  }

  if (targetUserId === actorUserId && newRole !== 'admin') {
    throw new Error('Administrators cannot demote their own account')
  }

  const user = await prismaClient.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, role: true }
  })

  if (!user) {
    throw new Error('Target user not found')
  }

  const updated = await prismaClient.user.update({
    where: { id: targetUserId },
    data: { role: newRole },
    select: { id: true, email: true, fullName: true, role: true }
  })

  if (actorUserId) {
    await logAdminAction({
      adminId: actorUserId,
      action: 'update_user_role',
      targetType: 'user',
      targetId: targetUserId,
      payload: { previousRole: user.role, newRole, targetEmail: user.email },
      prismaClient
    })
  }

  return updated
}

/**
 * Records an immutable administrative audit log entry.
 */
export async function logAdminAction({
  adminId,
  action,
  targetType,
  targetId = null,
  payload = null,
  ipAddress = null,
  prismaClient = prisma
}) {
  try {
    const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    return await prismaClient.adminAuditLog.create({
      data: {
        id,
        adminId: String(adminId),
        action: String(action),
        targetType: String(targetType),
        targetId: targetId ? String(targetId) : null,
        payload: payload || undefined,
        ipAddress: ipAddress || null
      }
    })
  } catch (err) {
    console.error('Failed to record admin audit log:', err?.message || err)
    return null
  }
}

/**
 * Lists administrative audit logs with filtering and admin actor metadata.
 */
export async function listAdminAuditLogs({
  limit = 50,
  offset = 0,
  action = null,
  targetType = null,
  adminId = null,
  prismaClient = prisma
} = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50))
  const safeOffset = Math.max(0, Number(offset) || 0)

  const where = {}
  if (action) where.action = action
  if (targetType) where.targetType = targetType
  if (adminId) where.adminId = adminId

  const [logs, total] = await Promise.all([
    prismaClient.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: safeOffset,
      take: safeLimit
    }),
    prismaClient.adminAuditLog.count({ where })
  ])

  const adminIds = [...new Set(logs.map(l => l.adminId).filter(Boolean))]
  const admins = adminIds.length > 0
    ? await prismaClient.user.findMany({
        where: { id: { in: adminIds } },
        select: { id: true, email: true, fullName: true, role: true }
      }).catch(() => [])
    : []

  const adminMap = new Map(admins.map(a => [a.id, a]))

  const enriched = logs.map(l => ({
    ...l,
    admin: adminMap.get(l.adminId) || { id: l.adminId, email: 'unknown' }
  }))

  return {
    total,
    offset: safeOffset,
    limit: safeLimit,
    logs: enriched
  }
}

/**
 * Removes dead/stale worker records older than the retention threshold.
 */
export async function cleanupDeadWorkers({
  retentionMs = 10 * 60 * 1000,
  actorUserId = null,
  ipAddress = null,
  prismaClient = prisma
} = {}) {
  const staleBefore = new Date(Date.now() - retentionMs)
  const result = await prismaClient.workerStatus.deleteMany({
    where: {
      lastSeen: { lt: staleBefore }
    }
  })

  if (actorUserId) {
    await logAdminAction({
      adminId: actorUserId,
      action: 'cleanup_workers',
      targetType: 'worker',
      payload: { retentionMs, deleted: result.count },
      ipAddress,
      prismaClient
    })
  }

  return {
    deleted: result.count,
    deletedCount: result.count,
    staleBefore: staleBefore.toISOString()
  }
}

/**
 * Triggers or clears emergency stop across the canonical platform bots or target user.
 */
export async function triggerAdminEmergencyStop({
  active,
  reason = 'Admin requested emergency stop',
  targetUserId = PLATFORM_USER_ID,
  actorUserId = null,
  ipAddress = null,
  prismaClient = prisma
}) {
  const res = active
    ? await activateEmergencyStop(targetUserId, reason, { prismaClient })
    : await clearEmergencyStop(targetUserId, { prismaClient })

  if (actorUserId) {
    await logAdminAction({
      adminId: actorUserId,
      action: active ? 'emergency_stop_activated' : 'emergency_stop_cleared',
      targetType: 'system',
      targetId: targetUserId,
      payload: { active, reason, targetUserId },
      ipAddress,
      prismaClient
    })
  }

  return res
}

/**
 * Triggers manual execution of the autonomous market-open paper fill job.
 */
export async function triggerMarketOpenJob({
  actorUserId = null,
  ipAddress = null,
  prismaClient = prisma
} = {}) {
  const res = await runAiStrategyMarketOpenJob({ prismaClient })

  if (actorUserId) {
    await logAdminAction({
      adminId: actorUserId,
      action: 'trigger_market_open',
      targetType: 'job',
      payload: { ok: res?.ok ?? true },
      ipAddress,
      prismaClient
    })
  }

  return res
}

/**
 * Triggers manual execution of the autonomous daily AI research & decision job.
 */
export async function triggerAiDailyJob({
  session = null,
  provider = 'openai',
  dryRun = false,
  apiKey = null,
  actorUserId = null,
  ipAddress = null,
  prismaClient = prisma
} = {}) {
  const providerOptions = apiKey ? { apiKey } : {}
  const res = await runAiStrategyDailyJob({
    session,
    providerName: provider,
    providerOptions,
    dryRun,
    force: true,
    prismaClient
  })

  if (actorUserId) {
    await logAdminAction({
      adminId: actorUserId,
      action: 'trigger_ai_research',
      targetType: 'job',
      payload: { session, provider, dryRun }, // Crucial: apiKey deliberately omitted for security
      ipAddress,
      prismaClient
    })
  }

  return res
}

/**
 * Triggers manual synchronization of public strategy evidence.
 */
export async function triggerEvidenceSync({
  actorUserId = null,
  ipAddress = null,
  prismaClient = prisma
} = {}) {
  const res = await generateStrategyEvidence({ prismaClient })

  if (actorUserId) {
    await logAdminAction({
      adminId: actorUserId,
      action: 'trigger_evidence_sync',
      targetType: 'job',
      ipAddress,
      prismaClient
    })
  }

  return res
}
