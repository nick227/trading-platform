import { useMemo, useState } from 'react'
import { buildTraderJournal } from './traderJournal'
import { money, sessionDate, signedPct, tone } from '../../ui/format'

export default function TraderDecisionJournal({ research, orders, intelligence }) {
  const [mode,setMode]=useState('all')
  const entries=useMemo(()=>buildTraderJournal({
    research,orders,hypotheses:intelligence?.attribution?.recentHypotheses
  }),[research,orders,intelligence])
  const visible=entries.filter(item=>mode==='all' || item.kind===mode)
  return <section className="tl-section" id="ai-trader-decisions"
    aria-labelledby="ai-trader-journal-title" data-testid="trader-decision-journal">
    <div className="tl-section-head">
      <div><h2 id="ai-trader-journal-title" className="tl-section-title">AI decision journal</h2>
        <p className="tl-section-note">A dated account of what the AI proposed and what the paper simulator recorded. A research proposal does not confirm a trade.</p>
      </div>
    </div>
    <div className="tl-trader-journal-filters" role="group" aria-label="Journal events">
      {[['all','All activity'],['decision','AI decisions'],['order','Paper orders']].map(([id,label])=>
        <button type="button" key={id} className={mode===id?'tl-btn tl-btn--primary':'tl-btn tl-btn--secondary'}
          aria-pressed={mode===id} onClick={()=>setMode(id)}>{label}</button>)}
    </div>
    {!visible.length ? <p className="tl-section-note">No recorded {mode==='decision'?'AI decisions':mode==='order'?'paper orders':'activity'} available yet.</p> :
    <ol className="tl-trader-journal-list">
      {visible.map(item=><li key={item.id} className="tl-trader-journal-entry">
        <div className="tl-trader-journal-head">
          <div><strong>{item.symbol}</strong> · {item.kind==='decision'?'AI proposed '+item.action:'Paper order: '+item.action}
            <p className="tl-small tl-muted">{sessionDate(item.session || item.at,{year:true})}</p>
          </div>
          <span className="tl-small">{item.kind==='decision'?'Research only':item.filled?'Recorded paper fill':'Order · '+item.status}</span>
        </div>
        {item.kind==='decision' ? <>
          {item.thesis && <p>{item.thesis}</p>}
          {item.outcome && <p className="tl-small">Subsequent stock price movement: <span className={tone(item.outcome.forwardMovePct)}>{signedPct(item.outcome.forwardMovePct)}</span>. This is not the bot's realized return.</p>}
          {item.risks?.length>0 && <details><summary>Recorded risks</summary>
            <ul>{item.risks.map((risk,i)=><li key={i}>{risk}</li>)}</ul></details>}
        </> : <p className="tl-small">{item.filled
          ? `Simulated fill: ${item.filledQuantity} shares at ${money(item.filledPrice)} · ${item.status}`
          : 'No filled quantity or price was confirmed for this order.'}</p>}
      </li>)}
    </ol>}
    <p className="tl-section-note">Journal entries are sorted by their recorded timestamps, not linked as causes and effects. The display is limited to the records returned by the public API.</p>
  </section>
}
