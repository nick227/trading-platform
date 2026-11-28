/**
 * Administrative Routes (/api/admin)
 * 
 * Provides endpoints for administrative monitoring, telemetry, user management,
 * and autonomous operational controls.
 * Guarded by requireAdmin (for read/monitoring) and requireRole(['admin']) (for mutations).
 */
import { requireAdmin, requireRole } from '../middleware/requireAdmin.js'
import { getPlatformFleetHealth } from '../services/platformFleetService.js'
import {
  getAdminOverview,
  getAdminActivity,
  listAdminUsers,
  listAdminAuditLogs,
  listAdminBots,
  getAdminBotDetail,
  toggleAdminBot,
  listAdminExecutions,
  cancelAdminExecution,
  updateUserRole,
  updateUserStatus,
  getUserDrilldown,
  cleanupDeadWorkers,
  triggerAdminEmergencyStop,
  triggerMarketOpenJob,
  triggerAiDailyJob,
  triggerEvidenceSync,
  listAdminAiResearchCycles,
  getAdminAiCycleDetail,
  listAdminAiSymbolDecisions,
  getAdminMarketDataDiagnostics,
  revalidateAdminMarketFeed,
  getResearchPublicationDiagnostics,
  triggerEvidenceCompaction,
  getEvidenceStorageMetrics,
  getAdminBrokerFleetStatus,
  triggerAdminBrokerReconcileAll
} from '../services/adminService.js'

export default async function adminRoutes(app) {
  // GET /api/admin/overview — High-level platform health, counts, and pipeline status
  app.get('/overview', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const data = await getAdminOverview()
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to fetch admin overview')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_OVERVIEW_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/activity — Unified live stream of bot events and execution audits
  app.get('/activity', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { limit, offset, category } = request.query || {}
      const data = await getAdminActivity({ limit, offset, category })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to fetch admin activity')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_ACTIVITY_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/users — Paginated list of users and their roles (Admin & Operator)
  app.get('/users', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { limit, offset, search } = request.query || {}
      const data = await listAdminUsers({ limit, offset, search })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to list users')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_USERS_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/users/:id/drilldown — Comprehensive support view of user portfolios, bots, and trades
  app.get('/users/:id/drilldown', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { id } = request.params
      const data = await getUserDrilldown({ targetUserId: id })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.warn({ err: err.message, userId: request.params.id }, 'User drilldown lookup failed')
      return reply.code(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: err.message }
      })
    }
  })

  // GET /api/admin/audit-log — Immutable record of administrative mutations (Admin & Operator)
  app.get('/audit-log', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { limit, offset, action, targetType, adminId } = request.query || {}
      const data = await listAdminAuditLogs({ limit, offset, action, targetType, adminId })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to list audit logs')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_AUDIT_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/bots — Paginated query of bots across users and platform (Admin & Operator)
  app.get('/bots', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { limit, offset, search, status, botType } = request.query || {}
      const data = await listAdminBots({ limit, offset, search, status, botType })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to list bots')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_BOTS_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/bots/:id — Deep inspection of bot config, portfolio, and event logs
  app.get('/bots/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { id } = request.params
      const data = await getAdminBotDetail({ botId: id })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.warn({ err: err.message, botId: request.params.id }, 'Bot detail lookup failed')
      return reply.code(404).send({
        success: false,
        error: { code: 'BOT_NOT_FOUND', message: err.message }
      })
    }
  })

  // GET /api/admin/executions — Real-time order blotter across all platform bots & users
  app.get('/executions', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { limit, offset, status, ticker, botId } = request.query || {}
      const data = await listAdminExecutions({ limit, offset, status, ticker, botId })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to list executions')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_EXECUTIONS_ERROR', message: err.message }
      })
    }
  })

  // Strict admin guard for state-changing operational mutations
  const adminOnly = requireRole(['admin'])

  // Helper to extract client IP safely
  const getIp = (req) => req.headers['x-forwarded-for'] || req.ip || null

  // POST /api/admin/executions/:id/cancel — Administrative cancellation of pending order
  app.post('/executions/:id/cancel', { preHandler: [adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params
      const { reason } = request.body || {}
      const updated = await cancelAdminExecution({
        executionId: id,
        reason,
        actorUserId: request.user.id,
        ipAddress: getIp(request)
      })
      return reply.send({ success: true, data: updated, execution: updated })
    } catch (err) {
      app.log.error(err, 'Failed to cancel execution')
      return reply.code(400).send({
        success: false,
        error: { code: 'EXECUTION_CANCEL_ERROR', message: err.message }
      })
    }
  })

  // POST /api/admin/bots/:id/toggle — Individual bot pause/resume switch
  app.post('/bots/:id/toggle', { preHandler: [adminOnly] }, async (request, reply) => {
    try {
      const { id } = request.params
      const updated = await toggleAdminBot({
        botId: id,
        actorUserId: request.user.id,
        ipAddress: getIp(request)
      })
      return reply.send({ success: true, data: updated, bot: updated })
    } catch (err) {
      app.log.error(err, 'Failed to toggle bot')
      return reply.code(400).send({
        success: false,
        error: { code: 'BOT_TOGGLE_ERROR', message: err.message }
      })
    }
  })

  // PUT /api/admin/users/:id/role — Change a user's role
  app.put('/users/:id/role', { preHandler: [adminOnly] }, async (request, reply) => {
    const { id } = request.params
    const { role } = request.body || {}

    if (!role) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'role is required' }
      })
    }

    try {
      const user = await updateUserRole({
        targetUserId: id,
        newRole: role,
        actorUserId: request.user.id
      })
      return reply.send({ success: true, data: user, user })
    } catch (err) {
      app.log.warn({ err: err.message, targetUserId: id, role }, 'Failed to update user role')
      return reply.code(400).send({
        success: false,
        error: { code: 'UPDATE_ROLE_ERROR', message: err.message }
      })
    }
  })

  // PUT /api/admin/users/:id/status — Suspend or reactivate user account
  app.put('/users/:id/status', { preHandler: [adminOnly] }, async (request, reply) => {
    const { id } = request.params
    const { status } = request.body || {}

    if (!status) {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'status is required' }
      })
    }

    try {
      const user = await updateUserStatus({
        targetUserId: id,
        newStatus: status,
        actorUserId: request.user.id,
        ipAddress: getIp(request)
      })
      return reply.send({ success: true, data: user, user })
    } catch (err) {
      app.log.warn({ err: err.message, targetUserId: id, status }, 'Failed to update user status')
      return reply.code(400).send({
        success: false,
        error: { code: 'UPDATE_STATUS_ERROR', message: err.message }
      })
    }
  })

  // POST /api/admin/controls/emergency-stop — Activate or clear emergency stop
  app.post('/controls/emergency-stop', { preHandler: [adminOnly] }, async (request, reply) => {
    const { active, reason, targetUserId } = request.body || {}

    if (typeof active !== 'boolean') {
      return reply.code(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'active (boolean) is required' }
      })
    }

    try {
      const result = await triggerAdminEmergencyStop({
        active,
        reason,
        targetUserId,
        actorUserId: request.user.id,
        ipAddress: getIp(request)
      })
      return reply.send({ success: true, data: result, result })
    } catch (err) {
      app.log.error(err, 'Emergency stop execution failed')
      return reply.code(500).send({
        success: false,
        error: { code: 'EMERGENCY_STOP_ERROR', message: err.message }
      })
    }
  })

  // POST /api/admin/controls/run-market-open — Trigger market open paper fill processing
  app.post('/controls/run-market-open', { preHandler: [adminOnly] }, async (request, reply) => {
    try {
      const result = await triggerMarketOpenJob({
        actorUserId: request.user.id,
        ipAddress: getIp(request)
      })
      return reply.send({ success: true, data: result, result })
    } catch (err) {
      app.log.error(err, 'Market open job execution failed')
      return reply.code(500).send({
        success: false,
        error: { code: 'JOB_EXECUTION_ERROR', message: err.message }
      })
    }
  })

  // POST /api/admin/controls/run-ai-research — Trigger daily AI research & decision cycle
  app.post('/controls/run-ai-research', { preHandler: [adminOnly] }, async (request, reply) => {
    const { session, provider, dryRun, apiKey } = request.body || {}
    try {
      const result = await triggerAiDailyJob({
        session,
        provider,
        dryRun,
        apiKey,
        actorUserId: request.user.id,
        ipAddress: getIp(request)
      })
      return reply.send({ success: true, data: result, result })
    } catch (err) {
      app.log.error(err, 'AI research job execution failed')
      return reply.code(500).send({
        success: false,
        error: { code: 'JOB_EXECUTION_ERROR', message: err.message }
      })
    }
  })

  // POST /api/admin/controls/sync-evidence — Trigger strategy evidence sync
  app.post('/controls/sync-evidence', { preHandler: [adminOnly] }, async (request, reply) => {
    try {
      const { force = true } = request.body || {}
      const result = await triggerEvidenceSync({
        actorUserId: request.user.id,
        ipAddress: getIp(request),
        force
      })
      return reply.send({ success: true, data: result, result })
    } catch (err) {
      app.log.error(err, 'Evidence sync failed')
      return reply.code(500).send({
        success: false,
        error: { code: 'JOB_EXECUTION_ERROR', message: err.message }
      })
    }
  })

  // POST /api/admin/controls/compact-evidence — Trigger strategy evidence compaction
  app.post('/controls/compact-evidence', { preHandler: [adminOnly] }, async (request, reply) => {
    try {
      const result = await triggerEvidenceCompaction({
        actorUserId: request.user.id,
        ipAddress: getIp(request)
      })
      return reply.send({ success: true, data: result, result })
    } catch (err) {
      app.log.error(err, 'Evidence compaction failed')
      return reply.code(500).send({
        success: false,
        error: { code: 'EVIDENCE_COMPACTION_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/controls/evidence-storage — Strategy evidence storage footprint metrics
  app.get('/controls/evidence-storage', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const data = await getEvidenceStorageMetrics()
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to fetch evidence storage metrics')
      return reply.code(500).send({
        success: false,
        error: { code: 'EVIDENCE_STORAGE_ERROR', message: err.message }
      })
    }
  })

  // POST /api/admin/controls/cleanup-workers — Clean up stale worker status records
  app.post('/controls/cleanup-workers', { preHandler: [adminOnly] }, async (request, reply) => {
    const { retentionMs } = request.body || {}
    try {
      const result = await cleanupDeadWorkers({
        retentionMs: retentionMs ? Number(retentionMs) : undefined,
        actorUserId: request.user.id,
        ipAddress: getIp(request)
      })
      return reply.send({ success: true, data: result, result })
    } catch (err) {
      app.log.error(err, 'Worker cleanup failed')
      return reply.code(500).send({
        success: false,
        error: { code: 'CLEANUP_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/platform-fleet — Health of TradeLoom's own paper bots
  app.get('/platform-fleet', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      return reply.send({ success: true, data: await getPlatformFleetHealth() })
    } catch (err) {
      app.log.error(err, 'Failed to read platform fleet health')
      return reply.code(500).send({ success: false, error: { code: 'ADMIN_PLATFORM_FLEET_ERROR', message: err.message } })
    }
  })

  // GET /api/admin/ai/cycles — List autonomous AI research cycles with telemetry
  app.get('/ai/cycles', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { limit, offset, session, isReplay } = request.query || {}
      const data = await listAdminAiResearchCycles({
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
        session,
        isReplay
      })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to list AI research cycles')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_AI_CYCLES_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/ai/cycles/:id — Explainability drilldown for a specific cycle
  app.get('/ai/cycles/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const data = await getAdminAiCycleDetail(request.params.id)
      return reply.send({ success: true, data })
    } catch (err) {
      if (err.statusCode === 404) {
        return reply.code(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: err.message }
        })
      }
      app.log.error(err, 'Failed to get AI cycle detail')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_AI_CYCLE_DETAIL_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/ai/decisions — Searchable symbol-level decisions across cycles
  app.get('/ai/decisions', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { symbol, action, session, limit, offset } = request.query || {}
      const data = await listAdminAiSymbolDecisions({
        symbol,
        action,
        session,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined
      })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to list AI symbol decisions')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_AI_DECISIONS_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/market-data/diagnostics — Ticker feed health, freshness, and numerical checks
  app.get('/market-data/diagnostics', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const { session } = request.query || {}
      const data = await getAdminMarketDataDiagnostics({ session })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to get market data diagnostics')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_MARKET_DATA_DIAGNOSTICS_ERROR', message: err.message }
      })
    }
  })

  // POST /api/admin/market-data/revalidate — Trigger live re-validation and log audit trail
  app.post('/market-data/revalidate', { preHandler: [adminOnly] }, async (request, reply) => {
    try {
      const { session } = request.body || {}
      const data = await revalidateAdminMarketFeed({
        session,
        actorUserId: request.user.id,
        ipAddress: getIp(request)
      })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to revalidate market feed')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_MARKET_DATA_REVALIDATE_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/research/pipeline-diagnostics — Research publication pipeline health and evidence diagnostics
  app.get('/research/pipeline-diagnostics', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const data = await getResearchPublicationDiagnostics()
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to fetch research pipeline diagnostics')
      return reply.code(500).send({
        success: false,
        error: { code: 'RESEARCH_DIAGNOSTICS_ERROR', message: err.message }
      })
    }
  })

  // GET /api/admin/broker/fleet-status — Broker connection fleet stats and position drift
  app.get('/broker/fleet-status', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const data = await getAdminBrokerFleetStatus()
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to fetch broker fleet status')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_BROKER_FLEET_STATUS_ERROR', message: err.message }
      })
    }
  })

  // POST /api/admin/broker/reconcile-all — Trigger fleet-wide reconciliation sweep
  app.post('/broker/reconcile-all', { preHandler: [adminOnly] }, async (request, reply) => {
    try {
      const data = await triggerAdminBrokerReconcileAll({
        actorUserId: request.user.id,
        ipAddress: getIp(request)
      })
      return reply.send({ success: true, data })
    } catch (err) {
      app.log.error(err, 'Failed to trigger fleet broker reconciliation')
      return reply.code(500).send({
        success: false,
        error: { code: 'ADMIN_BROKER_RECONCILE_ALL_ERROR', message: err.message }
      })
    }
  })
}
