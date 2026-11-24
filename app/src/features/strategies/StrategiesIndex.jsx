import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { sessionDate } from '../../ui/format'
import { loadPublicStrategies, summaryLine } from './strategiesApi'

/** Public: every platform strategy with its standardized historical results — good or bad. */
export default function StrategiesIndex() {
  const [state, setState] = useState({ status: 'loading', rows: [] })
  useEffect(() => {
    loadPublicStrategies().then((rows) => setState({ status: 'done', rows: Array.isArray(rows) ? rows : [] })).catch(() => setState({ status: 'error', rows: [] }))
  }, [])
  const asOf = state.rows.find((r) => r.asOf)?.asOf
  return (
    <main className="tl-page" data-testid="strategies-index">
      <header className="tl-header">
        <div>
          <h1 className="tl-title">Platform strategies</h1>
          <p className="tl-lede">Every strategy TradeLoom offers, tested the same way on the same data{asOf ? ` (through ${sessionDate(asOf, { year: true })})` : ''}. Negative and empty results are shown too.</p>
        </div>
      </header>
      {state.status === 'loading' && <span className="tl-skel" style={{ height: 240 }} aria-label="Loading strategies" />}
      {state.status === 'error' && <div className="tl-notice tl-notice--error" role="alert">Strategy results couldn’t be loaded.</div>}
      {state.status === 'done' && (
        <ul className="tl-list tl-strategy-list">
          {state.rows.map((s) => (
            <li key={s.templateId} className="tl-strategy-card" data-testid="strategy-card">
              <Link to={`/strategies/${encodeURIComponent(s.templateId)}`} className="tl-strategy-link">
                <span className="tl-strategy-name">
                  {s.name}
                  {s.tags?.includes('ai') && <span className="tl-tag" style={{ marginLeft: 8, fontSize: '0.75rem', verticalAlign: 'middle' }}>AI / LLM</span>}
                </span>
                <span className="tl-small tl-muted">{s.description}</span>
                <span className="tl-strategy-cta">View evidence →</span>
              </Link>
              <dl className="tl-strategy-windows">
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
                <div>
                  <dt>Holdout (out of sample)</dt>
                  <dd>
                    {s.windows?.holdout
                      ? summaryLine(s.windows.holdout)
                      : s.windows?.['5Y']?.status === 'not_backtestable'
                        ? 'Not backtestable'
                        : '—'}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="tl-small tl-muted" style={{ marginTop: 28 }}>Historical simulations, not predictions. Each strategy is tested per symbol with the same capital, fill model and risk policy as TradeLoom paper trading.</p>
    </main>
  )
}
