const validDate = value => {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

/**
 * Read-only chronological presentation. A matching ticker does not imply
 * causal linkage between an AI research proposal and a paper execution.
 */
export function buildTraderJournal({ research = [], orders = [], hypotheses = [] } = {}) {
  const outcomes = new Map((Array.isArray(hypotheses) ? hypotheses : [])
    .filter(h => h?.symbol && h?.asOfSession && h?.action)
    .map(h => [[h.symbol, h.asOfSession, h.action].join(':'),h]))
  const rows=[]
  for (const cycle of (Array.isArray(research) ? research : [])) {
    const at=validDate(cycle.createdAt) || validDate(cycle.asOfSession+'T21:00:00Z')
    if(!at)continue
    for (const decision of (Array.isArray(cycle.decisions) ? cycle.decisions : [])) {
      if(!decision.symbol || !decision.action)continue
      const match=outcomes.get([decision.symbol,cycle.asOfSession,decision.action].join(':')) || null
      rows.push({id:'decision:'+cycle.id+':'+decision.symbol,kind:'decision',at,
        session:cycle.asOfSession,symbol:decision.symbol,action:decision.action,
        thesis:decision.thesis || null,evidence:decision.evidence || [],risks:decision.risks || [],
        outcome:match && Number.isFinite(match.forwardMovePct) ? match : null})
    }
  }
  for (const order of (Array.isArray(orders) ? orders : [])) {
    const at=validDate(order.filledAt) || validDate(order.createdAt)
    if(!at || !order.symbol)continue
    const filled=Number(order.filledQuantity)>0 && Number.isFinite(Number(order.filledPrice)) && Number(order.filledPrice)>0
    rows.push({id:'order:'+order.id,kind:'order',at,symbol:order.symbol,
      action:String(order.direction||'').toUpperCase(),status:order.status || 'unknown',
      filled,filledQuantity:filled?Number(order.filledQuantity):null,
      filledPrice:filled?Number(order.filledPrice):null})
  }
  return rows.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,80)
}
