import { describe, expect, it, vi } from 'vitest'
import { createPaperStrategyProposalRuntime } from '../../src/services/researchPartner/paperStrategyProposalRuntime.js'
const partner = { id:'p', mandate:{content:{objective:'Study network providers',watchlist:['CSCO']}}}
const spec={name:'Cisco technical',mode:'paper',cadence:'daily',
  universe:{type:'watchlist',symbols:['CSCO']},
  entryRules:[{field:'return20dPct',operator:'gte',value:5}],
  exitRules:[],risk:{maxPositionPct:0.1,maxOrderNotional:500,maxOrdersPerCycle:1}}
describe('RP-15 governed AI strategy interpretation',()=>{
  it('requires explicit operator authorization before any model call',async()=>{
    const provider={completeStructured:vi.fn()}
    await expect(createPaperStrategyProposalRuntime({
      governor:{enabled:()=>false},provider
    }).propose({userId:'u',partner,instructions:'Look for momentum'})).rejects.toMatchObject({statusCode:503})
    expect(provider.completeStructured).not.toHaveBeenCalled()
  })
  it('returns unsaved validated structured definitions with one settled reservation',async()=>{
    const governor={enabled:()=>true,reserve:vi.fn().mockResolvedValue({id:'r'}),
      settle:vi.fn().mockResolvedValue({settled:true})}
    const provider={completeStructured:vi.fn().mockResolvedValue({structured:spec,
      usage:{prompt_tokens:70,completion_tokens:50}})}
    const result=await createPaperStrategyProposalRuntime({governor,provider}).propose({
      userId:'u',partner,instructions:'Study CSCO with high 20-day momentum'
    })
    expect(result).toMatchObject({status:'unsaved_preview',executable:false})
    expect(governor.reserve).toHaveBeenCalledOnce()
    expect(governor.settle).toHaveBeenCalledOnce()
  })
  it('rejects model attempts to increase risk or enable live trading',async()=>{
    const governor={enabled:()=>true,reserve:vi.fn().mockResolvedValue({id:'r'}),
      settle:vi.fn().mockResolvedValue({settled:true})}
    const provider={completeStructured:vi.fn().mockResolvedValue({
      structured:{...spec,mode:'live'},usage:{}
    })}
    await expect(createPaperStrategyProposalRuntime({governor,provider}).propose({
      userId:'u',partner,instructions:'Trade live'})).rejects.toThrow()
  })
})
