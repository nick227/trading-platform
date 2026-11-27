import { scoreStockBars } from '../ai/stockScreener.js'
import { calculateFifoAccounting } from '../botAccountingService.js'
import { validatePaperStrategy } from './paperStrategy.js'
import { ResearchPartnerInputError } from './mandate.js'
import { isExchangeTradingDay } from '../../utils/marketCalendar.js'

const DAY_MS = 86_400_000
const round = number => Number(number.toFixed(2))
const dateValid = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s+'T12:00:00Z'))
const completedDate = s => new Date(s+'T12:00:00Z').toISOString().slice(0,10) === s
const match = (rules, indicators) => rules.every(({field,operator,value}) => Number.isFinite(indicators?.[field]) &&
  (operator === 'gte' ? indicators[field] >= value : indicators[field] <= value))

/**
 * Deterministic, educational paper replay using completed-session signals and next-open fills.
 * No DB mutations, LLM, worker, brokerage, or live execution calls.
 */
export async function runPaperStrategyBacktest({
  definition, startSession, endSession, engine, initialCapital = 10000
}) {
  const spec = validatePaperStrategy(definition)
  if (!dateValid(startSession) || !dateValid(endSession) ||
      !completedDate(startSession) || !completedDate(endSession) ||
      endSession <= startSession ||
      Date.parse(endSession+'T12:00:00Z') - Date.parse(startSession+'T12:00:00Z') > 180*DAY_MS) {
    throw new ResearchPartnerInputError('Backtest requires valid dates spanning up to 180 days')
  }
  if (!engine || typeof engine.getDailyBars !== 'function' || !Number.isFinite(initialCapital) ||
      initialCapital < 1000 || initialCapital > 100000 ||
      spec.universe.symbols.length > 10) {
    throw new ResearchPartnerInputError('Backtest requires market data, 1–10 symbols and bounded paper capital')
  }
  const warmupStart = new Date(Date.parse(startSession+'T12:00:00Z') - 140*DAY_MS).toISOString().slice(0,10)
  const symbols = spec.universe.symbols
  const series = new Map()
  // Request bounded historical price series; do not issue hundreds of concurrent fetches.
  for (const symbol of ['SPY', ...symbols.filter(s => s !== 'SPY')]) {
    const response = await engine.getDailyBars(symbol, warmupStart, endSession)
    const bars = response?.bars
    if (!Array.isArray(bars) || !bars.length || bars.length > 500 ||
        bars.some(b => !Array.isArray(b) || b.length < 6 || typeof b[0] !== 'string' ||
          b[0] < warmupStart || b[0] > endSession)) {
      throw new Error('Incomplete or invalid historical price data for '+symbol)
    }
    for (let i=1; i<bars.length; i++) if (bars[i][0] <= bars[i-1][0]) {
      throw new Error('Nonchronological historical price data for '+symbol)
    }
    series.set(symbol,bars)
  }
  const marketSessions = series.get('SPY').map(b=>b[0])
    .filter(d=>d>=startSession && d<=endSession && isExchangeTradingDay(d))
  if (marketSessions.length < 5 || marketSessions.length > 130) {
    throw new Error('Insufficient or oversized exchange trading session sample')
  }
  const tickerHistory = new Map()
  for (const symbol of symbols) {
    const bars = series.get(symbol)
    const byDate = new Map(bars.map((bar,index)=>[bar[0],index]))
    tickerHistory.set(symbol,{bars,byDate})
  }
  const positions = new Map()
  const pending = new Map()
  const lastPrices = new Map()
  const fills=[]
  const equityCurve=[]
  let cash=initialCapital
  let peak=initialCapital
  let maxDrawdownPct=0

  for (const session of marketSessions) {
    // Fill signals decided on the previous completed session at today's open.
    const planned = pending.get(session) || []
    planned.sort((a,b)=>(a.side==='sell'?-1:1)-(b.side==='sell'?-1:1)||
      a.symbol.localeCompare(b.symbol))
    let opened=0
    for (const order of planned) {
      const dayIndex=tickerHistory.get(order.symbol)?.byDate.get(session)
      if (dayIndex===undefined) throw new Error('Missing next-open bar for '+order.symbol+' '+session)
      const open=Number(tickerHistory.get(order.symbol).bars[dayIndex][1])
      if (!(open>0) || !Number.isFinite(open)) throw new Error('Invalid next-open mark')
      const held=positions.get(order.symbol)||0
      if (order.side==='sell' && held>0) {
        const qty=held
        positions.delete(order.symbol)
        cash+=qty*open
        fills.push({id:'sim_'+fills.length,ticker:order.symbol,direction:'sell',filledQuantity:qty,
          filledPrice:open,fees:0,commission:0,simSession:session,filledAt:session+'T12:00:00.000Z',
          signalSession:order.signalSession,status:'filled'})
      } else if (order.side==='buy' && !held && opened<spec.risk.maxOrdersPerCycle) {
        const equityAtOpen=cash+[...positions].reduce((sum,[symbol,qty])=>{
          const row=tickerHistory.get(symbol)
          const idx=row.byDate.get(session)
          if(idx===undefined) throw new Error('Missing open mark for held '+symbol)
          return sum+qty*row.bars[idx][1]
        },0)
        const spend=Math.min(cash,spec.risk.maxOrderNotional,equityAtOpen*spec.risk.maxPositionPct)
        const qty=Math.floor(spend/open)
        if(qty<1) continue
        cash-=qty*open
        positions.set(order.symbol,qty)
        opened++
        fills.push({id:'sim_'+fills.length,ticker:order.symbol,direction:'buy',filledQuantity:qty,
          filledPrice:open,fees:0,commission:0,simSession:session,filledAt:session+'T12:00:00.000Z',
          signalSession:order.signalSession,status:'filled'})
      }
    }
    pending.delete(session)
    let marketValue=0
    for(const [symbol,qty] of positions) {
      const row=tickerHistory.get(symbol)
      const idx=row.byDate.get(session)
      if(idx===undefined) throw new Error('Missing closing mark for held '+symbol)
      const close=Number(row.bars[idx][4])
      if(!(close>0)||!Number.isFinite(close))throw new Error('Invalid closing mark')
      lastPrices.set(symbol,close)
      marketValue+=qty*close
    }
    const equity=cash+marketValue
    peak=Math.max(peak,equity)
    maxDrawdownPct=Math.max(maxDrawdownPct,100*(peak-equity)/peak)
    equityCurve.push({session,equity:round(equity),cash:round(cash),marketValue:round(marketValue)})
    // No signal is allowed to trade at the same close that generated it.
    const index=marketSessions.indexOf(session)
    if(index>=marketSessions.length-1)continue
    const nextSession=marketSessions[index+1]
    if(spec.cadence==='weekly' && index%5!==0)continue
    for(const symbol of symbols) {
      const row=tickerHistory.get(symbol)
      const lastIndex=row.byDate.get(session)
      if(lastIndex===undefined||lastIndex<50)continue
      const assessment=scoreStockBars(symbol,row.bars.slice(0,lastIndex+1),session)
      if(!assessment.eligible)continue
      const held=positions.get(symbol)||0
      if(held && spec.exitRules.length && match(spec.exitRules,assessment.indicators)) {
        if(!pending.has(nextSession))pending.set(nextSession,[])
        pending.get(nextSession).push({side:'sell',symbol,signalSession:session})
      } else if(!held && match(spec.entryRules,assessment.indicators)) {
        if(!pending.has(nextSession))pending.set(nextSession,[])
        pending.get(nextSession).push({side:'buy',symbol,signalSession:session})
      }
    }
  }
  const accounting=calculateFifoAccounting(fills,{currentPrices:Object.fromEntries(lastPrices)})
  const endingEquity=equityCurve.at(-1).equity
  return {
    methodology:'next_open_paper_replay_v1',version:1,
    startSession,endSession,initialCapital,endingEquity,
    returnPct:round(100*(endingEquity/initialCapital-1)),
    maxDrawdownPct:round(maxDrawdownPct),
    sessions:marketSessions.length,
    fillCount:fills.length,
    realizedPnl:accounting.performance?.realizedPnl??0,
    equityCurve,fills,
    assumptions:{
      decision:'Completed-session close',
      execution:'Next exchange-session open',
      commission:0,slippage:0,shareType:'whole_shares',
      marketData:'Historical OHLCV from Alpha Engine',
      limitations:'Historical replay only; excludes spreads, slippage, commissions, liquidity constraints and intraday stops.'
    }
  }
}
