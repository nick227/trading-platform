import { describe,it,expect,vi } from 'vitest'
import {newPaperForwardState,stepResearchPaperForward} from '../../src/services/researchPartner/paperStrategyForward.js'
import {createPaperForwardService} from '../../src/services/researchPartner/paperStrategyForwardService.js'
const definition={name:'Momentum',mode:'paper',cadence:'daily',
  universe:{type:'watchlist',symbols:['AAPL']},
  entryRules:[{field:'return20dPct',operator:'gte',value:1}],
  exitRules:[{field:'return20dPct',operator:'lte',value:-2}],
  risk:{maxPositionPct:0.1,maxOrderNotional:1000,maxOrdersPerCycle:1}}
function bars(end){
 const rows=[],begin=new Date('2026-08-01T12:00:00.000Z')
 for(let d=new Date(begin);d<=new Date(end+'T12:00:00.000Z');d.setUTCDate(d.getUTCDate()+1)){
   if([0,6].includes(d.getUTCDay()))continue
   const session=d.toISOString().slice(0,10),i=rows.length,price=100+i*.5
   rows.push([session,price-1,price+1,price-2,price,1e6])
 }
 return rows
}
const engine={getDailyBars:vi.fn(async(_symbol,start,end)=>({bars:bars(end).filter(x=>x[0]>=start)}))}
describe('RP-19 manually authorized paper forward execution',()=>{
  it('requires two completed market sessions for next-open fill, never routes orders externally',async()=>{
    const first='2026-11-23',second='2026-11-24'
    const a=await stepResearchPaperForward({definition,state:newPaperForwardState(),
      asOfSession:first,engine})
    expect(a.event.filled).toHaveLength(0)
    expect(a.event.queued).toHaveLength(1)
    const b=await stepResearchPaperForward({definition,state:a.state,asOfSession:second,engine})
    expect(b.event.filled).toHaveLength(1)
    expect(b.event.filled[0]).toMatchObject({
      direction:'buy',signalSession:first,simSession:second
    })
    expect(b.state.equityCurve).toHaveLength(2)
    expect(b.state.fills[0].filledPrice).toBe(bars(second).at(-1)[1])
  })
  it('rejects duplicate sessions and calendar gaps',async()=>{
    const a=await stepResearchPaperForward({definition,state:newPaperForwardState(),asOfSession:'2026-11-23',engine})
    await expect(stepResearchPaperForward({definition,state:a.state,asOfSession:'2026-11-23',engine}))
      .rejects.toThrow(/out-of-order/)
    await expect(stepResearchPaperForward({definition,state:a.state,asOfSession:'2026-11-27',engine}))
      .rejects.toThrow(/out-of-order/)
  })
  it('requires explicit authorization and an approved immutable strategy',async()=>{
    const db={researchPaperStrategy:{findFirst:vi.fn().mockResolvedValue({id:'s',
      partnerId:'p',status:'approved_paper_definition',currentVersion:2})},
      researchPaperStrategyVersion:{findUnique:vi.fn().mockResolvedValue({definition})},
      researchPaperActivation:{create:vi.fn().mockResolvedValue({id:'a',status:'active'})}}
    const service=createPaperForwardService({db,engine})
    await expect(service.activate('u','p','s',{expectedVersion:2,confirmation:'NO'}))
      .rejects.toMatchObject({statusCode:400})
    expect(db.researchPaperActivation.create).not.toHaveBeenCalled()
    await service.activate('u','p','s',{expectedVersion:2,confirmation:'PAPER_ONLY'})
    expect(db.researchPaperActivation.create).toHaveBeenCalledWith({data:expect.objectContaining({
      version:2,state:expect.objectContaining({fills:[]})
    })})
  })
  it('fails closed on concurrent write ownership',async()=>{
    const account={id:'a',strategyId:'s',version:1,revision:0,status:'active',
      lastSession:null,state:newPaperForwardState()}
    const db={researchPaperStrategy:{findFirst:vi.fn().mockResolvedValue({id:'s'})},
      researchPaperActivation:{findUnique:vi.fn().mockResolvedValue(account),
        updateMany:vi.fn().mockResolvedValue({count:0})},
      researchPaperStrategyVersion:{findUnique:vi.fn().mockResolvedValue({definition})},
      researchPaperCycle:{create:vi.fn()},
      $transaction:vi.fn(async fn=>fn(db))}
    const svc=createPaperForwardService({db,engine,now:()=>new Date('2026-11-25T23:00:00.000Z')})
    await expect(svc.cycle('u','p','s',{asOfSession:'2026-11-23'}))
      .rejects.toMatchObject({statusCode:409})
    expect(db.researchPaperCycle.create).not.toHaveBeenCalled()
  })
})
