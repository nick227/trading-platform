import { useEffect, useState } from 'react'
import PaperStrategyTestingJourney from './PaperStrategyTestingJourney'
import StrategyResultsEvidence from './StrategyResultsEvidence'
import { summarizeStrategy } from './strategyRuleSummary'
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
  const [instruction,setInstruction]=useState(()=>{
    const finding=session?.status==='completed'&&session?.report?.findings?.[0]
    return finding ? `Explore paper rules for this research hypothesis: ${finding.claim}`.slice(0,3000) : ''
  })
  const [proposal,setProposal]=useState(null)
  const [step,setStep]=useState('idea')
  const [testingStrategyId,setTestingStrategyId]=useState(null)
  const [resultsStrategyId,setResultsStrategyId]=useState(null)
  const [strategies,setStrategies]=useState([])
  const [linkResearch,setLinkResearch]=useState(Boolean(session?.status==='completed'&&session?.report?.findings?.length))
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
  const setRule=(group,index,field,value)=>setForm(prev=>({
    ...prev,[group]:prev[group].map((rule,i)=>i===index?{...rule,[field]:value}:rule)
  }))
  const addRule=group=>setForm(prev=>({
    ...prev,[group]:prev[group].length>=8?prev[group]:[
      ...prev[group],{field:'return20dPct',operator:'gte',value:5}
    ]
  }))
  const removeRule=(group,index)=>setForm(prev=>({
    ...prev,[group]:prev[group].length===(group==='entryRules'?1:0)
      ?prev[group]:prev[group].filter((_,i)=>i!==index)
  }))
  const useSpec=spec=>{
    setForm(spec)
    setTickerText(spec.universe.symbols.join(', '))
    setProposal(null)
    setStep('rules')
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
      setStep('saved')
      setNotice('Paper strategy draft saved. It cannot place orders.')
    })
  }
  async function approve(item){
    await perform(async()=>{
      await approveResearchPaperStrategy(partnerId,item.id,item.currentVersion)
      await load()
      setStep('saved')
      setNotice('Definition approved. Automatic trading remains disabled.')
    })
  }
  const readable=summarizeStrategy(current())
  return <section className="tl-section rp-strategy-studio" aria-label="Paper strategy studio">
    <header className="rp-strategy-journey-head">
      <h2 className="tl-section-title">Create a paper strategy</h2>
      <p className="tl-section-note">Describe an investment idea, review measurable rules, then save and approve the definition. This process does not place trades.</p>
      <ol className="rp-strategy-steps" aria-label="Strategy creation progress">
        {[
          ['idea','Idea'],['rules','Rules'],['saved','Approval']
        ].map(([id,label],i)=><li key={id} aria-current={step===id?'step':undefined}
          className={step===id?'is-current':''}>{i+1}. {label}</li>)}
      </ol>
    </header>
    {error&&<p role="alert" className="tl-notice tl-notice--error">{error}</p>}
    {notice&&<p role="status" className="tl-section-note">{notice}</p>}
    {step==='idea'&&<section className="rp-strategy-stage" aria-label="Describe strategy idea">
      <h3>What is your investment idea?</h3>
      <p className="tl-section-note">The AI can suggest rules using supported indicators. It needs specific stocks and a measurable condition. AI interpretation uses the configured research budget.</p>
      {session?.status==='completed'&&session.report?.findings?.length>0&&
        <p className="tl-section-note">From research: {session.question}. The first finding is prefilled as an editable idea; it is not verified trading evidence.</p>}
      <form className="rp-form" onSubmit={previewAI}>
        <label htmlFor="rp-strategy-instructions">Describe the idea and the stocks to evaluate</label>
        <textarea id="rp-strategy-instructions" maxLength={3000} required rows={4}
          value={instruction} onChange={e=>setInstruction(e.target.value)}
          placeholder="Evaluate AAPL and MSFT when 20-session price momentum reaches five percent." />
        <button type="submit" className="tl-btn tl-btn--primary" disabled={busy}>Suggest paper rules with AI</button>
      </form>
      {proposal&&<div className="rp-strategy-preview">
        <h3>Proposed rules — not saved</h3>
        <p>{proposal.name} · {proposal.universe.symbols.join(', ')}</p>
        <ul>{summarizeStrategy(proposal).entries.map((rule,i)=><li key={i}>{rule}</li>)}</ul>
        <p className="tl-section-note">The proposal must be reviewed and edited before it can be saved.</p>
        <button className="tl-btn tl-btn--primary" type="button" onClick={()=>useSpec(proposal)}>Review these rules</button>
      </div>}
      <button className="tl-btn tl-btn--secondary" type="button"
        disabled={busy} onClick={()=>setStep('rules')}>Define rules without AI</button>
      {strategies.length>0&&<button type="button" className="tl-btn tl-btn--secondary"
        onClick={()=>setStep('saved')}>View saved strategies</button>}
    </section>}
    {step==='rules'&&<section className="rp-strategy-stage" aria-label="Review paper strategy rules">
      <h3>Review your paper trading rules</h3>
      <p className="tl-section-note">These measurable rules are checked by the existing deterministic strategy engine, not by an AI model placing trades.</p>
      <div className="rp-rule-summary" aria-label="Plain-language strategy summary">
        <p><strong>Stocks:</strong> {readable.universe}</p>
        <p><strong>Evaluation:</strong> {readable.cadence}</p>
        <p><strong>Entry conditions:</strong> {readable.entries.join(' and ')||'Not set'}</p>
        <p><strong>Exit conditions:</strong> {readable.exits.join(' and ')||'No exit rule specified'}</p>
        <p><strong>Maximum position:</strong> {readable.position}</p>
        <p><strong>Maximum simulated order:</strong> {readable.order}</p>
      </div>
      <form className="rp-form rp-strategy-fields" onSubmit={create}>
        <h3>Refine the rules</h3>
        <label htmlFor="rp-strategy-name">Strategy name</label>
        <input id="rp-strategy-name" required maxLength={120} value={form.name}
          onChange={e=>set('name',e.target.value)} />
        <label htmlFor="rp-strategy-symbols">Stock symbols (comma separated)</label>
        <input id="rp-strategy-symbols" required value={tickerText}
          onChange={e=>setTickerText(e.target.value)} />
        <label htmlFor="rp-strategy-cadence">How often to evaluate</label>
        <select id="rp-strategy-cadence" value={form.cadence} onChange={e=>set('cadence',e.target.value)}>
          <option value="daily">Each trading day</option><option value="weekly">Weekly</option>
        </select>
        {[
          ['entryRules','When to consider entering'],
          ['exitRules','When to consider exiting']
        ].map(([group,label])=><fieldset className="rp-strategy-rule-group" key={group}>
          <legend>{label}</legend>
          <p className="tl-small tl-muted">{group==='entryRules'
            ? 'All entry conditions must match for a simulated purchase.'
            : 'Optional exit conditions. All specified conditions must match.'}</p>
          {form[group].map((rule,index)=><div className="rp-strategy-rule" key={index}>
            <label htmlFor={`rp-${group}-field-${index}`}>Signal {index+1}</label>
            <select id={`rp-${group}-field-${index}`} value={rule.field}
              onChange={e=>setRule(group,index,'field',e.target.value)}>
              {FIELDS.map(([key,title])=><option value={key} key={key}>{title}</option>)}
            </select>
            <label htmlFor={`rp-${group}-operator-${index}`}>Condition</label>
            <select id={`rp-${group}-operator-${index}`} value={rule.operator}
              onChange={e=>setRule(group,index,'operator',e.target.value)}>
              <option value="gte">At least</option><option value="lte">At most</option>
            </select>
            <label htmlFor={`rp-${group}-threshold-${index}`}>Threshold</label>
            <input id={`rp-${group}-threshold-${index}`} type="number" step="any" required
              value={rule.value} onChange={e=>setRule(group,index,'value',Number(e.target.value))}/>
            {(group==='exitRules'||form.entryRules.length>1)&&
              <button type="button" className="tl-btn tl-btn--secondary" disabled={busy}
                onClick={()=>removeRule(group,index)}>Remove condition {index+1}</button>}
          </div>)}
          {form[group].length<8&&<button type="button" className="tl-btn tl-btn--secondary"
            disabled={busy} onClick={()=>addRule(group)}>Add {group==='entryRules'?'entry':'exit'} condition</button>}
        </fieldset>)}
        <details className="rp-strategy-advanced">
          <summary>Risk limits and additional settings</summary>
          <div className="rp-form">
            <label htmlFor="rp-strategy-position">Maximum position allocation (%)</label>
            <input id="rp-strategy-position" type="number" min="1" max="20" step="1"
              value={form.risk.maxPositionPct*100} onChange={e=>setRisk('maxPositionPct',Number(e.target.value)/100)}/>
            <label htmlFor="rp-strategy-notional">Maximum paper order ($)</label>
            <input id="rp-strategy-notional" type="number" min="1" max="2000" step="1"
              value={form.risk.maxOrderNotional} onChange={e=>setRisk('maxOrderNotional',Number(e.target.value))}/>
          </div>
        </details>
        {session?.status==='completed'&&session.report?.findings?.length>0&&<div className="rp-strategy-research">
          <p className="tl-section-note">Selected research: {session.question}. The original findings and source references will be linked when you save.</p>
          <label><input type="checkbox" checked={linkResearch} onChange={e=>setLinkResearch(e.target.checked)}/>
            Link this strategy to the selected research finding</label>
          {linkResearch&&<select aria-label="Research finding" value={findingIndex} onChange={e=>setFindingIndex(e.target.value)}>
            {session.report.findings.map((finding,i)=><option key={i} value={i}>{finding.assessment}: {finding.claim}</option>)}
          </select>}
        </div>}
        <button type="submit" className="tl-btn tl-btn--primary" disabled={busy}>Save paper strategy draft</button>
      </form>
      <button type="button" className="tl-btn tl-btn--secondary" disabled={busy}
        onClick={()=>setStep('idea')}>Back to idea</button>
    </section>}
    {step==='saved'&&<section className="rp-strategy-stage" aria-label="Review saved strategies">
      <h3>Saved paper strategies</h3>
      <p className="tl-section-note">A draft needs explicit approval before testing. Approval authorizes a paper definition only; it does not activate trading.</p>
      {!strategies.length&&<p>No saved strategies yet.</p>}
      {strategies.map(item=><article key={item.id} className="rp-strategy-item">
        <strong>{item.name}</strong>
        <p className="tl-small tl-muted">Version {item.currentVersion} · {item.status.replaceAll('_',' ')} · Paper definition only</p>
        {item.versions?.[0]?.provenance?.kind==='research_finding'&&
          <p className="tl-small">Linked to investigation {item.versions[0].provenance.sessionId}</p>}
        {item.status==='draft'&&<button type="button" className="tl-btn tl-btn--primary"
          disabled={busy} onClick={()=>approve(item)}>Approve paper definition</button>}
        {item.status==='approved_paper_definition'&&<>
          <p className="tl-section-note">Approved paper definition. Testing and simulation do not authorize live trading.</p>
          {testingStrategyId===item.id ? <PaperStrategyTestingJourney
            key={item.id+'-'+item.currentVersion} partnerId={partnerId}
            strategy={item} onClose={()=>setTestingStrategyId(null)} /> :
            resultsStrategyId===item.id ? <StrategyResultsEvidence
              key={'results-'+item.id+'-'+item.currentVersion}
              partnerId={partnerId} strategy={item} onClose={()=>setResultsStrategyId(null)}/> :
            <div className="rp-strategy-review-actions">
              <button type="button" className="tl-btn tl-btn--primary" disabled={busy}
                onClick={()=>{setResultsStrategyId(null);setTestingStrategyId(item.id)}}>Test and simulate this strategy</button>
              <button type="button" className="tl-btn tl-btn--secondary" disabled={busy}
                onClick={()=>{setTestingStrategyId(null);setResultsStrategyId(item.id)}}>Review evidence and results</button>
            </div>}
        </>}
      </article>)}
      <button type="button" className="tl-btn tl-btn--secondary" disabled={busy}
        onClick={()=>setStep('idea')}>Create another strategy</button>
    </section>}
  </section>
}
