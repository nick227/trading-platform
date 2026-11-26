import { useEffect, useState } from 'react'
import { get } from '../../../api/client'

/** Lightweight operational pulse. Never turns an unrecorded stage into success. */
export default function PipelinePulse() {
  const [state,setState]=useState({kind:'loading',data:null})
  useEffect(()=>{
    let mounted=true
    async function refresh() {
      try {
        const data=await get('/public/strategies/tmpl_ai_catalyst_momentum/pipeline')
        if(mounted)setState({kind:'ready',data})
      } catch {
        if(mounted)setState({kind:'error',data:null})
      }
    }
    refresh()
    const timer=setInterval(()=>{if(!document.hidden)refresh()},60000)
    return ()=>{mounted=false;clearInterval(timer)}
  },[])
  if(state.kind==='loading')return <p className="tl-public-pulse" role="status">Checking recent autonomous activity…</p>
  if(state.kind==='error')return <p className="tl-public-pulse">Latest pipeline activity is unavailable.</p>
  const data=state.data||{}
  const stages=Object.values(data.stages||{})
  const recorded=stages.filter(s=>s.status==='ok').length
  const session=stages.find(s=>s.session)?.session||data.expectedCompletedSession
  return <p className="tl-public-pulse">
    <strong>AI pipeline:</strong> {recorded===0?'No completed stages reported yet':`${recorded} of ${stages.length} stages completed`}
    {session?` · Session ${session}`:''}
    {' · '}<span>{data.pendingOrdersCount??'—'} pending paper orders</span>
  </p>
}
