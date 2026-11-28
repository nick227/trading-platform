import { useCallback, useEffect, useState } from 'react'
import { get } from '../../api/client'
import { useAuth } from '../../app/AuthProvider'
import { AiTradingIntroduction, AiTraderBotExplorer } from './AiTraderShowcase'
import PersonalAiTraderCard from './PersonalAiTraderCard'
import { money, signedMoney, ratioPct, sessionDate, shares, dateTime, tone } from '../../ui/format'
import TraderCandidateEvidence from './TraderCandidateEvidence'
import TraderStoryOverview from './TraderStoryOverview'
import TraderEquityHistory from './TraderEquityHistory'
import TraderDecisionJournal from './TraderDecisionJournal'
import PortfolioIntelligencePanel from './PortfolioIntelligencePanel'
import PerformanceIntelligencePanel from './PerformanceIntelligencePanel'
import { buildFlagshipNarrativeSummary } from '../../ui/narrativeSummaries'

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'research', label: 'Research' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'trades', label: 'Trades & holdings' }
]

function Stat({ label, value, detail }) {
  return <div className="tl-stat"><dt>{label}</dt><dd>{value}<small>{detail}</small></dd></div>
}

function FlagshipDetails({ data, state, refresh }) {
  const [view, setView] = useState('overview')
  return <>
    <div className="tl-ai-selected__actions">
      <div className="tl-ai-view-nav" role="group" aria-label="Flagship information">
        {VIEWS.map(item => <button key={item.id} type="button"
          className={view === item.id ? 'tl-ai-view-nav__button is-active' : 'tl-ai-view-nav__button'}
          aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}
      </div>
      <button type="button" className="tl-btn tl-btn--secondary tl-ai-refresh"
        disabled={state.status === 'loading'} onClick={refresh}>Refresh records</button>
    </div>
    {state.status === 'loading' && <div className="tl-ai-selected__empty" role="status">Loading the latest available paper-trading records…</div>}
    {state.status === 'error' && <div className="tl-ai-selected__empty" role="alert">Paper-trading data is temporarily unavailable. Retry to see verified results.</div>}
    {state.status === 'ready' && data?.status === 'not_initialized' && (
      <div className="tl-ai-selected__empty" data-testid="flagship-uninitialized">
        <h4>Awaiting beta initialization</h4>
        <p>There are no verified paper-trading results or AI research decisions to publish yet. The flagship's activity, decisions and paper portfolio will appear here when recorded.</p>
      </div>
    )}
    {state.status === 'ready' && data && data.status !== 'not_initialized' && <>
      {view === 'overview' && <>
        <TraderStoryOverview data={data} />
        {buildFlagshipNarrativeSummary(data) &&
          <p className="tl-ai-selected__record" data-testid="flagship-narrative-summary">{buildFlagshipNarrativeSummary(data)}</p>}
        <TraderEquityHistory intelligence={data.performanceIntelligence} initialCapital={data.capitalAllocated} />
        <details className="tl-ai-selected__details">
          <summary>Detailed performance and comparisons</summary>
          <section className="tl-section" id="ai-trader-history" aria-label="Paper portfolio performance">
            <h4>Paper performance</h4>
            {data.universePolicy && <span className="tl-tag" data-testid="flagship-universe-policy">
              {data.universePolicy.dynamicDiscoveryEnabled
                ? `Dynamic universe (${data.universePolicy.baseSymbolsCount} core + up to ${data.universePolicy.maxPromotions} promoted)`
                : `Curated universe (${data.universePolicy.baseSymbolsCount} core)`}
            </span>}
            <dl className="tl-stats tl-stats--3 tl-stat-grid--flush" data-testid="flagship-performance">
              <Stat label="Allocated paper capital" value={money(data.capitalAllocated)} detail="Simulated" />
              <Stat label="Total P&L" value={signedMoney(data.performance?.totalPnl)}
                detail={data.performance ? 'From recorded fills and available marks' : 'No verified fills yet'} />
              <Stat label="Filled executions" value={data.performance?.fillCount ?? '—'}
                detail={data.performance ? 'Recorded paper fills' : 'No verified fills yet'} />
            </dl>
          </section>
          {data.performanceIntelligence && <PerformanceIntelligencePanel intelligence={data.performanceIntelligence} />}
          {data.portfolioIntelligence && <PortfolioIntelligencePanel intelligence={data.portfolioIntelligence} />}
        </details>
      </>}
      {view === 'research' && <>
        {data.discovery && <TraderCandidateEvidence discovery={data.discovery} research={data.research} />}
      <details className="tl-section tl-trader-technical">
        <summary>Full technical research records</summary>
        <section className="tl-section" aria-labelledby="flagship-research-heading">
        <div className="tl-section-head"><h2 id="flagship-research-heading" className="tl-section-title">AI research and decisions</h2></div>
        {!data.research?.length ? <p data-testid="flagship-no-research">No completed AI research cycle has been recorded.</p> :
          <div className="tl-ai-feed">{data.research.map(cycle =>
            <article key={cycle.id} className="tl-card tl-card-shell tl-card-shell--compact">
              <h3>Research · {sessionDate(cycle.asOfSession, { year: true })}</h3>
              <p className="tl-small tl-muted">{cycle.model || 'Model unavailable'} · Generated {dateTime(cycle.createdAt)}</p>
              {cycle.marketSummary && <p>{cycle.marketSummary}</p>}
              {cycle.investigation && <details className="tl-flow-card" data-testid="flagship-investigation">
                <summary><strong>Inspect AI investigation details</strong>{cycle.investigation.focus ? ` · ${cycle.investigation.focus}` : ''}</summary>
                <p className="tl-small tl-muted" style={{ marginTop: '0.4rem' }}>Read-only tools: {cycle.investigation.toolsUsed?.length ? cycle.investigation.toolsUsed.join(', ').replaceAll('_', ' ') : 'None requested'} · Tool requests: {cycle.investigation.toolCalls} · Model calls: {cycle.investigation.modelCalls} · Earlier research cycles reviewed: {cycle.investigation.priorResearchCycles}</p>
              </details>}
              <div className="tl-ai-decisions">{cycle.decisions.map(decision =>
                <details key={decision.symbol} className="tl-flow-card">
                  <summary><strong>{decision.symbol}</strong> · <span className={decision.action === 'BUY' ? 'tl-pos' : decision.action === 'SELL' ? 'tl-neg' : 'tl-muted'}>{decision.action}</span> · Model conviction {ratioPct(decision.confidence, 0)}</summary>
                  <p>{decision.thesis}</p>
                  {decision.evidence?.length > 0 && <ul className="tl-backtest-notes">{decision.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                  {decision.risks?.length > 0 && <p className="tl-small">Risks: {decision.risks.join('; ')}</p>}
                </details>
              )}</div>
            </article>
          )}</div>}
        <p className="tl-section-note">Model conviction is not a calibrated probability of profit. Research proposals are not execution confirmations.</p>
      </section>
      </details>

      </>}
      {view === 'decisions' && <TraderDecisionJournal research={data.research} orders={data.orders}
        intelligence={data.performanceIntelligence} />}
      {view === 'trades' && <>
      <section className="tl-section" aria-label="Open paper positions">
        <div className="tl-section-head"><h2 className="tl-section-title">Holdings</h2></div>
        {!data.positions?.length ? <p data-testid="flagship-no-positions">No open paper positions.</p> :
          <details className="tl-flow-card" open={data.positions.length <= 5}>
            <summary><strong>Inspect holdings ({data.positions.length})</strong></summary>
            <table className="tl-table" style={{ marginTop: '0.5rem' }} data-testid="flagship-holdings"><thead><tr><th>Symbol</th><th className="r">Shares</th><th className="r">Last close</th><th className="r">Market value</th><th className="r">P&L</th></tr></thead>
              <tbody>{data.positions.map(p => <tr key={p.symbol}>
                <td className="tl-sym">{p.symbol}</td><td className="r">{shares(p.quantity)}</td>
                <td className="r">{money(p.lastPrice)}<span className="tl-sub">{sessionDate(p.asOfSession)}</span></td>
                <td className="r">{money(p.marketValue)}</td><td className={`r ${tone(p.unrealizedPnl)}`}>{signedMoney(p.unrealizedPnl)}</td>
              </tr>)}</tbody>
            </table>
          </details>}
      </section>
      <section className="tl-section" aria-label="Recent paper orders">
        <div className="tl-section-head"><h2 className="tl-section-title">Order history</h2></div>
        {!data.orders?.length ? <p data-testid="flagship-no-orders">No simulated orders have been recorded.</p> :
          <details className="tl-flow-card">
            <summary><strong>Inspect details · Recorded paper orders ({data.orders.length})</strong></summary>
            <table className="tl-table" style={{ marginTop: '0.5rem' }} data-testid="flagship-orders">
              <thead><tr><th>Symbol</th><th>Direction</th><th>Status</th><th className="r">Shares</th><th className="r">Fill price</th></tr></thead>
              <tbody>{data.orders.map(o => <tr key={o.id}>
                <td className="tl-sym">{o.symbol}</td><td>{o.direction}</td><td>{o.status}</td>
                <td className="r">{shares(o.filledQuantity ?? o.quantity)}</td><td className="r">{money(o.filledPrice)}</td>
              </tr>)}</tbody>
            </table>
          </details>}
      </section>

      </>}
    </>}
    <p className="tl-ai-selected__record">Public simulated account only. AI proposals are not confirmed executions. Historical results do not guarantee future returns.</p>
  </>
}

export default function StockTraderDashboard() {
  const { user, sessionLoading } = useAuth() || {}
  const [selected, setSelected] = useState('flagship')
  const [state, setState] = useState({ status: 'loading', data: null })
  const [personalStatus, setPersonalStatus] = useState(null)

  const refresh = useCallback(() => {
    setState(s => ({ ...s, status: 'loading' }))
    get('/public/ai-stock-trader')
      .then(data => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', data: null }))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  // Personal status is private: never request it for a guest.
  useEffect(() => {
    if (!user) { setPersonalStatus(null); return undefined }
    let current = true
    get('/ai/personal-trader')
      .then(result => {
        if (!current) return
        const payload = result?.data ?? result
        setPersonalStatus(payload?.lifecycle
          ? { status: 'ready', configured: Boolean(payload.configured), enabled: payload.bot?.enabled === true }
          : { status: 'unavailable' })
      })
      .catch(() => { if (current) setPersonalStatus({ status: 'unavailable' }) })
    return () => { current = false }
  }, [user?.id])

  return <main className="tl-page tl-flow-page tl-ai-page" data-testid="flagship-ai-dashboard">
    <AiTradingIntroduction />
    <AiTraderBotExplorer selected={selected} onSelect={setSelected} user={user}
      personalStatus={personalStatus} publicState={state.status} publicData={state.data}>
      {selected === 'flagship' && <FlagshipDetails data={state.data} state={state} refresh={refresh} />}
      {selected === 'personal' && <div className="tl-ai-personal-detail" id="personal-ai-trader">
        {sessionLoading ? <p role="status">Checking your account…</p>
          : user ? <PersonalAiTraderCard onStatusChange={setPersonalStatus} />
            : <div className="tl-ai-selected__empty">
              <h4>Make the research your own</h4>
              <p>Choose the sectors your trader researches, how much risk you're comfortable with, and whether you want to approve simulated trades. Sign in to create your personal paper-trading account.</p>
              <a className="tl-btn tl-btn--primary" href="/auth">Sign in to get started</a>
            </div>}
      </div>}
      {(selected === 'catalyst' || selected === 'defensive') && <div className="tl-ai-selected__empty" data-testid="planned-ai-bot">
        <h4>Planned concept</h4>
        <p>This is an approach we're exploring, not an available trading system. There is no active bot, decision history or performance record for this concept.</p>
        <p>Available AI strategies can be explored in the public catalog.</p>
        <a href="/strategies" className="tl-btn tl-btn--secondary">Browse existing strategies</a>
      </div>}
    </AiTraderBotExplorer>
  </main>
}
