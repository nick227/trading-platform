import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadPublicStrategies, summaryLine } from '../../strategies/strategiesApi'

const STRATEGY = 'tmpl_ai_catalyst_momentum'

function StrategyEvidence() {
  const [result,setResult] = useState({status:'loading',rows:[]})
  useEffect(()=>{
    let active = true
    loadPublicStrategies()
      .then(data=>{if(active)setResult({status:'ready',rows:Array.isArray(data)?data:[]})})
      .catch(()=>{if(active)setResult({status:'error',rows:[]})})
    return ()=>{active=false}
  },[])
  if (result.status==='loading') return <div className="tl-public-panel tl-public-result-state" role="status">Loading published strategy evidence…</div>
  if (result.status==='error') return <div className="tl-public-panel tl-public-result-state" role="status">Strategy data is temporarily unavailable. <Link to="/strategies">Browse strategies</Link></div>
  if (result.rows.length===0) return <div className="tl-public-panel tl-public-result-state">No published strategy results yet. <Link to="/strategies">View strategies</Link></div>
  const ordered = [...result.rows].sort((a,b)=>Number(b.templateId===STRATEGY)-Number(a.templateId===STRATEGY)).slice(0,3)
  return <div className="tl-public-results-grid">{ordered.map(row=>{
    const ai = row.templateId===STRATEGY || row.tags?.includes('ai')
    const evidence = ai?row.windows?.forward:row.windows?.['1Y']
    return <article className="tl-public-panel tl-public-result" key={row.templateId}>
      <span className="tl-public-result-type">{ai?'AI-MANAGED · FORWARD PAPER':'STRATEGY · HISTORICAL TEST'}</span>
      <h3>{row.name||row.title||row.templateId}</h3>
      <p>{summaryLine(evidence)}</p>
      <span className="tl-public-result-meta">{evidence?.status==='ok'?'Published evidence':'Evidence still accumulating'}</span>
      <Link to={`/strategies/${encodeURIComponent(row.templateId)}`} className="tl-public-result-link">Inspect results and methodology →</Link>
    </article>
  })}</div>
}

export default function LiveBotsSection() {
  const [visible,setVisible]=useState(false)
  useEffect(()=>{
    if(typeof IntersectionObserver==='undefined'){setVisible(true);return}
    const el=document.getElementById('public-live-evidence')
    if(!el){setVisible(true);return}
    const observer=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'320px'})
    observer.observe(el)
    return ()=>observer.disconnect()
  },[])
  return <section className="tl-public-section" id="public-live-evidence" aria-labelledby="live-evidence-title">
    <header className="tl-public-section-head">
      <p className="tl-public-eyebrow">REAL PLATFORM EVIDENCE</p>
      <h2 id="live-evidence-title">See what the bots actually do.</h2>
      <p>Real published strategy records, not fabricated marketing results. Forward paper trading and historical tests are labeled separately, including losses and inactive strategies.</p>
    </header>
    <div className="tl-public-evidence-area">{visible?<StrategyEvidence/>:<div className="tl-public-panel tl-public-result-state" aria-hidden="true">Strategy evidence</div>}</div>
    <p className="tl-public-disclosure">Returns are simulated or historical, not returns earned by customers. Data updates after publication; results can be negative. Past performance is not predictive.</p>
    <Link className="tl-public-text-link" to="/strategies">See every public strategy →</Link>
  </section>
}
