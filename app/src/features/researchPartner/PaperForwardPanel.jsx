import { useEffect, useState } from 'react'
import {
  getPaperForwardAccount, activatePaperForward, runPaperForwardCycle, setPaperForwardStatus
} from './researchPartnerApi'
const describe=e=>e?.serverMessage||e?.message||'Paper session failed'

export default function PaperForwardPanel({partnerId,strategy}){
  const [account,setAccount]=useState(null)
  const [confirm,setConfirm]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const load=async()=>{
    try{setAccount(await getPaperForwardAccount(partnerId,strategy.id))}
    catch(e){
      if(e?.status===404||e?.statusCode===404||e?.response?.status===404) setAccount(null)
      else throw e
    }
  }
  useEffect(()=>{
    let active=true
    getPaperForwardAccount(partnerId,strategy.id).then(row=>{if(active)setAccount(row)})
      .catch(e=>{
        if(!active)return
        if(e?.status===404||e?.statusCode===404||e?.response?.status===404)setAccount(null)
        else setError(describe(e))
      })
    return()=>{active=false}
  },[partnerId,strategy.id])
  async function act(fn,success){
    if(busy)return
    setBusy(true);setError('');setNotice('')
    try{await fn();await load();setNotice(success)}
    catch(e){setError(describe(e))}
    finally{setBusy(false)}
  }
  const recent=account?.cycles?.[0]
  return <section className="rp-forward-panel" aria-label={'Forward paper simulator '+strategy.name}>
    <h4>Forward paper simulator</h4>
    <p className="tl-section-note">Replay one completed exchange session at a time. Signals are evaluated at close; fills use the next session's opening price. There is no real brokerage connection or automatic scheduler.</p>
    {error&&<p role="alert" className="tl-notice tl-notice--error">{error}</p>}
    {notice&&<p role="status" className="tl-section-note">{notice}</p>}
    {!account?<div className="rp-forward-activate">
      <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>
        I authorize paper-only simulation for this approved strategy. No real orders will be placed.</label>
      <button className="tl-btn tl-btn--secondary" type="button" disabled={busy||!confirm}
        onClick={()=>act(()=>activatePaperForward(partnerId,strategy.id,{
          expectedVersion:strategy.currentVersion,confirmation:'PAPER_ONLY'
        }),'Simulated account activated. No trades have been executed.')}>
        Activate paper simulation
      </button>
    </div>:<div>
      <p className="tl-small tl-muted">Approved version {account.version} · {account.status} · $10,000 simulated starting capital</p>
      <p className="tl-small">Next session to process: <strong>{account.nextSession}</strong></p>
      <div className="rp-monitor-actions">
        {account.status==='active'&&<button className="tl-btn tl-btn--secondary" type="button"
          disabled={busy||account.nextSession>account.latestCompletedSession}
          onClick={()=>act(()=>runPaperForwardCycle(partnerId,strategy.id,account.nextSession),
            'Completed paper session recorded.')}>Process completed paper session</button>}
        <button className="tl-btn tl-btn--secondary" type="button" disabled={busy}
          onClick={()=>act(()=>setPaperForwardStatus(partnerId,strategy.id,
            account.status==='active'?'paused':'active'),'Paper simulation status changed.')}>
          {account.status==='active'?'Pause simulation':'Resume simulation'}
        </button>
      </div>
      {recent&&<div className="rp-forward-result">
        <strong>Last completed paper session: {recent.session}</strong>
        <p>Simulated equity: {Number(recent.result.equity).toLocaleString('en-US',{style:'currency',currency:'USD'})}
          {' · '}Total paper return: {recent.result.returnPct}%</p>
        <p className="tl-small tl-muted">{recent.result.filled?.length||0} simulated fills · {recent.result.queued?.length||0} next-session signals · {recent.result.rejected?.length||0} rejected orders</p>
      </div>}
    </div>}
  </section>
}
