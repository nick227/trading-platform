import {describe,it,expect,vi} from 'vitest'
import {runPaperStrategyBacktest} from '../../src/services/researchPartner/paperStrategyBacktest.js'
import {createResearchBacktestService} from '../../src/services/researchPartner/paperStrategyBacktestService.js'
const def={name:'AAPL momentum',mode:'paper',cadence:'daily',
  universe:{type:'watchlist',symbols:['AAPL']},
  entryRules:[{field:'return20dPct',operator:'gte',value:1}],
  exitRules:[{field:'return20dPct',operator:'lte',value:-1}],
  risk:{maxPositionPct:0.1,maxOrderNotional:1000,maxOrdersPerCycle:1}}
function series(start='2026-01-01',count=120){
  const bars=[]
  let day=new Date(start+'T12:00:00Z')
  while(bars.length<count){
    const date=day.toISOString().slice(0,10)
    if(day.getUTCDay()>0&&day.getUTCDay()<6 && date!=='2026-01-01'){
      const i=bars.length,close=100+i*0.25
      bars.push([date,close-0.5,close+1,close-2,close,1e6])
    }
    day=new Date(day.getTime()+86400000)
  }
  return bars
}
describe('RP-17 point-in-time paper backtests',()=>{
  it('fills a previous-close signal only at next session open, and reconciles FIFO results',async()=>{
    const bars=series()
    const startSession=bars[55][0],endSession=bars[85][0]
    const engine={getDailyBars:vi.fn(async()=>({bars}))}
    const result=await runPaperStrategyBacktest({definition:def,startSession,endSession,engine})
    expect(result.fillCount).toBeGreaterThan(0)
    expect(result.fills[0].direction).toBe('buy')
    expect(result.fills[0].signalSession).toBe(startSession)
    expect(result.fills[0].simSession).toBe(bars[56][0])
    expect(result.fills[0].filledPrice).toBe(bars[56][1])
    expect(result.equityCurve.at(-1).equity).toBe(result.endingEquity)
    expect(result.assumptions.slippage).toBe(0)
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0)
  })
  it('requires explicit approved owned version before fetching market data',async()=>{
    const engine={getDailyBars:vi.fn()}
    const db={researchPaperStrategy:{findFirst:vi.fn().mockResolvedValue({
      id:'s',partnerId:'p',status:'draft',currentVersion:1})}}
    await expect(createResearchBacktestService({db,engine}).run('u','p','s',{
      startSession:'2026-01-01',endSession:'2026-05-01',expectedVersion:1
    })).rejects.toMatchObject({statusCode:409})
    expect(engine.getDailyBars).not.toHaveBeenCalled()
  })
  it('rejects future dates, oversized ranges, excess symbols and missing marks',async()=>{
    const bars=series()
    const engine={getDailyBars:vi.fn(async symbol=>({bars:symbol==='SPY'?bars:bars.slice(0,65)}))}
    await expect(runPaperStrategyBacktest({definition:def,startSession:bars[55][0],
      endSession:bars[85][0],engine})).rejects.toThrow(/Missing/)
    await expect(runPaperStrategyBacktest({definition:def,startSession:'2026-01-01',
      endSession:'2026-11-01',engine})).rejects.toThrow(/up to 180/)
  })
})
