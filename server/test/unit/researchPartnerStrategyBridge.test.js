import { describe, expect, it, vi } from 'vitest'
import { createResearchStrategyService } from '../../src/services/researchPartner/paperStrategyService.js'
const definition = { name:'Research draft', mode:'paper', cadence:'weekly',
  universe:{type:'watchlist',symbols:['NVDA']},
  entryRules:[{field:'return20dPct',operator:'gte',value:5}],
  exitRules:[],risk:{maxPositionPct:0.1,maxOrderNotional:500,maxOrdersPerCycle:1} }
function fixture(report) {
  const db={
    researchPartner:{findFirst:vi.fn().mockResolvedValue({id:'p',userId:'u'})},
    researchSession:{findFirst:vi.fn().mockResolvedValue({id:'s',partnerId:'p',mandateVersion:3,status:'completed',report})},
    $transaction:vi.fn(async callback=>callback(db)),
    researchPaperStrategy:{create:vi.fn().mockResolvedValue({id:'strat',partnerId:'p',status:'draft',currentVersion:1})},
    researchPaperStrategyVersion:{create:vi.fn().mockResolvedValue({id:'rev',version:1})}
  }
  return db
}
const report={ findings:[{claim:'AI demand is increasing',assessment:'supported',evidenceIds:['filing:a']}],
  evidence:[{id:'filing:a',source:'filings',title:'10-Q',url:'https://www.sec.gov/Archives/example',
    publishedAt:'2026-11-25T12:00:00.000Z',contentHash:'abc'}],
  evidenceFingerprint:'fingerprint'}
describe('RP-14 research-to-strategy bridge',()=>{
  it('pins the source provenance without granting execution privileges',async()=>{
    const db=fixture(report)
    const strategy=await createResearchStrategyService(db).fromResearch('u','p',{
      sessionId:'s',findingIndex:0,definition
    })
    expect(strategy.status).toBe('draft')
    const data=db.researchPaperStrategyVersion.create.mock.calls[0][0].data
    expect(data.provenance).toMatchObject({
      kind:'research_finding',sessionId:'s',findingIndex:0,mandateVersion:3,
      sourceStatus:'cited_unverified_interpretation',
      sources:[expect.objectContaining({contentHash:'abc',source:'filings'})]
    })
    expect(data.definition.mode).toBe('paper')
  })
  it('rejects invented references and foreign or unfinished sessions',async()=>{
    const invalid=fixture({...report,findings:[{claim:'Unsupported citation',assessment:'supported',evidenceIds:['fake']} ]})
    await expect(createResearchStrategyService(invalid).fromResearch('u','p',{sessionId:'s',findingIndex:0,definition}))
      .rejects.toThrow(/unavailable references/)
    const absent=fixture(report)
    absent.researchSession.findFirst.mockResolvedValue(null)
    await expect(createResearchStrategyService(absent).fromResearch('u','p',{sessionId:'foreign',findingIndex:0,definition}))
      .rejects.toMatchObject({statusCode:404})
  })
  it('retains evidence limitations when a finding is not independently supported',async()=>{
    const db=fixture({...report,findings:[{claim:'Speculative outlook',assessment:'inconclusive',evidenceIds:[]} ]})
    await createResearchStrategyService(db).fromResearch('u','p',{sessionId:'s',findingIndex:0,definition})
    expect(db.researchPaperStrategyVersion.create.mock.calls[0][0].data.provenance.sourceStatus)
      .toBe('no_independent_sources')
  })
})
