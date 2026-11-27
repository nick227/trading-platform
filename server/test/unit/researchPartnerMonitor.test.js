import { describe, expect, it, vi } from 'vitest'
import { createResearchMonitorService } from '../../src/services/researchPartner/researchMonitor.js'
const now=new Date('2026-11-27T20:00:00.000Z')
const base={id:'m',partnerId:'p',status:'active',cadence:'daily',symbols:['NVDA'],
  seenHashes:[],nextCheckAt:new Date('2026-11-27T19:00:00.000Z')}
function fixture(records,seenHashes=[]) {
  const monitor={...base,seenHashes}
  const db={
    researchPartner:{findFirst:vi.fn().mockResolvedValue({id:'p',currentMandateVersion:2})},
    researchMandateVersion:{findUnique:vi.fn().mockResolvedValue({content:{
      objective:'Study infrastructure', interests:[],watchlist:['NVDA'],hypotheses:[],
      preferences:{horizon:'medium',researchDepth:'standard'},exclusions:[]
    }})},
    researchMonitor:{
      findFirst:vi.fn().mockResolvedValue(monitor),
      findMany:vi.fn().mockResolvedValue([monitor]),
      create:vi.fn().mockResolvedValue(monitor),
      updateMany:vi.fn().mockResolvedValue({count:1}),
      update:vi.fn().mockResolvedValue(monitor)
    },
    researchMonitorEvent:{create:vi.fn().mockResolvedValue({id:'ev'})},
    $transaction:vi.fn(async fn=>fn(db))
  }
  const evidenceCollector=vi.fn().mockResolvedValue({records,asOfSession:'2026-11-27',fingerprint:'fp',unavailable:[]})
  return {db,evidenceCollector,clock:()=>now}
}
const evidence=[{id:'n1',source:'news',contentHash:'h1',title:'New report',
  publishedAt:'2026-11-27T18:00:00.000Z',availableAt:'2026-11-27T18:00:00.000Z'}]
describe('RP-16 evidence change detection',()=>{
  it('creates a baseline without treating initial documents as new alerts',async()=>{
    const args=fixture(evidence)
    const result=await createResearchMonitorService(args).check('u','p','m')
    expect(result.status).toBe('no_new_evidence')
    expect(args.db.researchMonitorEvent.create).not.toHaveBeenCalled()
    expect(args.db.researchMonitor.update).toHaveBeenCalledWith(expect.objectContaining({
      data:expect.objectContaining({seenHashes:['news:h1']})
    }))
  })
  it('records a source-linked change only when a new hash arrives',async()=>{
    const args=fixture(evidence,['news:old'])
    const result=await createResearchMonitorService(args).check('u','p','m')
    expect(result.additions).toBe(1)
    expect(args.db.researchMonitorEvent.create).toHaveBeenCalledWith({
      data:expect.objectContaining({kind:'new_evidence',payload:expect.objectContaining({
        newRecords:[expect.objectContaining({contentHash:'h1'})]
      })})
    })
  })
  it('rejects repeated or overlapping checks via DB compare-and-swap',async()=>{
    const args=fixture(evidence,['news:h1'])
    args.db.researchMonitor.updateMany.mockResolvedValue({count:0})
    await expect(createResearchMonitorService(args).check('u','p','m')).rejects.toMatchObject({statusCode:409})
    expect(args.evidenceCollector).not.toHaveBeenCalled()
  })
  it('rejects invalid symbols and avoids unnecessary evidence calls',async()=>{
    const args=fixture([])
    await expect(createResearchMonitorService(args).create('u','p',{name:'Track',symbols:['BAD!']})).rejects.toThrow()
    expect(args.evidenceCollector).not.toHaveBeenCalled()
  })

  it('recognizes evidence arriving after an initially empty baseline',async()=>{
    const args=fixture(evidence,[])
    args.db.researchMonitor.findFirst.mockResolvedValue({
      ...base,seenHashes:[],lastCheckedAt:new Date('2026-11-26T20:00:00.000Z')
    })
    const result=await createResearchMonitorService(args).check('u','p','m')
    expect(result.additions).toBe(1)
    expect(args.db.researchMonitorEvent.create).toHaveBeenCalledOnce()
  })
})
