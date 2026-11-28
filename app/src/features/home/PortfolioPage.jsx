import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { loadHome } from './homeApi'
import { Portfolio, Holdings } from './HomeDashboard'
import { useBotControls } from '../../ui/useBotControls'
import { buildPortfolioNarrativeSummary } from '../../ui/narrativeSummaries'

/** Canonical portfolio route; uses the existing authenticated portfolio data source. */
export default function PortfolioPage() {
  const [params] = useSearchParams()
  const [state, setState] = useState({ status:'loading', data:null, error:null })
  const [open, setOpen] = useState(null)
  const load = useCallback(async () => {
    setState(current=>({ ...current, status:'loading' }))
    try { const data = await loadHome(); setState({ status:'ready', data, error:null }) }
    catch (error) { setState({ status:'error', data:null, error:error.message || 'Portfolio unavailable' }) }
  }, [])
  useEffect(()=>{ load() },[load])
  useEffect(()=>{
    const holding=params.get('holding')
    if (holding) setOpen(holding.toUpperCase())
  },[params])
  const controls = useBotControls(fn => setState(current => current.data
    ? { ...current, data:{ ...current.data, bots:fn(current.data.bots) } } : current))
  const data=state.data
  return <main className="tl-page tl-portfolio-page" data-testid="portfolio-page">
    <header className="tl-section">
      <div className="tl-section-head"><h1 className="tl-section-title">Portfolio</h1>
        <button type="button" className="tl-btn tl-btn--secondary"
          onClick={load} disabled={state.status==='loading'}>Refresh</button></div>
      <p className="tl-section-note">Your account value, holdings, and recorded trading performance. Simulated balances are identified below.</p>
    </header>
    {state.status==='loading' && <section className="tl-section" role="status">Loading portfolio…</section>}
    {state.status==='error' && <section className="tl-section" role="alert">{state.error}
      <button type="button" className="tl-btn tl-btn--secondary" onClick={load}>Retry</button></section>}
    {state.status==='ready' && data && <>
      <Portfolio valuation={data.valuation} history={data.history}
        error={data.valuationError}
        narrativeSummary={buildPortfolioNarrativeSummary({ valuation:data.valuation, bots:data.bots })}/>
      <Holdings valuation={data.valuation} bots={data.bots} open={open} setOpen={setOpen}
        busy={controls.busy} onToggleBot={controls.toggle}/>
      {!data.valuation?.positions?.length && <section className="tl-section">
        <h2 className="tl-section-title">No holdings yet</h2>
        <p>Build a trading bot to test automated stock purchases with a paper account.</p>
        <Link className="tl-btn tl-btn--primary" to="/bots/new">Create a bot</Link>
      </section>}
      <p className="tl-small tl-muted">{data.valuation?.simulated
        ? 'Simulated account. Figures are not real-money brokerage balances.'
        : 'Account mode and valuation are supplied by your connected account.'}</p>
    </>}
  </main>
}
