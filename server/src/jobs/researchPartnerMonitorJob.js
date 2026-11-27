import { createResearchMonitorService } from '../services/researchPartner/researchMonitor.js'

/** Opt-in read-only news/filings scan; no LLM or portfolio access. */
export async function runResearchPartnerMonitorJob({ env = process.env, service = createResearchMonitorService() } = {}) {
  if (env.ENABLE_RESEARCH_PARTNER_MONITORING !== 'true') return { skipped:true, reason:'disabled' }
  const results = await service.runDue(10)
  return { skipped:false, checked:results.length, results }
}
