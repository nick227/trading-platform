import { get, post, put } from './client'

export async function fetchAdminOverview() {
  return get('/admin/overview')
}

export async function fetchAdminActivity({ limit = 50, offset = 0, category = null } = {}) {
  const params = { limit, offset }
  if (category) params.category = category
  return get('/admin/activity', params)
}

export async function fetchAdminUsers({ limit = 20, offset = 0, search = '' } = {}) {
  const params = { limit, offset }
  if (search) params.search = search
  return get('/admin/users', params)
}

export async function fetchAdminAuditLogs({ limit = 50, offset = 0, action = null, targetType = null, adminId = null } = {}) {
  const params = { limit, offset }
  if (action) params.action = action
  if (targetType) params.targetType = targetType
  if (adminId) params.adminId = adminId
  return get('/admin/audit-log', params)
}

export async function updateAdminUserRole(userId, role) {
  return put(`/admin/users/${encodeURIComponent(userId)}/role`, { role })
}

export async function setAdminEmergencyStop({ active, reason, targetUserId }) {
  return post('/admin/controls/emergency-stop', { active, reason, targetUserId })
}

export async function runAdminMarketOpen() {
  return post('/admin/controls/run-market-open')
}

export async function runAdminAiResearch(options = {}) {
  return post('/admin/controls/run-ai-research', options)
}

export async function runAdminEvidenceSync() {
  return post('/admin/controls/sync-evidence')
}

export async function cleanupAdminWorkers(retentionMinutes = 10) {
  return post('/admin/controls/cleanup-workers', { retentionMs: retentionMinutes * 60 * 1000 })
}
