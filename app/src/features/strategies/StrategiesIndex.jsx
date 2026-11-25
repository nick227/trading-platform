import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadPublicStrategies, summaryLine } from './strategiesApi'
import { strategyDisplayName } from '../../ui/strategyPresentation'

/** Public: every platform strategy with its standardized historical results — good or bad. */
export default function StrategiesIndex() {
  const [state, setState] = useState({ status: 'loading', rows: [] })
  useEffect(() => {
    loadPublicStrategies().then((rows) => setState({ status: 'done', rows: Array.isArray(rows) ? rows : [] })).catch(() => setState({ status: 'error', rows: [] }))
  }, [])
  return (
    <main className="tl-page" data-testid="strategies-index">
      <header className="tl-header tl-aligned-header"><h1 className="tl-title">Strategies</h1></header>
      {state.status === 'loading' && <span className="tl-skel" style={{ height: 240 }} aria-label="Loading strategies" />}
      {state.status === 'error' && <div className="tl-notice tl-notice--error" role="alert">Strategy results couldn’t be loaded.</div>}
      {state.status === 'done' && (
        <ul className="tl-list tl-strategy-list">
          {state.rows.map((s) => (
            <li key={s.templateId} className="tl-strategy-card tl-card-shell" data-testid="strategy-card">
              <Link to={`/strategies/${encodeURIComponent(s.templateId)}`} className="tl-strategy-link">
                <span className="tl-strategy-name">
                  {strategyDisplayName(s)}
                  {s.tags?.includes('ai') && <span className="tl-tag" style={{ marginLeft: 8, fontSize: '0.75rem', verticalAlign: 'middle' }}>AI</span>}
                </span>
                {!s.tags?.includes('ai') && s.description && <span className="tl-small tl-muted">{s.description}</span>}
                <span className="tl-strategy-cta">View results →</span>
              </Link>
              <dl className="tl-strategy-windows">
                {s.tags?.includes('ai') || s.templateId === 'tmpl_ai_catalyst_momentum' ? (
                  <div>
                    <dt>Forward paper</dt>
                    <dd>{summaryLine(s.windows?.forward)}</dd>
                  </div>
                ) : (
                  <>
                    <div>
                      <dt>5 years</dt>
                      <dd>{summaryLine(s.windows?.['5Y'])}</dd>
                      {s.windows?.['5Y']?.status === 'ok' && (
                        <span className="tl-sub">{s.windows['5Y'].beatBuyAndHold} of {s.windows['5Y'].symbolsTested} symbols beat</span>
                      )}
                    </div>
                    <div>
                      <dt>Last year</dt>
                      <dd>{summaryLine(s.windows?.['1Y'])}</dd>
                    </div>
                    {s.windows?.holdout && (
                      <div>
                        <dt>Holdout</dt>
                        <dd>{summaryLine(s.windows.holdout)}</dd>
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
