import { useEffect, useState } from 'react'
import StrategyCard from './StrategyCard'
import { loadPublicStrategies } from './strategiesApi'
import { PageIdentity, ContentState } from '../../components/content/ContentBlocks'
import './strategy-catalog.css'

/** Public strategy catalog. Present recorded evidence without inferring missing results. */
export default function StrategiesIndex() {
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
      {state.status === 'loading' && <span className="tl-skel" style={{ height: 240 }} aria-label="Loading strategies" />}
      {state.status === 'error' && <ContentState tone="error" title="Strategy information is unavailable." description="The list could not be loaded. You can reload the page to request it again." />}
      {state.status === 'done' && state.rows.length === 0 && <ContentState title="No strategies have been published." description="Published strategies and their available test results will appear here." />}
      {state.status === 'done' && state.rows.length > 0 && (
        <ul className="tl-strategy-catalog" aria-label="Published trading strategies">
          {state.rows.map(s => <li key={s.templateId}><StrategyCard strategy={s} /></li>)}
        </ul>
      )}
      {state.status === 'done' && state.rows.length > 0 && (
        <p className="tl-strategy-catalog-note">Historical tests and simulated trading do not represent returns earned in live brokerage accounts. Results do not predict future performance.</p>
      )}
    </main>
  )
}
