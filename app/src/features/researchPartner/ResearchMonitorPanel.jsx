import { useEffect, useState } from 'react'
import {
  createResearchMonitor, listResearchMonitors, checkResearchMonitor, setResearchMonitorStatus
} from './researchPartnerApi'
const errorText=e=>e?.serverMessage||e?.message||'Unable to update monitoring'
export default function ResearchMonitorPanel({partnerId,watchlist=[]}){
  const [monitors,setMonitors]=useState([])
  const [name,setName]=useState('Market research watch')
  const [symbols,setSymbols]=useState(watchlist.join(', '))
  const [cadence,setCadence]=useState('daily')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  useEffect(()=>{
    let active=true
    listResearchMonitors(partnerId).then(rows=>{if(active)setMonitors(rows)})
      .catch(e=>{if(active)setError(errorText(e))})
    return()=>{active=false}
  },[partnerId])
  const update=async action=>{
    if(busy)return
    setBusy(true);setError('');setNotice('')
    try{
      await action()
      setMonitors(await listResearchMonitors(partnerId))
    }catch(e){setError(errorText(e))}
    finally{setBusy(false)}
  }
  return <section className="tl-section rp-monitor-panel" aria-label="Research monitoring">
    <div className="tl-section-head"><h2 className="tl-section-title">Research monitoring</h2></div>
    <p className="tl-section-note">Watch for new financial news and SEC filings. New source material is not automatically a change in your research conclusion.</p>
    {error&&<p role="alert" className="tl-notice tl-notice--error">{error}</p>}
    {notice&&<p role="status" className="tl-section-note">{notice}</p>}
    <form className="rp-form" onSubmit={e=>{e.preventDefault();update(async()=>{
      await createResearchMonitor(partnerId,{name,symbols:symbols.split(/[,\s]+/).filter(Boolean),cadence})
      setNotice('Research monitor created. The first check establishes a baseline.')
    })}}>
      <label htmlFor="rp-monitor-name">Monitoring topic</label>
      <input id="rp-monitor-name" required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/>
      <label htmlFor="rp-monitor-symbols">Symbols to monitor</label>
      <input id="rp-monitor-symbols" required value={symbols} onChange={e=>setSymbols(e.target.value)}
        placeholder="AAPL, NVDA, MSFT" />
      <label htmlFor="rp-monitor-cadence">Check frequency</label>
      <select id="rp-monitor-cadence" value={cadence} onChange={e=>setCadence(e.target.value)}>
        <option value="daily">Daily</option><option value="weekly">Weekly</option>
      </select>
      <button className="tl-btn tl-btn--secondary" type="submit" disabled={busy}>Create monitor</button>
    </form>
    {monitors.length>0&&<div className="rp-monitor-history">
      {monitors.map(m=><article key={m.id} className="rp-monitor-item">
        <h3>{m.name}</h3>
        <p className="tl-small tl-muted">{(m.symbols||[]).join(', ')} · {m.cadence} · {m.status}</p>
        <p className="tl-small">Last checked: {m.lastCheckedAt?new Date(m.lastCheckedAt).toLocaleString():'Not checked yet'}</p>
        {m.lastError&&<p className="tl-small tl-muted">Last check error: {m.lastError}</p>}
        <div className="rp-monitor-actions">
          <button type="button" disabled={busy||m.status!=='active'} className="tl-btn tl-btn--secondary"
            onClick={()=>update(async()=>{
              const result=await checkResearchMonitor(partnerId,m.id)
              setNotice(result.additions?result.additions+' new evidence item(s) found.':'No new research evidence found.')
            })}>Check due evidence</button>
          <button type="button" disabled={busy} className="tl-btn tl-btn--secondary"
            onClick={()=>update(async()=>{
              await setResearchMonitorStatus(partnerId,m.id,m.status==='active'?'paused':'active')
              setNotice('Monitoring status updated.')
            })}>{m.status==='active'?'Pause':'Resume'}</button>
        </div>
        {m.events?.length>0&&<div className="rp-monitor-events">
          <strong>Recent evidence changes</strong>
          {m.events.map(ev=><div key={ev.id} className="rp-monitor-event">
            <p className="tl-small tl-muted">{new Date(ev.createdAt).toLocaleString()}</p>
            {(ev.payload?.newRecords||[]).map((r,i)=><p key={r.id||i}>
              {r.url?<a href={r.url} target="_blank" rel="noopener noreferrer">{r.title||r.source}</a>:(r.title||r.source)}
              <span className="tl-small tl-muted"> · {r.source}</span>
            </p>)}
          </div>)}
        </div>}
      </article>)}
    </div>}
  </section>
}
