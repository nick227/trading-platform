import { describe, expect, it, vi } from 'vitest'
import { runResearchPartnerMonitorJob } from '../../src/jobs/researchPartnerMonitorJob.js'
describe('RP-16 opt-in read-only research scheduler',()=>{
  it('does not invoke providers unless monitoring explicitly enabled',async()=>{
    const service={runDue:vi.fn()}
    expect(await runResearchPartnerMonitorJob({env:{},service})).toMatchObject({skipped:true})
    expect(service.runDue).not.toHaveBeenCalled()
  })
  it('limits scans per scheduled invocation',async()=>{
    const service={runDue:vi.fn().mockResolvedValue([{monitorId:'m',status:'no_new_evidence'}])}
    expect((await runResearchPartnerMonitorJob({env:{
      ENABLE_RESEARCH_PARTNER_MONITORING:'true'
    },service})).checked).toBe(1)
    expect(service.runDue).toHaveBeenCalledWith(10)
  })
})
