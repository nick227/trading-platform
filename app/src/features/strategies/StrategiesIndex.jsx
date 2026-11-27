import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import StrategyCard from './StrategyCard'
import StrategyLeaderboard from './StrategyLeaderboard'
import { loadPublicStrategies } from './strategiesApi'
import { PageIdentity, ContentState } from '../../components/content/ContentBlocks'
import './strategy-catalog.css'

/** Public strategy catalog & cross-strategy leaderboard. Present recorded evidence without inferring missing results. */
export default function StrategiesIndex() {
  const location = useLocation()
  const searchParams = new URLSearchParams(location?.search || '')
  const focusedSymbol = (searchParams.get('symbol') || searchParams.get('ticker') || '').trim().toUpperCase() || null
  const symbolQuery = focusedSymbol ? `?symbol=${encodeURIComponent(focusedSymbol)}` : ''

  const [state, setState] = useState({ status: 'loading', rows: [] })
  useEffect(() => {
    let active = true
    loadPublicStrategies()
      .then(rows => { if (active) setState({ status: 'done', rows: Array.isArray(rows) ? rows : [] }) })
      .catch(() => { if (active) setState({ status: 'error', rows: [] }) })
    return () => { active = false }
  }, [])
  return (
    <main className="tl-page tl-strategies-page" data-testid="strategies-index">
      <PageIdentity title="Automated trading strategies" description="Each strategy uses a different method for deciding when to buy or sell. The cards explain the method and show results from available tests. TradeLoom is developing brokerage execution for real-money trading." />
      {focusedSymbol && (
        <section
          className="tl-card tl-card-shell tl-card-shell--compact"
          style={{ marginBottom: '1rem' }}
          aria-label="Selected stock context"
          data-testid="strategy-symbol-context"
        >
          <div className="tl-section-head">
            <p className="tl-small" style={{ margin: 0 }}>
              <strong>Exploring strategies for {focusedSymbol}</strong> — opening any strategy below keeps {focusedSymbol} pre-selected through evidence review and bot setup.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Link to={`/opportunities?symbol=${encodeURIComponent(focusedSymbol)}`} className="tl-link-btn">← Back to {focusedSymbol} in Stocks</Link>
              <Link to={`/bots/new?ticker=${encodeURIComponent(focusedSymbol)}`} className="tl-link-btn">Automate {focusedSymbol} →</Link>
              <Link to="/strategies" className="tl-link-btn">Clear symbol</Link>
            </div>
          </div>
        </section>
      )}
      <section className="tl-card tl-card-shell tl-card-shell--compact" style={{ marginBottom: '1.25rem' }} aria-label="AI intelligence surfaces" data-testid="ai-intelligence-banner">
        <div className="tl-section-head">
          <div>
            <h2 className="tl-section-title" style={{ margin: 0 }}>AI Research &amp; Autonomous Paper Intelligence</h2>
            <p className="tl-small tl-muted" style={{ margin: '0.25rem 0 0' }}>
              Explore cross-sector stock discoveries, inspect Flagship AI portfolio &amp; performance attribution, or collaborate with your AI Research Partner.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link to={`/opportunities${symbolQuery}`} className="tl-link-btn">Explore Stocks →</Link>
            <Link to="/ai-stock-trader" className="tl-link-btn">Flagship AI Trader →</Link>
            <Link to={`/research-partners${symbolQuery}`} className="tl-link-btn">Research Partner →</Link>
          </div>
        </div>
      </section>
      <StrategyLeaderboard symbolContext={focusedSymbol} />
      {state.status === 'loading' && <span className="tl-skel" style={{ height: 240 }} aria-label="Loading strategies" />}
      {state.status === 'error' && <ContentState tone="error" title="Strategy information is unavailable." description="The list could not be loaded. You can reload the page to request it again." />}
      {state.status === 'done' && state.rows.length === 0 && <ContentState title="No strategies have been published." description="Published strategies and their available test results will appear here." />}
      {state.status === 'done' && state.rows.length > 0 && (
        <ul className="tl-strategy-catalog" aria-label="Published trading strategies">
          {state.rows.map(s => <li key={s.templateId}><StrategyCard strategy={s} symbolContext={focusedSymbol} /></li>)}
        </ul>
      )}
      {state.status === 'done' && state.rows.length > 0 && (
        <p className="tl-strategy-catalog-note">Historical tests and simulated trading do not represent returns earned in live brokerage accounts. Results do not predict future performance.</p>
      )}
    </main>
  )
}
