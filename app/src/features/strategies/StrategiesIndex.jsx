import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadPublicStrategies } from './strategiesApi'
import { catalogOverview, catalogPeriod, catalogResult } from './strategyCatalogCopy'
import { strategyDisplayName } from '../../ui/strategyPresentation'
import { PageIdentity, ContentState } from '../../components/content/ContentBlocks'

/** Public: every platform strategy with its standardized historical results — good or bad. */
export default function StrategiesIndex() {
  const [state, setState] = useState({ status: 'loading', rows: [] })
  useEffect(() => {
    loadPublicStrategies().then((rows) => setState({ status: 'done', rows: Array.isArray(rows) ? rows : [] })).catch(() => setState({ status: 'error', rows: [] }))
  }, [])
  return (
    <main className="tl-page" data-testid="strategies-index">
      <PageIdentity title="Strategies" description="TradeLoom publishes trading strategies with different rules and approaches to market conditions. You can review each strategy’s description and the results available from historical testing or simulated trading. Real-money brokerage execution is not yet available." />
      {state.status === 'loading' && <span className="tl-skel" style={{ height: 240 }} aria-label="Loading strategies" />}
      {state.status === 'error' && <ContentState tone="error" title="Strategies unavailable" description="Strategy information could not be loaded. Refresh the page to try again." />}
      {state.status === 'done' && state.rows.length === 0 && <ContentState title="No strategies available" description="There are no published strategies to compare yet." />}
      {state.status === 'done' && state.rows.length > 0 && (
        <ul className="tl-list tl-strategy-list">
          {state.rows.map((s) => (
            <li key={s.templateId} className="tl-strategy-card tl-card-shell" data-testid="strategy-card">
              <Link to={`/strategies/${encodeURIComponent(s.templateId)}`} className="tl-strategy-link">
                <span className="tl-strategy-name">{strategyDisplayName(s)}</span>
                {s.tags?.includes('ai') && <span className="tl-content-tags tl-content-tags--inline"><span className="tl-tag tl-tag--sim">AI-managed</span></span>}
                <span className="tl-small tl-muted">{catalogOverview(s)}</span>
                <span className="tl-strategy-cta">View results →</span>
              </Link>
              <dl className="tl-strategy-windows">
                {s.tags?.includes('ai') || s.templateId === 'tmpl_ai_catalyst_momentum' ? (
                  <div>
                    <dt>{catalogPeriod("forward")}</dt>
                    <dd>{catalogResult(s.windows?.forward, 'forward')}</dd>
                  </div>
                ) : (
                  <>
                    <div>
                      <dt>{catalogPeriod("5Y")}</dt>
                      <dd>{catalogResult(s.windows?.['5Y'], '5Y')}</dd>
                      {s.windows?.['5Y']?.status === 'ok' && (
                        <span className="tl-sub">{s.windows['5Y'].beatBuyAndHold} of {s.windows['5Y'].symbolsTested} tested stocks had a higher strategy return than buying and holding.</span>
                      )}
                    </div>
                    <div>
                      <dt>{catalogPeriod("1Y")}</dt>
                      <dd>{catalogResult(s.windows?.['1Y'], '1Y')}</dd>
                    </div>
                    {s.windows?.holdout && (
                      <div>
                        <dt>{catalogPeriod("holdout")}</dt>
                        <dd>{catalogResult(s.windows.holdout, 'holdout')}</dd>
                      </div>
                    )}
                  </>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
