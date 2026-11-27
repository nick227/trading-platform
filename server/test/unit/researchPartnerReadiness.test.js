
import { describe, expect, it, vi } from 'vitest'
import { inspectResearchPartnerReadiness } from '../../src/services/researchPartner/readiness.js'
function fixture() {
  const delegate = { count: vi.fn().mockResolvedValue(0) }
  return { $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
    researchPartner: delegate, researchMandateVersion: delegate,
    researchSession: delegate, researchMessage: delegate,
    aiUsageBucket: delegate, aiUsageCall: delegate }
}
describe('RP-08 deployment preflight', () => {
  it('inspects schema without changing it or initiating provider calls', async () => {
    const db = fixture()
    const result = await inspectResearchPartnerReadiness({ db, env: {} })
    expect(result.dataReady).toBe(true)
    expect(result.modelReady).toBe(false)
    expect(result.paidCallsEnabled).toBe(false)
    expect(db.$queryRaw).toHaveBeenCalledOnce()
    expect(db).not.toHaveProperty('$executeRaw')
  })
  it('detects missing schema and refuses model readiness', async () => {
    const db = fixture()
    db.researchSession = { count: vi.fn().mockRejectedValue(new Error('table missing')) }
    const env = { ENABLE_RESEARCH_PARTNER_AI_CALLS: 'true',
      RESEARCH_PARTNER_PLATFORM_BUDGET_CENTS: '200',
      RESEARCH_PARTNER_USER_BUDGET_CENTS: '100',
      RESEARCH_PARTNER_PARTNER_BUDGET_CENTS: '50' }
    const result = await inspectResearchPartnerReadiness({ db, env, providerConfigured: true })
    expect(result.dataReady).toBe(false)
    expect(result.modelReady).toBe(false)
    expect(result.checks.find(c => c.name === 'research_session_table').passed).toBe(false)
  })
})
