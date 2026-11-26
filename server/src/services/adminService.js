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
import { validateAndIngestDailyMarketData, DEFAULT_TRADABLE_SYMBOLS } from './ai/aiMarketDataService.js'
import { getExpectedCompletedExchangeSession, isExchangeTradingDay } from '../utils/marketCalendar.js'

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
        status: true,
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
 * Updates a user's account status (active | suspended).
 */
export async function updateUserStatus({
  targetUserId,
  newStatus,
  actorUserId,
  ipAddress = null,
  prismaClient = prisma
}) {
  if (!['active', 'suspended'].includes(newStatus)) {
    throw new Error(`Invalid status '${newStatus}'. Allowed: 'active', 'suspended'`)
  }

  if (targetUserId === PLATFORM_USER_ID) {
    throw new Error('Cannot suspend canonical platform system user')
  }

  if (targetUserId === actorUserId && newStatus === 'suspended') {
    throw new Error('Administrators cannot suspend their own account')
  }

  const user = await prismaClient.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, status: true }
  })

  if (!user) {
    throw new Error('Target user not found')
  }

  const updated = await prismaClient.user.update({
    where: { id: targetUserId },
    data: { status: newStatus },
    select: { id: true, email: true, fullName: true, role: true, status: true }
  })

  if (actorUserId) {
    await logAdminAction({
      adminId: actorUserId,
      action: newStatus === 'suspended' ? 'suspend_user' : 'reactivate_user',
      targetType: 'user',
      targetId: targetUserId,
      payload: { previousStatus: user.status || 'active', newStatus, targetEmail: user.email },
      ipAddress,
      prismaClient
    })
  }

  return updated
}

/**
 * Returns comprehensive user support drilldown: linked portfolios, bots, recent executions,
 * and subscription metadata.
 */
export async function getUserDrilldown({
  targetUserId,
  prismaClient = prisma
}) {
  const user = await prismaClient.user.findUnique({
    where: { id: targetUserId },
    include: { subscription: true }
  })

  if (!user) {
    throw new Error('Target user not found')
  }

  const [portfolios, bots, recentExecutions] = await Promise.all([
    prismaClient.portfolio.findMany({
      where: { userId: targetUserId }
    }).catch(() => []),
    prismaClient.bot.findMany({
      where: { userId: targetUserId, deletedAt: null }
    }).catch(() => []),
    prismaClient.execution.findMany({
      where: { userId: targetUserId },
      orderBy: { createdAt: 'desc' },
      take: 20
    }).catch(() => [])
  ])

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status || 'active',
      createdAt: user.createdAt,
      subscription: user.subscription
    },
    portfolios,
    bots,
    recentExecutions
  }
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
 * Lists bots with owner, portfolio, execution count, and status for fleet management.
 */
export async function listAdminBots({
  limit = 20,
  offset = 0,
  search = '',
  status = null,
  botType = null,
  prismaClient = prisma
} = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20))
  const safeOffset = Math.max(0, Number(offset) || 0)

  const where = { deletedAt: null }
  if (status === 'active') where.enabled = true
  if (status === 'paused') where.enabled = false

  if (botType === 'ai') {
    where.OR = [
      { botType: { contains: 'ai' } },
      { templateId: { startsWith: 'tmpl_ai_' } }
    ]
  } else if (botType === 'rule') {
    where.botType = { not: 'ai' }
  }

  if (search && search.trim()) {
    const s = search.trim()
    where.OR = [
      ...(where.OR || []),
      { name: { contains: s } },
      { id: { contains: s } }
    ]
  }

  const [bots, total] = await Promise.all([
    prismaClient.bot.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: safeOffset,
      take: safeLimit
    }),
    prismaClient.bot.count({ where })
  ])

  const botIds = bots.map(b => b.id)
  const userIds = [...new Set(bots.map(b => b.userId).filter(Boolean))]
  const portfolioIds = [...new Set(bots.map(b => b.portfolioId).filter(Boolean))]

  const [users, portfolios, filledExecutions, latestEvents] = await Promise.all([
    userIds.length > 0
      ? prismaClient.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, fullName: true, role: true }
        }).catch(() => [])
      : [],
    portfolioIds.length > 0
      ? prismaClient.portfolio.findMany({
          where: { id: { in: portfolioIds } },
          select: { id: true, name: true, cashBalance: true, totalValue: true }
        }).catch(() => [])
      : [],
    botIds.length > 0
      ? prismaClient.execution.findMany({
          where: { botId: { in: botIds }, status: 'filled' },
          select: { botId: true }
        }).catch(() => [])
      : [],
    botIds.length > 0
      ? prismaClient.botEvent.findMany({
          where: { botId: { in: botIds } },
          orderBy: { createdAt: 'desc' },
          take: 50
        }).catch(() => [])
      : []
  ])

  const userMap = new Map(users.map(u => [u.id, u]))
  const portfolioMap = new Map(portfolios.map(p => [p.id, p]))

  const fillsMap = new Map()
  for (const e of filledExecutions) {
    fillsMap.set(e.botId, (fillsMap.get(e.botId) || 0) + 1)
  }

  const eventMap = new Map()
  for (const ev of latestEvents) {
    if (!eventMap.has(ev.botId)) eventMap.set(ev.botId, ev)
  }

  const enriched = bots.map(b => ({
    ...b,
    user: userMap.get(b.userId) || { id: b.userId, email: 'unknown' },
    portfolio: portfolioMap.get(b.portfolioId) || null,
    filledExecutionsCount: fillsMap.get(b.id) || 0,
    lastEvent: eventMap.get(b.id) || null
  }))

  return {
    total,
    offset: safeOffset,
    limit: safeLimit,
    bots: enriched
  }
}

/**
 * Returns detailed inspection data for a single bot: configuration, portfolio,
 * recent events, and recent executions.
 */
export async function getAdminBotDetail({
  botId,
  prismaClient = prisma
}) {
  const bot = await prismaClient.bot.findUnique({
    where: { id: botId }
  })

  if (!bot) {
    throw new Error(`Bot '${botId}' not found`)
  }

  const [user, portfolio, rules, events, executions] = await Promise.all([
    prismaClient.user.findUnique({
      where: { id: bot.userId },
      select: { id: true, email: true, fullName: true, role: true }
    }).catch(() => null),
    bot.portfolioId
      ? prismaClient.portfolio.findUnique({ where: { id: bot.portfolioId } }).catch(() => null)
      : null,
    prismaClient.botRule.findMany({
      where: { botId }
    }).catch(() => []),
    prismaClient.botEvent.findMany({
      where: { botId },
      orderBy: { createdAt: 'desc' },
      take: 25
    }).catch(() => []),
    prismaClient.execution.findMany({
      where: { botId },
      orderBy: { createdAt: 'desc' },
      take: 20
    }).catch(() => [])
  ])

  return {
    bot,
    user: user || { id: bot.userId, email: 'unknown' },
    portfolio,
    rules,
    events,
    recentEvents: events,
    executions,
    recentExecutions: executions
  }
}

/**
 * Toggles an individual bot between enabled and paused with audit logging.
 */
export async function toggleAdminBot({
  botId,
  actorUserId,
  ipAddress = null,
  prismaClient = prisma
}) {
  const bot = await prismaClient.bot.findUnique({
    where: { id: botId }
  })

  if (!bot) {
    throw new Error(`Bot '${botId}' not found`)
  }

  const newEnabled = !bot.enabled

  const updated = await prismaClient.bot.update({
    where: { id: botId },
    data: { enabled: newEnabled }
  })

  await prismaClient.botEvent.create({
    data: {
      id: `evt_toggle_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      botId,
      portfolioId: bot.portfolioId || 'system',
      type: newEnabled ? 'bot_resumed' : 'bot_paused',
      detail: `Admin toggled bot to ${newEnabled ? 'enabled' : 'paused'}`,
      metadata: { actorUserId, previous: bot.enabled, current: newEnabled }
    }
  }).catch(() => null)

  if (actorUserId) {
    await logAdminAction({
      adminId: actorUserId,
      action: newEnabled ? 'resume_bot' : 'pause_bot',
      targetType: 'bot',
      targetId: botId,
      payload: {
        botName: bot.name,
        previousEnabled: bot.enabled,
        newEnabled
      },
      ipAddress,
      prismaClient
    })
  }

  return updated
}

/**
 * Lists platform executions across bots and users with filters (status, ticker, botId).
 */
export async function listAdminExecutions({
  limit = 50,
  offset = 0,
  status = null,
  ticker = null,
  botId = null,
  prismaClient = prisma
} = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50))
  const safeOffset = Math.max(0, Number(offset) || 0)

  const where = {}
  if (status && status !== 'all') where.status = status
  if (ticker && ticker.trim()) where.ticker = ticker.trim().toUpperCase()
  if (botId) where.botId = botId

  const [executions, total] = await Promise.all([
    prismaClient.execution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: safeOffset,
      take: safeLimit
    }),
    prismaClient.execution.count({ where })
  ])

  const userIds = [...new Set(executions.map(e => e.userId).filter(Boolean))]
  const botIds = [...new Set(executions.map(e => e.botId).filter(Boolean))]

  const [users, bots] = await Promise.all([
    userIds.length > 0
      ? prismaClient.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, fullName: true }
        }).catch(() => [])
      : [],
    botIds.length > 0
      ? prismaClient.bot.findMany({
          where: { id: { in: botIds } },
          select: { id: true, name: true, templateId: true, botType: true }
        }).catch(() => [])
      : []
  ])

  const userMap = new Map(users.map(u => [u.id, u]))
  const botMap = new Map(bots.map(b => [b.id, b]))

  const enriched = executions.map(e => ({
    ...e,
    user: userMap.get(e.userId) || { id: e.userId, email: 'unknown' },
    bot: botMap.get(e.botId) || null,
    diagnostics: e.refusalReason || e.cancelReason || e.cancelRequestReason || null
  }))

  return {
    total,
    offset: safeOffset,
    limit: safeLimit,
    executions: enriched
  }
}

/**
 * Administratively cancels a pending or queued execution.
 */
export async function cancelAdminExecution({
  executionId,
  reason = 'Admin cancelled execution from blotter',
  actorUserId,
  ipAddress = null,
  prismaClient = prisma
}) {
  const execution = await prismaClient.execution.findUnique({
    where: { id: executionId }
  })

  if (!execution) {
    throw new Error(`Execution '${executionId}' not found`)
  }

  if (['filled', 'partially_filled'].includes(execution.status)) {
    throw new Error(`Cannot cancel execution with status '${execution.status}'`)
  }

  if (execution.status === 'cancelled') {
    return execution
  }

  const updated = await prismaClient.execution.update({
    where: { id: executionId },
    data: {
      status: 'cancelled',
      cancelReason: reason,
      cancelRequestedAt: new Date(),
      cancelRequestedBy: actorUserId
    }
  })

  await prismaClient.executionAudit.create({
    data: {
      id: `aud_cancel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      executionId,
      userId: execution.userId,
      eventType: 'cancel_requested',
      detail: `Administrative cancellation: ${reason}`,
      metadata: { actorUserId, previousStatus: execution.status }
    }
  }).catch(() => null)

  if (actorUserId) {
    await logAdminAction({
      adminId: actorUserId,
      action: 'cancel_execution',
      targetType: 'execution',
      targetId: executionId,
      payload: {
        ticker: execution.ticker,
        direction: execution.direction,
        quantity: execution.quantity,
        previousStatus: execution.status,
        reason
      },
      ipAddress,
      prismaClient
    })
  }

  return updated
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

/**
 * Lists past autonomous AI research cycles with model, token usage, costs, and decision summary.
 */
export async function listAdminAiResearchCycles({
  limit = 20,
  offset = 0,
  session = null,
  isReplay = null,
  prismaClient = prisma
} = {}) {
  const events = await prismaClient.botEvent.findMany({
    where: {
      type: 'decision_made'
    },
    include: {
      bot: {
        select: { id: true, name: true, templateId: true }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 200
  })

  // Filter down strictly to full AI research cycles (which contain symbolEvaluations)
  let cycles = events.filter(e => e.metadata?.symbolEvaluations && Array.isArray(e.metadata.symbolEvaluations))

  if (session) {
    cycles = cycles.filter(c => c.metadata?.asOfSession === session)
  }

  if (isReplay !== null) {
    const replayBool = isReplay === true || isReplay === 'true'
    cycles = cycles.filter(c => Boolean(c.metadata?.isReplay) === replayBool)
  }

  const total = cycles.length
  const paged = cycles.slice(offset, offset + limit)

  const items = paged.map(c => {
    const m = c.metadata || {}
    const evals = m.symbolEvaluations || []
    return {
      id: c.id,
      botId: c.botId,
      botName: c.bot?.name || c.botId,
      session: m.asOfSession || null,
      intendedSession: m.intendedExecutionSession || null,
      createdAt: c.createdAt,
      decisionTimestamp: m.decisionTimestamp || c.createdAt,
      model: m.model || 'gpt-4o-mini',
      provider: m.provider || 'openai',
      isReplay: Boolean(m.isReplay),
      cached: Boolean(m.cached),
      marketSummary: m.marketSummary || null,
      inputFingerprint: m.inputFingerprint || null,
      usage: m.usage || null,
      estimatedCostUsd: m.estimatedCostUsd || 0,
      actionableCount: m.selectedDecisions?.length || 0,
      totalEvaluated: evals.length,
      decisionCounts: {
        buy: evals.filter(s => s.action === 'BUY').length,
        hold: evals.filter(s => s.action === 'HOLD').length,
        sell: evals.filter(s => s.action === 'SELL').length
      }
    }
  })

  const totalCostUsd = cycles.reduce((acc, c) => acc + (Number(c.metadata?.estimatedCostUsd) || 0), 0)
  const totalTokens = cycles.reduce((acc, c) => acc + (Number(c.metadata?.usage?.total_tokens) || 0), 0)

  return {
    cycles: items,
    total,
    limit,
    offset,
    metrics: {
      totalCycles: total,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      totalTokens,
      latestModel: cycles[0]?.metadata?.model || 'gpt-4o-mini'
    }
  }
}

/**
 * Retrieves full explainability details for a specific AI research cycle,
 * including all symbol evaluations, analytical theses, evidence snapshots, and exit rules.
 */
export async function getAdminAiCycleDetail(cycleId, { prismaClient = prisma } = {}) {
  const event = await prismaClient.botEvent.findUnique({
    where: { id: cycleId },
    include: {
      bot: {
        select: { id: true, name: true, templateId: true, portfolioId: true }
      }
    }
  })

  if (!event || !event.metadata?.symbolEvaluations) {
    const err = new Error('AI research cycle not found')
    err.statusCode = 404
    throw err
  }

  const m = event.metadata || {}
  return {
    id: event.id,
    botId: event.botId,
    botName: event.bot?.name || event.botId,
    portfolioId: event.portfolioId,
    session: m.asOfSession || null,
    intendedSession: m.intendedExecutionSession || null,
    createdAt: event.createdAt,
    decisionTimestamp: m.decisionTimestamp || event.createdAt,
    model: m.model || 'gpt-4o-mini',
    provider: m.provider || 'openai',
    isReplay: Boolean(m.isReplay),
    cached: Boolean(m.cached),
    marketSummary: m.marketSummary || null,
    inputFingerprint: m.inputFingerprint || null,
    usage: m.usage || null,
    estimatedCostUsd: m.estimatedCostUsd || 0,
    symbolEvaluations: m.symbolEvaluations || [],
    selectedDecisions: m.selectedDecisions || [],
    portfolioAtDecision: m.portfolioAtDecision || null
  }
}

/**
 * Searches historical symbol-level AI decisions across cycles by symbol, action, or session.
 */
export async function listAdminAiSymbolDecisions({
  symbol = null,
  action = null,
  session = null,
  limit = 50,
  offset = 0,
  prismaClient = prisma
} = {}) {
  const cyclesRes = await listAdminAiResearchCycles({
    limit: 100,
    offset: 0,
    session: session || null,
    prismaClient
  })

  const allSymbolDecisions = []
  for (const c of cyclesRes.cycles) {
    const raw = await prismaClient.botEvent.findUnique({
      where: { id: c.id },
      select: { metadata: true }
    })
    const evals = raw?.metadata?.symbolEvaluations || []
    for (const ev of evals) {
      if (symbol && ev.symbol?.toUpperCase() !== symbol.toUpperCase()) continue
      if (action && ev.action?.toUpperCase() !== action.toUpperCase()) continue
      allSymbolDecisions.push({
        cycleId: c.id,
        session: c.session,
        intendedSession: c.intendedSession,
        createdAt: c.createdAt,
        decisionTimestamp: c.decisionTimestamp,
        isReplay: c.isReplay,
        model: c.model,
        symbol: ev.symbol,
        action: ev.action,
        confidence: ev.confidence,
        thesis: ev.thesis,
        evidence: ev.evidence || {},
        exitRule: ev.exitRule || {}
      })
    }
  }

  const total = allSymbolDecisions.length
  const paged = allSymbolDecisions.slice(offset, offset + limit)

  return {
    decisions: paged,
    total,
    limit,
    offset
  }
}

/**
 * Returns universe-wide market data ingestion diagnostics across all 10 tradable symbols.
 */
export async function getAdminMarketDataDiagnostics({
  session = null,
  prismaClient = prisma
} = {}) {
  const targetSession = session || getExpectedCompletedExchangeSession()
  const todayStr = new Date().toISOString().slice(0, 10)
  const isTodayTradingDay = isExchangeTradingDay(todayStr)

  const validation = await validateAndIngestDailyMarketData({
    session: targetSession
  })

  const symbolsList = DEFAULT_TRADABLE_SYMBOLS.map(sym => {
    const detail = validation.symbolDetails?.[sym]
    const isStale = validation.staleSymbols?.find(s => s.symbol === sym)
    const isMissing = validation.missingSymbols?.includes(sym)
    const isInvalid = validation.invalidBars?.find(i => i.symbol === sym)

    let status = 'healthy'
    let reason = null

    if (isMissing) {
      status = 'missing'
      reason = 'No market bars returned from Alpha Engine'
    } else if (isStale) {
      status = 'stale'
      reason = `Latest bar (${isStale.latestBarDate}) lags session (${isStale.expectedSession})`
    } else if (isInvalid) {
      status = 'invalid'
      reason = isInvalid.reason || 'Bar failed numerical integrity check'
    }

    return {
      symbol: sym,
      status,
      session: detail?.session || isStale?.latestBarDate || null,
      barsCount: detail?.barsCount || 0,
      open: detail?.open != null ? Number(detail.open) : null,
      high: detail?.high != null ? Number(detail.high) : null,
      low: detail?.low != null ? Number(detail.low) : null,
      close: detail?.close != null ? Number(detail.close) : null,
      volume: detail?.volume != null ? Number(detail.volume) : null,
      source: detail?.source || 'alpha-engine',
      reason
    }
  })

  return {
    session: targetSession,
    isTodayTradingDay,
    status: validation.valid ? 'healthy' : 'degraded',
    reason: validation.reason,
    summary: {
      total: DEFAULT_TRADABLE_SYMBOLS.length,
      healthy: symbolsList.filter(s => s.status === 'healthy').length,
      stale: symbolsList.filter(s => s.status === 'stale').length,
      missing: symbolsList.filter(s => s.status === 'missing').length,
      invalid: symbolsList.filter(s => s.status === 'invalid').length
    },
    symbols: symbolsList
  }
}

/**
 * Administrative action to trigger market data ingestion validation against Alpha Engine.
 */
export async function revalidateAdminMarketFeed({
  session = null,
  actorUserId = null,
  ipAddress = null,
  prismaClient = prisma
} = {}) {
  const diagnostics = await getAdminMarketDataDiagnostics({ session, prismaClient })

  if (actorUserId) {
    await logAdminAction({
      adminId: actorUserId,
      action: 'revalidate_market_data',
      targetType: 'market_feed',
      targetId: diagnostics.session,
      payload: {
        session: diagnostics.session,
        status: diagnostics.status,
        healthyCount: diagnostics.summary.healthy,
        total: diagnostics.summary.total
      },
      ipAddress,
      prismaClient
    })
  }

  return diagnostics
}
