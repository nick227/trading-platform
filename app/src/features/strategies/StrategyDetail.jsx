import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Disclosure from '../../ui/Disclosure'
import ValueChart from '../../ui/ValueChart'
import { describeGuards } from '../../ui/describeBot'
import { money, moneyWhole, plural, sessionDate, tone } from '../../ui/format'
import pageTitleService from '../../services/pageTitleService'
import { WINDOW_LABELS, loadPublicStrategy, pctText, summaryLine } from './strategiesApi'

const SKIP_TEXT = {
  no_position: 'it had nothing to sell', cooldown_active: 'cooldown', price_above_threshold_not_met: 'price below its trigger',
  price_below_threshold_not_met: 'price above its trigger', time_window_outside: 'its trading window excludes the daily close',
  position_limit_reached: 'position limit', relative_volume_below: 'volume condition', invalid_quantity: 'order too small',
}
function whyNot(r) {
  const top = Object.entries(r.results?.skips ?? {}).sort((a, b) => b[1] - a[1])[0]
  return top ? (SKIP_TEXT[top[0]] ?? top[0].replace(/_/g, ' ')) : null
}

function Summary({ s }) {
  if (!s || s.status !== 'ok') return <p className="tl-section-note" data-testid="window-status">{summaryLine(s)}{s?.reason ? ` — ${s.reason}` : ''}</p>
  return (
    <dl className="tl-stats tl-stats--4" style={{ borderTop: 0 }} data-testid="window-summary">
      <div className="tl-stat"><dt>Median return</dt><dd className={tone(s.medianReturnPct)}>{pctText(s.medianReturnPct)}<small>across {plural(s.symbolsTested, 'symbol')}</small></dd></div>
      <div className="tl-stat"><dt>Buy &amp; hold</dt><dd className={tone(s.medianBuyAndHoldPct)}>{pctText(s.medianBuyAndHoldPct)}<small>beat on {s.beatBuyAndHold} of {s.symbolsTested}</small></dd></div>
      <div className="tl-stat"><dt>Worst drawdown</dt><dd>{s.worstDrawdownPct ? `${s.worstDrawdownPct.toFixed(2)}%` : '—'}<small>any symbol</small></dd></div>
      <div className="tl-stat"><dt>Trades</dt><dd>{s.trades}<small>traded on {s.symbolsTraded} of {s.symbolsTested}{s.exits ? ` · ${s.exits} exit sells` : ''}</small></dd></div>
      {s.medianDrawdownPct !== undefined && s.medianDrawdownPct !== null && (
        <div className="tl-stat" data-testid="drawdown-benchmark"><dt>Median drawdown</dt><dd>{s.medianDrawdownPct.toFixed(2)}%<small>buy &amp; hold {s.medianBuyAndHoldDrawdownPct?.toFixed(2)}% · lower on {s.lowerDrawdownThanBuyAndHold} of {s.symbolsTested}</small></dd></div>
      )}
      {s.medianTimeInMarketPct !== undefined && s.medianTimeInMarketPct !== null && (
        <div className="tl-stat"><dt>Time in market</dt><dd>{s.medianTimeInMarketPct.toFixed(0)}%<small>median share of sessions holding</small></dd></div>
      )}
    </dl>
  )
}

/** Public: one strategy version's standardized results, configuration and assumptions. */
export default function StrategyDetail() {
  const { templateId } = useParams()
  const [params] = useSearchParams()
  const versionParam = params.get('version')
  const [state, setState] = useState({ status: 'loading', s: null })
  const [win, setWin] = useState('5Y')
  const [sym, setSym] = useState(null)
  useEffect(() => {
    setState({ status: 'loading', s: null })
    loadPublicStrategy(templateId, versionParam).then((s) => {
      setState({ status: 'done', s })
      if (s?.name) pageTitleService.setTitle(s.name)
    }).catch((e) => setState({ status: e?.status === 404 ? 'missing' : 'error', s: null }))
  }, [templateId, versionParam])
  const s = state.s
  const rows = useMemo(() => (s?.results ?? []).filter((r) => r.window === win), [s, win])
  const chosen = rows.find((r) => r.symbol === sym && r.status === 'ok') ?? rows.find((r) => r.status === 'ok' && r.results.metrics.trades > 0) ?? null

  if (state.status === 'loading') return <main className="tl-page"><span className="tl-skel" style={{ height: 320 }} aria-label="Loading strategy" /></main>
  if (state.status === 'missing') return <main className="tl-page"><p>Strategy not found. <Link to="/strategies">All strategies</Link></p></main>
  if (state.status === 'error') return <main className="tl-page"><div className="tl-notice tl-notice--error" role="alert">This strategy’s results couldn’t be loaded.</div></main>

  const def = s.definition
  const guards = describeGuards({ config: def.config, rules: def.rules })
  return (
    <main className="tl-page" data-testid="strategy-detail">
      <p className="tl-small"><Link to="/strategies">← Platform strategies</Link></p>
      <header className="tl-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="tl-title">{s.name}</h1>
          <p className="tl-lede">{s.description}</p>
          <p className="tl-small tl-muted m0">
            <span className="tl-tag">Platform-tested</span> Version {s.version.id.slice(3, 11)}
            {s.asOf ? ` · results through ${sessionDate(s.asOf, { year: true })}` : ' · results pending'}
            {s.version.firstSession ? ` · published ${sessionDate(s.version.firstSession, { year: true })}` : ''}
          </p>
        </div>
        <Link to={`/bots/new?template=${encodeURIComponent(s.templateId)}${win !== '5Y' ? `&window=${encodeURIComponent(win)}` : ''}`} className="tl-btn tl-btn--primary" data-testid="open-in-workshop">Open in Workshop</Link>
      </header>

      {!s.version.current && (
        <div className="tl-notice" data-testid="earlier-version">An earlier version of this strategy, kept with its results for the record. <Link to={`/strategies/${encodeURIComponent(s.templateId)}`}>See the current version</Link></div>
      )}
      {!s.version.backtestable && <div className="tl-notice" data-testid="not-backtestable">{s.version.reason}</div>}
      {s.design && (
        <section className="tl-section" aria-labelledby="design-title" data-testid="strategy-design">
          <div className="tl-section-head"><h2 className="tl-section-title" id="design-title">What it’s for, and how it’s judged</h2></div>
          <dl className="tl-facts">
            <dt>Objective</dt><dd>{s.design.objective}</dd>
            <dt>Benchmark</dt><dd>{s.design.benchmark}</dd>
            <dt>Parameters</dt><dd>{s.design.parameterBasis}</dd>
            <dt>Out of sample</dt><dd>Designed with data through {sessionDate(s.design.developmentEnd, { year: true })}; “Holdout” covers only later sessions.</dd>
          </dl>
        </section>
      )}

      <section className="tl-section" aria-labelledby="results-title">
        <div className="tl-section-head">
          <h2 className="tl-section-title" id="results-title">Standardized results</h2>
          <div className="tl-seg" role="group" aria-label="Window">
            {(s.standard?.windows ?? ['5Y', '1Y', 'forward']).map((w) => <button key={w} type="button" aria-pressed={win === w} onClick={() => setWin(w)}>{WINDOW_LABELS[w] ?? w}</button>)}
          </div>
        </div>
        <Summary s={s.summary?.[win]} />
        {win === 'forward' && <p className="tl-small tl-muted">Only sessions completed after this version was published — results it could not have been tuned on.</p>}
        {win === 'holdout' && <p className="tl-small tl-muted">Sessions after {sessionDate(s.design?.developmentEnd, { year: true })}, which weren’t used when this version was designed.</p>}
        {win === 'development' && <p className="tl-small tl-muted">The period the design could see. In-sample: treat these results with more caution than the holdout.</p>}
        {chosen && (
          <div style={{ marginTop: 14 }}>
            <ValueChart
              points={chosen.results.curve.map((p) => ({ t: p.date, v: p.equity }))}
              secondaryPoints={chosen.results.buyAndHold?.curve?.map((p) => ({ t: p.date, v: p.equity }))}
              secondaryLabel="Buy & hold"
              baseline={chosen.results.capital}
              baselineLabel={`Start ${moneyWhole(chosen.results.capital)}`}
              height={200}
              label={`${s.name} on ${chosen.symbol}`}
              minSpan={chosen.results.capital * 0.01}
            />
            <p className="tl-chart-caption">{chosen.symbol}: strategy value at each close ({pctText(chosen.results.metrics.returnPct)}) vs buy &amp; hold {pctText(chosen.results.buyAndHold.returnPct)} with the same capital.</p>
          </div>
        )}
        {rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="tl-table" data-testid="symbol-results">
              <thead><tr><th>Symbol</th><th className="r">Return</th><th className="r">Buy &amp; hold</th><th className="r tl-hide-sm">Max drawdown</th><th className="r">Trades</th><th className="r tl-hide-sm">Win rate</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol} data-testid="symbol-row" onClick={() => r.status === 'ok' && setSym(r.symbol)} style={{ cursor: r.status === 'ok' ? 'pointer' : 'default' }} aria-selected={chosen?.symbol === r.symbol}>
                    <td><strong>{r.symbol}</strong></td>
                    {r.status === 'ok' ? (
                      <>
                        <td className={`r ${tone(r.results.metrics.returnPct)}`}>{pctText(r.results.metrics.returnPct)}</td>
                        <td className={`r ${tone(r.results.buyAndHold.returnPct)}`}>{pctText(r.results.buyAndHold.returnPct)}</td>
                        <td className="r tl-hide-sm">{r.results.metrics.maxDrawdown ? `${r.results.metrics.maxDrawdown.pct.toFixed(2)}%` : '—'}</td>
                        <td className="r">{r.results.metrics.trades === 0 ? <span className="tl-muted" title={whyNot(r) ?? ''}>0{whyNot(r) ? ` · ${whyNot(r)}` : ''}</span> : r.results.metrics.trades}</td>
                        <td className="r tl-hide-sm">{r.results.metrics.winRate !== null ? `${Math.round(r.results.metrics.winRate * 100)}%` : '—'}</td>
                      </>
                    ) : <td colSpan={5} className="tl-muted">{r.status === 'awaiting_sessions' ? 'Awaiting sessions after publication' : r.status === 'not_backtestable' ? 'Not backtestable' : r.reason ?? 'No result'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tl-section" aria-labelledby="def-title">
        <div className="tl-section-head"><h2 className="tl-section-title" id="def-title">The strategy as tested</h2></div>
        <ul className="tl-rule-list" data-testid="tested-definition">
          <li>{def.config.direction === 'sell' ? 'Sells shares it already holds of' : 'Buys'} each symbol it’s tested on</li>
          {guards.map((g) => <li key={g}>{g}</li>)}
          {def.parameters?.triggerPrice === 'close_before_window' && <li>Trigger price: the symbol’s close on the last session before the test window (standardized; shown per result)</li>}
        </ul>
        <p className="tl-small tl-muted">Opening it in the Workshop gives you these defaults. Once you change anything, it’s your own configuration and these results no longer describe it — backtest your version instead.</p>
      </section>

      <Disclosure label="How these results are produced" testId="evidence-method">
        <ul className="tl-backtest-notes">
          {s.assumptions.map((a) => <li key={a}>{a}</li>)}
          {rows[0]?.riskPolicyVersion && <li>Risk policy {rows[0].riskPolicyVersion}.</li>}
          {s.versions.length > 1 && <li>{plural(s.versions.length, 'version')} published; results always belong to the version they were produced for.</li>}
        </ul>
        {s.versions.length > 1 && (
          <ul className="tl-backtest-notes" data-testid="version-list">
            {s.versions.map((v) => (
              <li key={v.id}>
                {v.selected ? <strong>{v.id.slice(3, 11)}</strong> : <Link to={v.current ? `/strategies/${encodeURIComponent(s.templateId)}` : `/strategies/${encodeURIComponent(s.templateId)}?version=${v.id}`}>{v.id.slice(3, 11)}</Link>}
                {' '}· published {sessionDate(v.firstSession, { year: true })}{v.current ? ' · current' : ''}
              </li>
            ))}
          </ul>
        )}
        {rows.some((r) => r.parameters?.triggerPrice) && (
          <p className="tl-small tl-muted">Standardized triggers: {rows.filter((r) => r.parameters?.triggerPrice).map((r) => `${r.symbol} ${money(r.parameters.triggerPrice)} (${sessionDate(r.parameters.triggerFrom, { year: true })})`).join(' · ')}</p>
        )}
      </Disclosure>
    </main>
  )
}
