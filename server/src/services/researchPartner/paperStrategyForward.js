/**
 * Isolated forward paper simulator. Prices/indicator selection are derived from
 * Alpha Engine and bounded rules; risk and FIFO accounting are shared with the
 * existing flagship implementation. No broker/Execution/Portfolio writes.
 */
import { scoreStockBars } from '../ai/stockScreener.js'
import { reconcileStockTraderFills, calculateStockTraderSessionRealizedPnl } from '../ai/stockTraderAccounting.js'
import { evaluateStockTraderPaperProposal } from '../ai/stockTraderRiskPolicy.js'
import { nextStockTraderSession } from '../ai/stockTraderTradingSession.js'
import { validatePaperStrategy } from './paperStrategy.js'
import { ResearchPartnerInputError } from './mandate.js'
import { isExchangeTradingDay } from '../../utils/marketCalendar.js'

const DAY_MS=86_400_000
const round=n=>Math.round((n+Number.EPSILON)*100)/100
const ruleMatch=(rules, indicators)=>rules.every(r=>Number.isFinite(indicators?.[r.field])&&
  (r.operator==='gte'?indicators[r.field]>=r.value:indicators[r.field]<=r.value))
const maxFills=520
const maxCycles=260

export function newPaperForwardState(capital=10000) {
  if(!Number.isInteger(capital)||capital<1000||capital>100000)
    throw new ResearchPartnerInputError('Invalid simulation capital')
  return {initialCapital:capital,lastSession:null,pending:[],fills:[],
    equityCurve:[],peakEquity:capital}
}

export async function stepResearchPaperForward({definition,state,asOfSession,engine}) {
  const spec=validatePaperStrategy(definition)
  if(!state||!Number.isFinite(state.initialCapital)||!Array.isArray(state.fills)||
     !Array.isArray(state.pending)||!Array.isArray(state.equityCurve)||
     !engine?.getDailyBars||!/^\d{4}-\d{2}-\d{2}$/.test(asOfSession)||
     !isExchangeTradingDay(asOfSession)||
     (state.lastSession && nextStockTraderSession(state.lastSession)!==asOfSession)||
     (state.lastSession && state.lastSession>=asOfSession)||
     state.equityCurve.length>=maxCycles||state.fills.length>=maxFills||
     spec.universe.symbols.length>10) {
    throw new ResearchPartnerInputError('Invalid or out-of-order paper session')
  }
  const start=new Date(Date.parse(asOfSession+'T12:00:00Z')-140*DAY_MS).toISOString().slice(0,10)
  const marks=new Map()
  for(const symbol of spec.universe.symbols) {
    const result=await engine.getDailyBars(symbol,start,asOfSession)
    const bars=result?.bars
    if(!Array.isArray(bars)||!bars.length||bars.length>160||
       bars.at(-1)?.[0]!==asOfSession) {
      throw new Error('Missing exact-session market data: '+symbol)
    }
    const assessment=scoreStockBars(symbol,bars,asOfSession)
    const close=Number(bars.at(-1)[4])
    const open=Number(bars.at(-1)[1])
    if(!Number.isFinite(close)||close<=0||!Number.isFinite(open)||open<=0||
      !['invalid_bar','invalid_chronology','future_data'].includes(assessment.reason)===false) {
      // Malformed historical bars may not silently become valid marks.
      if(['invalid_bar','invalid_chronology','future_data'].includes(assessment.reason))
        throw new Error('Invalid market history: '+symbol)
    }
    marks.set(symbol,{open,close,assessment})
  }
  const fills=[...state.fills]
  const pending=state.pending.map(x=>({...x}))
  const openingQuotes=Object.fromEntries([...marks].map(([symbol,p])=>[symbol,p.open]))
  const closingQuotes=Object.fromEntries([...marks].map(([symbol,p])=>[symbol,p.close]))
  const initialCapital=state.initialCapital
  const snapshot=()=>reconcileStockTraderFills({
    fills,allocatedCapital:initialCapital,asOfSession,quotes:openingQuotes
  })
  const candidates=pending.filter(p=>p.targetSession===asOfSession)
    .sort((a,b)=>(a.side==='SELL'?-1:1)-(b.side==='SELL'?-1:1)||
      a.symbol.localeCompare(b.symbol))
  if(pending.some(p=>p.targetSession!==asOfSession))
    throw new Error('Unexecuted or out-of-order paper intent')
  const executed=[]
  const rejected=[]
  for(const intent of candidates) {
    if(executed.length>=spec.risk.maxOrdersPerCycle)break
    const price=marks.get(intent.symbol)?.open
    if(!price)throw new Error('Missing opening price for paper intent')
    const portfolio=snapshot()
    const sessionRealizedPnl=calculateStockTraderSessionRealizedPnl({
      fills,session:asOfSession
    })
    const proposal=evaluateStockTraderPaperProposal({
      intent:{symbol:intent.symbol,action:intent.side,confidence:1,
        targetAllocationPct:spec.risk.maxPositionPct},
      price,portfolio,activeOrders:[],executionLimits:spec.risk,sessionRealizedPnl
    })
    if(!proposal.allowed) {
      rejected.push({symbol:intent.symbol,side:intent.side,reason:proposal.reason})
      continue
    }
    const fill={id:'rp_sim_'+asOfSession.replaceAll('-','')+'_'+executed.length+'_'+intent.symbol,
      ticker:intent.symbol,direction:intent.side.toLowerCase(),
      filledQuantity:proposal.quantity,filledPrice:price,
      commission:0,fees:0,simSession:asOfSession,filledAt:asOfSession+'T12:00:00.000Z',
      signalSession:intent.signalSession,status:'filled'}
    fills.push(fill)
    executed.push(fill)
  }
  const equity=reconcileStockTraderFills({
    fills,allocatedCapital:initialCapital,asOfSession,quotes:closingQuotes
  })
  const peak=Math.max(state.peakEquity,equity.totalEquity)
  const curve=[...state.equityCurve,{
    session:asOfSession,equity:equity.totalEquity,cash:equity.cash,
    marketValue:round(equity.totalEquity-equity.cash)
  }]
  const newSignals=[]
  const nextSession=nextStockTraderSession(asOfSession)
  const evaluateNow=spec.cadence==='daily'||curve.length%5===1
  if(evaluateNow) {
    for(const [symbol,mark] of marks) {
      const item=mark.assessment
      if(!item.eligible)continue
      const holding=equity.positions.some(p=>p.symbol===symbol&&p.quantity>0)
      if(holding&&spec.exitRules.length&&ruleMatch(spec.exitRules,item.indicators)) {
        newSignals.push({symbol,side:'SELL',signalSession:asOfSession,targetSession:nextSession})
      }else if(!holding&&ruleMatch(spec.entryRules,item.indicators)) {
        newSignals.push({symbol,side:'BUY',signalSession:asOfSession,targetSession:nextSession})
      }
    }
  }
  newSignals.sort((a,b)=>(a.side==='SELL'?-1:1)-(b.side==='SELL'?-1:1)||
    a.symbol.localeCompare(b.symbol))
  const future=newSignals.slice(0,spec.risk.maxOrdersPerCycle)
  if(fills.length>maxFills)throw new Error('Paper fill storage limit reached')
  return {
    state:{...state,lastSession:asOfSession,pending:future,fills,equityCurve:curve,peakEquity:peak},
    event:{session:asOfSession,filled:executed,rejected,queued:future,
      equity:equity.totalEquity,cash:equity.cash,
      unrealizedPnl:equity.unrealizedPnl,realizedPnl:equity.realizedPnl,
      returnPct:round(100*(equity.totalEquity/initialCapital-1)),
      maxDrawdownPct:round(Math.max(...curve.map(c=>100*(peak-c.equity)/peak)))}
  }
}
