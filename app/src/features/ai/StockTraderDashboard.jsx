import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { get } from '../../api/client'
import { money, signedMoney, ratioPct, sessionDate, shares, dateTime, tone } from '../../ui/format'
import StockDiscoveryPanel from './StockDiscoveryPanel'
import PortfolioIntelligencePanel from './PortfolioIntelligencePanel'
import PerformanceIntelligencePanel from './PerformanceIntelligencePanel'
import AgentHeader from '../../ui/agents/AgentHeader'
import { traderAgentStatus } from '../../ui/agents/agentExperience'
import { buildFlagshipNarrativeSummary } from '../../ui/narrativeSummaries'

function Stat({ label, value, detail }) {
  return <div className="tl-stat"><dt>{label}</dt><dd>{value}<small>{detail}</small></dd></div>
}

export default function StockTraderDashboard() {
  const navigate = useNavigate()
  const [state, setState] = useState({ status: 'loading', data: null })
  const refresh = useCallback(() => {
    setState(s => ({ ...s, status: 'loading' }))
    get('/public/ai-stock-trader')
      .then(data => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', data: null }))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const data = state.data
  return <main className="tl-page tl-flow-page" data-testid="flagship-ai-dashboard">
    <section className="tl-section">
      <AgentHeader title="AI Stock Trader" kind="trader"
        status={traderAgentStatus({ requestStatus: state.status, dataStatus: data?.status })}
        description="Autonomous stock discovery, qualitative AI research and simulated portfolio management."
        detail="Platform-owned paper trading. No customer funds are invested. Historical or simulated results do not guarantee future returns."
        actions={<div className="tl-agent-head__actions">
          <a
            href="/opportunities"
            className="tl-link-btn"
            onClick={e => {
              e.preventDefault()
              navigate('/opportunities')
            }}
          >
            Stock Discovery Explorer →
          </a>
          <button type="button" className="tl-link-btn" onClick={refresh} disabled={state.status === 'loading'}>Refresh</button>
        </div>} />
    </section>
    {state.status === 'loading' && <section className="tl-section" role="status">Loading paper-trading results…</section>}
    {state.status === 'error' && <section className="tl-section" role="alert">Paper-trading data is temporarily unavailable. Retry to see verified results.</section>}
    {state.status === 'ready' && data?.status === 'not_initialized' && <section className="tl-section" data-testid="flagship-uninitialized">
      <h2 className="tl-section-title">Awaiting beta initialization</h2>
      <p>There are no verified paper-trading results or AI research decisions to publish yet.</p>
    </section>}
    {state.status === 'ready' && data?.status !== 'not_initialized' && data && <>
      <section className="tl-section" aria-label="Paper portfolio performance">
        <div className="tl-section-head">
          <h2 className="tl-section-title">Paper performance</h2>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {data.universePolicy && (
              <span className="tl-tag" data-testid="flagship-universe-policy">
                {data.universePolicy.dynamicDiscoveryEnabled
                  ? `Dynamic universe (${data.universePolicy.baseSymbolsCount} core + up to ${data.universePolicy.maxPromotions} promoted)`
                  : `Curated universe (${data.universePolicy.baseSymbolsCount} core)`}
              </span>
            )}
            <span className="tl-tag">{data.status === 'enabled' ? 'Beta enabled' : 'Paused'}</span>
          </div>
        </div>
        {buildFlagshipNarrativeSummary(data) && (
          <p className="tl-lead-sentence" style={{ margin: '0.35rem 0 0.75rem' }} data-testid="flagship-narrative-summary">
            {buildFlagshipNarrativeSummary(data)}
          </p>
        )}
        <dl className="tl-stats tl-stats--3 tl-stat-grid--flush" data-testid="flagship-performance">
          <Stat label="Allocated paper capital" value={money(data.capitalAllocated)} detail="Simulated" />
          <Stat label="Total P&L" value={signedMoney(data.performance?.totalPnl)} detail={data.performance ? 'From recorded fills and current marks' : 'No verified fills yet'} />
          <Stat label="Filled executions" value={data.performance?.fillCount ?? '—'} detail={data.performance ? 'Recorded paper fills' : 'No verified fills yet'} />
        </dl>
        {data.performance?.totalPnl === null || !data.performance ? <p className="tl-section-note">Portfolio return is not yet available from verified fill and price data.</p> : null}
        {data.performance?.totalEquity != null && <p className="tl-section-note">Estimated paper equity: <strong>{money(data.performance.totalEquity)}</strong></p>}
      </section>
      {data.performanceIntelligence && <PerformanceIntelligencePanel intelligence={data.performanceIntelligence} />}
      {data.portfolioIntelligence && <PortfolioIntelligencePanel intelligence={data.portfolioIntelligence} />}
      {data.discovery && <StockDiscoveryPanel discovery={data.discovery} compact />}
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
  </main>
}
