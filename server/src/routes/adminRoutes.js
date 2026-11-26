/**
 * Administrative Routes (/api/admin)
 * 
 * Provides endpoints for administrative monitoring, telemetry, user management,
 * and autonomous operational controls.
 * Guarded by requireAdmin (for read/monitoring) and requireRole(['admin']) (for mutations).
 */
import { requireAdmin, requireRole } from '../middleware/requireAdmin.js'
import {
  getAdminOverview,
  getAdminActivity,
  listAdminUsers,
  updateUserRole,
  cleanupDeadWorkers,
  triggerAdminEmergencyStop,
  triggerMarketOpenJob,
  triggerAiDailyJob,
  triggerEvidenceSync
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

  // Strict admin guard for state-changing operational mutations
  const adminOnly = requireRole(['admin'])

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
        actorUserId: request.user.id
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
      const result = await triggerMarketOpenJob()
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
    const { session, provider, dryRun } = request.body || {}
    try {
      const result = await triggerAiDailyJob({ session, provider, dryRun })
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
      const result = await triggerEvidenceSync()
      return reply.send({ success: true, data: result, result })
    } catch (err) {
      app.log.error(err, 'Evidence sync failed')
      return reply.code(500).send({
        success: false,
        error: { code: 'JOB_EXECUTION_ERROR', message: err.message }
      })
    }
  })

  // POST /api/admin/controls/cleanup-workers — Clean up stale worker status records
  app.post('/controls/cleanup-workers', { preHandler: [adminOnly] }, async (request, reply) => {
    const { retentionMs } = request.body || {}
    try {
      const result = await cleanupDeadWorkers({ retentionMs: retentionMs ? Number(retentionMs) : undefined })
      return reply.send({ success: true, data: result, result })
    } catch (err) {
      app.log.error(err, 'Worker cleanup failed')
      return reply.code(500).send({
        success: false,
        error: { code: 'CLEANUP_ERROR', message: err.message }
      })
    }
  })
}
