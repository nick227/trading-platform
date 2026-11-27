import { describe, expect, it, vi } from 'vitest'
import { validatePaperStrategy, evaluatePaperStrategyCandidate } from '../../src/services/researchPartner/paperStrategy.js'
import { createResearchStrategyService } from '../../src/services/researchPartner/paperStrategyService.js'
const definition = {
  name: 'Momentum watchlist', mode: 'paper', cadence: 'daily',
  universe: { type: 'watchlist', symbols: ['aapl', 'NVDA'] },
  entryRules: [{ field: 'return20dPct', operator: 'gte', value: 4 }],
  exitRules: [{ field: 'return20dPct', operator: 'lte', value: -3 }],
  risk: { maxPositionPct: 0.1, maxOrderNotional: 1000, maxOrdersPerCycle: 1 }
}
describe('RP-13 validated paper-only strategy contract', () => {
  it('normalizes symbols and evaluates deterministic screening indicators', () => {
    const spec = validatePaperStrategy(definition)
    expect(spec.universe.symbols).toEqual(['AAPL', 'NVDA'])
    expect(evaluatePaperStrategyCandidate(spec, { symbol:'AAPL', eligible:true,
      indicators:{ return20dPct:5 } })).toEqual({
        eligible:true, entry:true, exit:false, reason:'deterministic_preview_only'
      })
  })
  it('rejects arbitrary fields, trading mode and oversized risks', () => {
    expect(() => validatePaperStrategy({...definition,mode:'live'})).toThrow()
    expect(() => validatePaperStrategy({...definition,entryRules:[{field:'executeScript',operator:'gte',value:1}]})).toThrow()
    expect(() => validatePaperStrategy({...definition,risk:{...definition.risk,maxPositionPct:0.8}})).toThrow()
    expect(() => validatePaperStrategy({...definition,universe:{type:'watchlist',symbols:['AAPL','aapl']}})).toThrow()
  })
  it('approves only an owned, current draft without enabling execution', async () => {
    const db={researchPartner:{findFirst:vi.fn().mockResolvedValue({id:'p'})},
      researchPaperStrategy:{findFirst:vi.fn().mockResolvedValue({id:'s',partnerId:'p',currentVersion:2,status:'draft'}),
        updateMany:vi.fn().mockResolvedValue({count:1})}}
    const result=await createResearchStrategyService(db).approve('u','p','s',2)
    expect(result.executionEnabled).toBe(false)
    expect(db.researchPaperStrategy.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where:expect.objectContaining({status:'draft',currentVersion:2})
    }))
  })
})
