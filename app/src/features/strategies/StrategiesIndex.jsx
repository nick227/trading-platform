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
      <PageIdentity title="Explore TradeLoom's automated trading strategies." description="TradeLoom publishes trading strategies with different rules and approaches to market conditions. You can review each strategy’s description and the results available from historical testing or simulated trading. Real-money brokerage execution is not yet available." />
      {state.status === 'loading' && <span className="tl-skel" style={{ height: 240 }} aria-label="Loading strategies" />}
      {state.status === 'error' && <ContentState tone="error" title="Strategy information is unavailable." description="The list could not be loaded. You can reload the page to request it again." />}
      {state.status === 'done' && state.rows.length === 0 && <ContentState title="No strategies have been published." description="Published strategies and their available test results will appear here." />}
      {state.status === 'done' && state.rows.length > 0 && (
        <ul className="tl-strategy-catalog" aria-label="Published trading strategies">
          {state.rows.map(s => <li key={s.templateId}><StrategyCard strategy={s} /></li>)}
        </ul>
      )}
    </main>
  )
}
