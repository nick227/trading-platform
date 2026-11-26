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

export async function fetchAdminBots({ limit = 20, offset = 0, search = '', status = null, botType = null } = {}) {
  const params = { limit, offset }
  if (search) params.search = search
  if (status) params.status = status
  if (botType) params.botType = botType
  return get('/admin/bots', params)
}

export async function fetchAdminBotDetail(botId) {
  return get(`/admin/bots/${encodeURIComponent(botId)}`)
}

export async function toggleAdminBot(botId) {
  return post(`/admin/bots/${encodeURIComponent(botId)}/toggle`)
}

export async function fetchAdminExecutions({ limit = 50, offset = 0, status = null, ticker = null, botId = null } = {}) {
  const params = { limit, offset }
  if (status) params.status = status
  if (ticker) params.ticker = ticker
  if (botId) params.botId = botId
  return get('/admin/executions', params)
}

export async function cancelAdminExecution(executionId, reason) {
  return post(`/admin/executions/${encodeURIComponent(executionId)}/cancel`, { reason })
}

export async function updateAdminUserRole(userId, role) {
  return put(`/admin/users/${encodeURIComponent(userId)}/role`, { role })
}

export async function updateAdminUserStatus(userId, status) {
  return put(`/admin/users/${encodeURIComponent(userId)}/status`, { status })
}

export async function fetchAdminUserDrilldown(userId) {
  return get(`/admin/users/${encodeURIComponent(userId)}/drilldown`)
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

export async function fetchAdminAiCycles({ limit = 20, offset = 0, session = null, isReplay = null } = {}) {
  const params = { limit, offset }
  if (session) params.session = session
  if (isReplay !== null) params.isReplay = isReplay
  return get('/admin/ai/cycles', params)
}

export async function fetchAdminAiCycleDetail(cycleId) {
  return get(`/admin/ai/cycles/${encodeURIComponent(cycleId)}`)
}

export async function fetchAdminAiDecisions({ symbol = null, action = null, session = null, limit = 50, offset = 0 } = {}) {
  const params = { limit, offset }
  if (symbol) params.symbol = symbol
  if (action) params.action = action
  if (session) params.session = session
  return get('/admin/ai/decisions', params)
}

export async function fetchAdminMarketDataDiagnostics({ session = null } = {}) {
  const params = {}
  if (session) params.session = session
  return get('/admin/market-data/diagnostics', params)
}

export async function revalidateAdminMarketFeed({ session = null } = {}) {
  return post('/admin/market-data/revalidate', { session })
}

export async function fetchAdminResearchDiagnostics() {
  return get('/admin/research/pipeline-diagnostics')
}

export async function fetchAdminEvidenceStorage() {
  return get('/admin/controls/evidence-storage')
}

export async function compactAdminEvidence() {
  return post('/admin/controls/compact-evidence')
}
