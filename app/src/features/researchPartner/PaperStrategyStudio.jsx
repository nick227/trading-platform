import { useEffect, useState } from 'react'
import {
  listResearchPaperStrategies, createResearchPaperStrategy, createPaperStrategyFromResearch,
  previewPaperStrategyWithAI, approveResearchPaperStrategy
} from './researchPartnerApi'

const FIELDS = [
  ['return20dPct','20-session return (%)'],
  ['return5dPct','5-session return (%)'],
  ['volumeRatio','Volume ratio'],
  ['price','Last price'],
  ['sma20','20-session average'],
  ['sma50','50-session average']
]
const errorText = e => e?.serverMessage || e?.message || 'Strategy could not be saved'
const base = { name:'My paper strategy', mode:'paper', cadence:'daily',
  universe:{type:'watchlist',symbols:['AAPL']},
  entryRules:[{field:'return20dPct',operator:'gte',value:5}],
  exitRules:[],risk:{maxPositionPct:0.1,maxOrderNotional:1000,maxOrdersPerCycle:1} }

/** Manual rules remain editable even when generated from an AI suggestion. */
export default function PaperStrategyStudio({ partnerId, session }) {
  const [form,setForm]=useState(base)
  const [tickerText,setTickerText]=useState('AAPL')
  const [instruction,setInstruction]=useState('')
  const [proposal,setProposal]=useState(null)
  const [strategies,setStrategies]=useState([])
  const [linkResearch,setLinkResearch]=useState(false)
  const [findingIndex,setFindingIndex]=useState('0')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const load=async()=>setStrategies(await listResearchPaperStrategies(partnerId))
  useEffect(()=>{
    let active=true
    listResearchPaperStrategies(partnerId).then(x=>{if(active)setStrategies(x)})
      .catch(e=>{if(active)setError(errorText(e))})
    return()=>{active=false}
  },[partnerId])
  const set=(field,value)=>setForm(prev=>({...prev,[field]:value}))
  const setRisk=(field,value)=>setForm(prev=>({...prev,risk:{...prev.risk,[field]:value}}))
  const setEntry=(field,value)=>setForm(prev=>({...prev,entryRules:[{...prev.entryRules[0],[field]:value}]}))
  const useSpec=spec=>{
    setForm(spec)
    setTickerText(spec.universe.symbols.join(', '))
    setProposal(null)
  }
  const current=()=>({...form,universe:{type:'watchlist',
    symbols:tickerText.split(/[,\s]+/).filter(Boolean).map(x=>x.toUpperCase())}})
  async function perform(action) {
    if(busy)return
    setBusy(true);setError('');setNotice('')
    try{await action()}catch(e){setError(errorText(e))}
    finally{setBusy(false)}
  }
  async function previewAI(event){
    event.preventDefault()
    await perform(async()=>{
      const suggested=await previewPaperStrategyWithAI(partnerId,instruction)
      setProposal(suggested.definition)
      setNotice('AI suggested a draft. Review and edit its numerical rules before saving.')
    })
  }
  async function create(event){
    event.preventDefault()
    await perform(async()=>{
      const definition=current()
      const fromSession=linkResearch&&session?.status==='completed'&&session.report?.findings?.length>0
      if(fromSession){
        await createPaperStrategyFromResearch(partnerId,{
          sessionId:session.id,findingIndex:Number(findingIndex),definition
        })
      }else await createResearchPaperStrategy(partnerId,definition)
      await load()
      setNotice('Paper strategy draft saved. It cannot place orders.')
    })
  }
  async function approve(item){
    await perform(async()=>{
      await approveResearchPaperStrategy(partnerId,item.id,item.currentVersion)
      await load()
      setNotice('Definition approved. Automatic trading remains disabled.')
    })
  }
  return <section className="tl-section rp-strategy-studio" aria-label="Paper strategy studio">
    <div className="tl-section-head"><h2 className="tl-section-title">Paper Strategy Studio</h2></div>
    <p className="tl-section-note">Translate an investment idea into measurable rules. Strategies here are definitions only and cannot place orders.</p>
    {error&&<p role="alert" className="tl-notice tl-notice--error">{error}</p>}
    {notice&&<p role="status" className="tl-section-note">{notice}</p>}
    <form className="rp-form" onSubmit={previewAI}>
      <label htmlFor="rp-strategy-instructions">Describe the strategy you have in mind</label>
      <textarea id="rp-strategy-instructions" maxLength={3000} required rows={3}
        value={instruction} onChange={e=>setInstruction(e.target.value)}
        placeholder="Track AAPL and MSFT when 20-session momentum exceeds five percent..." />
      <button type="submit" className="tl-btn tl-btn--secondary" disabled={busy}>Generate AI strategy preview</button>
    </form>
    {proposal&&<div className="rp-strategy-preview">
      <h3>Proposed paper rules</h3>
      <p>{proposal.name} · {proposal.universe.symbols.join(', ')}</p>
      <p className="tl-section-note">{proposal.entryRules.map(r=>r.field+' '+r.operator+' '+r.value).join(' and ')}</p>
      <button className="tl-btn tl-btn--secondary" type="button" onClick={()=>useSpec(proposal)}>Edit these rules</button>
      <p className="tl-small tl-muted">This AI proposal is not saved or executable.</p>
    </div>}
    <form className="rp-form rp-strategy-fields" onSubmit={create}>
      <h3>Define and review the rules</h3>
      <label htmlFor="rp-strategy-name">Strategy name</label>
      <input id="rp-strategy-name" required maxLength={120} value={form.name}
        onChange={e=>set('name',e.target.value)} />
      <label htmlFor="rp-strategy-symbols">Stock symbols (comma separated)</label>
      <input id="rp-strategy-symbols" required value={tickerText}
        onChange={e=>setTickerText(e.target.value)} />
      <label htmlFor="rp-strategy-cadence">Research cadence</label>
      <select id="rp-strategy-cadence" value={form.cadence} onChange={e=>set('cadence',e.target.value)}>
        <option value="daily">Daily</option><option value="weekly">Weekly</option>
      </select>
      <div className="rp-strategy-rule">
        <label htmlFor="rp-strategy-field">Entry signal</label>
        <select id="rp-strategy-field" value={form.entryRules[0].field} onChange={e=>setEntry('field',e.target.value)}>
          {FIELDS.map(([key,label])=><option key={key} value={key}>{label}</option>)}
        </select>
        <label htmlFor="rp-strategy-operator">Comparison</label>
        <select id="rp-strategy-operator" value={form.entryRules[0].operator} onChange={e=>setEntry('operator',e.target.value)}>
          <option value="gte">At least</option><option value="lte">At most</option>
        </select>
        <label htmlFor="rp-strategy-threshold">Threshold</label>
        <input id="rp-strategy-threshold" type="number" step="any" required
          value={form.entryRules[0].value} onChange={e=>setEntry('value',Number(e.target.value))}/>
      </div>
      <label htmlFor="rp-strategy-position">Maximum position allocation (%)</label>
      <input id="rp-strategy-position" type="number" min="1" max="20" step="1"
        value={form.risk.maxPositionPct*100} onChange={e=>setRisk('maxPositionPct',Number(e.target.value)/100)}/>
      <label htmlFor="rp-strategy-notional">Maximum paper order ($)</label>
      <input id="rp-strategy-notional" type="number" min="1" max="2000" step="1"
        value={form.risk.maxOrderNotional} onChange={e=>setRisk('maxOrderNotional',Number(e.target.value))}/>
      {session?.status==='completed'&&session.report?.findings?.length>0&&<div className="rp-strategy-research">
        <label><input type="checkbox" checked={linkResearch} onChange={e=>setLinkResearch(e.target.checked)}/>
          Attach a finding from this research report</label>
        {linkResearch&&<select aria-label="Research finding" value={findingIndex} onChange={e=>setFindingIndex(e.target.value)}>
          {session.report.findings.map((f,i)=><option key={i} value={i}>{f.assessment}: {f.claim}</option>)}
        </select>}
      </div>}
      <button type="submit" className="tl-btn tl-btn--primary" disabled={busy}>Save paper strategy draft</button>
    </form>
    {strategies.length>0&&<div className="rp-strategy-saved">
      <h3>Saved strategies</h3>
      {strategies.map(item=><article key={item.id} className="rp-strategy-item">
        <strong>{item.name}</strong>
        <p className="tl-small tl-muted">Version {item.currentVersion} · {item.status.replaceAll('_',' ')} · Paper definition only</p>
        {item.versions?.[0]?.provenance?.kind==='research_finding'&&
          <p className="tl-small">Linked to investigation {item.versions[0].provenance.sessionId}</p>}
        {item.status==='draft'&&<button type="button" className="tl-btn tl-btn--secondary"
          disabled={busy} onClick={()=>approve(item)}>Approve definition</button>}
      </article>)}
    </div>}
  </section>
}
