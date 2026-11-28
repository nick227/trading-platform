import { describe, expect, it } from 'vitest'
import { buildPaperEquityHistory } from '../../src/services/ai/paperEquityHistory.js'

const fill = (id, symbol, direction, qty, price, session) => ({
  id, ticker:symbol, direction, filledQuantity:qty, filledPrice:price,
  simSession:session, filledAt:session+'T21:00:00.000Z', fees:0
})
const bars = (rows) => rows.map(([d,close])=>[d,close,close,close,close,100])

describe('recorded daily paper equity',()=>{
  it('marks recorded buys and sells against closes, with same-period benchmark',()=>{
    const sessions=['2026-11-23','2026-11-24','2026-11-25']
    const history=buildPaperEquityHistory({
      allocatedCapital:10000,startSession:sessions[0],endSession:sessions[2],
      fills:[fill('b','AAPL','buy',1,100,sessions[0]),fill('s','AAPL','sell',1,110,sessions[2])],
      spyBars:bars([[sessions[0],500],[sessions[1],505],[sessions[2],510]]),
      barsBySymbol:new Map([['AAPL',bars([[sessions[0],100],[sessions[1],105],[sessions[2],110]])]])
    })
    expect(history.points.map(p=>p.v)).toEqual([10000,10005,10010])
    expect(history.points.map(p=>p.spy)).toEqual([10000,10100,10200])
    expect(history.omittedSessions).toBe(0)
  })
  it('omits sessions whose open holdings have no verified closing price',()=>{
    const history=buildPaperEquityHistory({allocatedCapital:10000,startSession:'2026-11-23',
      fills:[fill('b','AAPL','buy',1,100,'2026-11-23')],
      spyBars:bars([['2026-11-23',500],['2026-11-24',501]]),
      barsBySymbol:new Map([['AAPL',bars([['2026-11-23',100]])]])})
    expect(history.points).toHaveLength(1)
    expect(history.omittedSessions).toBe(1)
  })
  it('ignores invalid fill dates instead of assigning them to a market session',()=>{
    const result=buildPaperEquityHistory({allocatedCapital:10000,
      fills:[{id:'bad',ticker:'AAPL',direction:'buy',filledQuantity:1,filledPrice:100,filledAt:'invalid'}],
      spyBars:bars([['2026-11-23',500]]),
      barsBySymbol:new Map([['AAPL',bars([['2026-11-23',110]])]])})
    expect(result.points).toEqual([{t:'2026-11-23',v:10000,spy:10000}])
  })
  it('does not fabricate a history without validated capital',()=>{
    expect(buildPaperEquityHistory({allocatedCapital:null}).points).toEqual([])
    expect(buildPaperEquityHistory({allocatedCapital:0}).points).toEqual([])
  })
})
