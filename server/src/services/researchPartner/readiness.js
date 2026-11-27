
/** Read-only operational diagnostics. Never activates a provider, agent or broker. */
export async function inspectResearchPartnerReadiness({ db, env = process.env, providerConfigured = Boolean(env.OPENAI_API_KEY) } = {}) {
  if (!db) throw new Error('Prisma client required')
  const checks = []
  const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail })
  try {
    await db.$queryRaw`SELECT 1 AS ok`
    check('mysql_connection', true, 'Database responded')
  } catch { check('mysql_connection', false, 'Database unavailable') }
  for (const [name, delegate] of [
    ['research_partner_table', db.researchPartner],
    ['research_mandate_table', db.researchMandateVersion],
    ['research_session_table', db.researchSession],
    ['research_message_table', db.researchMessage],
    ['ai_usage_bucket_table', db.aiUsageBucket],
    ['ai_usage_call_table', db.aiUsageCall]
  ]) {
    try {
      if (!delegate?.count) throw Error('Prisma model missing')
      await delegate.count()
      check(name, true, 'Accessible')
    } catch { check(name, false, 'Missing or inaccessible') }
  }
  const enabled = env.ENABLE_RESEARCH_PARTNER_AI_CALLS === 'true'
  const caps = ['RESEARCH_PARTNER_PLATFORM_BUDGET_CENTS',
    'RESEARCH_PARTNER_USER_BUDGET_CENTS','RESEARCH_PARTNER_PARTNER_BUDGET_CENTS']
  const budgetsValid = caps.every(key => Number.isSafeInteger(Number(env[key])) && Number(env[key]) > 0)
  check('paid_calls_disabled_by_default', !enabled, enabled ? 'Operator enabled paid calls' : 'Paid calls disabled')
  check('budget_configuration', budgetsValid, budgetsValid ? 'Configured' : 'Missing budget configuration')
  check('model_provider_credentials', providerConfigured, providerConfigured ? 'Configured' : 'Unavailable')
  const dataReady = checks.filter(c => c.name.includes('_table') || c.name === 'mysql_connection').every(c => c.passed)
  return {
    dataReady,
    modelReady: dataReady && enabled && budgetsValid && providerConfigured,
    paidCallsEnabled: enabled,
    checks
  }
}
