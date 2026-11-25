import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { get } from '../../api/client'
import Disclosure from '../../ui/Disclosure'
import ValueChart from '../../ui/ValueChart'
import { describeGuards } from '../../ui/describeBot'
import { money, moneyWhole, plural, sessionDate, tone } from '../../ui/format'
import pageTitleService from '../../services/pageTitleService'
import { WINDOW_LABELS, loadPublicStrategy, pctText, summaryLine } from './strategiesApi'
import { STRATEGY_COPY, decisionCounts, decisionLabel, strategyDisplayName, strategyWindowOptions } from '../../ui/strategyPresentation'

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
  const [aiState, setAiState] = useState({ status: 'idle', decisions: [] })

  useEffect(() => {
    let active = true
    setState({ status: 'loading', s: null })
    setAiState({ status: 'idle', decisions: [] })
    loadPublicStrategy(templateId, versionParam).then((loaded) => {
      if (!active) return
      setState({ status: 'done', s: loaded })
      if (loaded?.name) pageTitleService.setTitle(strategyDisplayName(loaded))
      const isAi = loaded?.tags?.includes('ai') || loaded?.templateId === 'tmpl_ai_catalyst_momentum'
      if (isAi) {
        setWin('forward')
        setAiState({ status: 'loading', decisions: [] })
        get(`/ai/strategies/${encodeURIComponent(templateId)}/decisions`)
          .then((res) => {
            if (!active) return
            const data = res?.decisions ? res : res?.data
            setAiState(Array.isArray(data?.decisions)
              ? { status: 'done', decisions: data.decisions }
              : { status: 'error', decisions: [] })
          })
          .catch(() => { if (active) setAiState({ status: 'error', decisions: [] }) })
      } else {
        setWin('5Y')
      }
    }).catch((e) => {
      if (active) setState({ status: e?.status === 404 ? 'missing' : 'error', s: null })
    })
    return () => { active = false }
  }, [templateId, versionParam])
  const s = state.s
  const rows = useMemo(() => (s?.results ?? []).filter((r) => r.window === win), [s, win])
  const chosen = rows.find((r) => r.symbol === sym && r.status === 'ok') ?? rows.find((r) => r.status === 'ok' && r.results?.metrics?.trades > 0) ?? rows.find((r) => r.status === 'ok') ?? null

  if (state.status === 'loading') return <main className="tl-page"><span className="tl-skel" style={{ height: 320 }} aria-label="Loading strategy" /></main>
  if (state.status === 'missing') return <main className="tl-page"><p>Strategy not found. <Link to="/strategies">All strategies</Link></p></main>
  if (state.status === 'error') return <main className="tl-page"><div className="tl-notice tl-notice--error" role="alert">This strategy’s results couldn’t be loaded.</div></main>

  const def = s.definition
  const guards = describeGuards({ config: def.config, rules: def.rules })
  const isAi = s.tags?.includes('ai') || s.templateId === 'tmpl_ai_catalyst_momentum'
  const windows = strategyWindowOptions(s.standard?.windows ?? ['5Y', '1Y', 'forward'], s.design, { forwardOnly: isAi })
  return (
    <main className="tl-page" data-testid="strategy-detail">
      <p className="tl-small"><Link to="/strategies">← Strategies</Link></p>
      <header className="tl-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="tl-title">{strategyDisplayName(s)}</h1>
          
          <p className="tl-small tl-muted m0">

            {s.tags?.includes('ai') && <span className="tl-tag" style={{ marginLeft: 6 }}>AI</span>}
            {s.tags?.includes('openai') && <span className="tl-tag" style={{ marginLeft: 6 }}>OpenAI</span>}
            {' '}v{s.version.id.slice(3, 11)}


          </p>
        </div>
        {s.workshopAvailable === true && <Link to={`/bots/new?template=${encodeURIComponent(s.templateId)}${win !== '5Y' ? `&window=${encodeURIComponent(win)}` : ''}`} className="tl-btn tl-btn--primary" data-testid="open-in-workshop">Customize</Link>}
      </header>

      {!s.version.current && (
        <div className="tl-notice" data-testid="earlier-version">An earlier version of this strategy, kept with its results for the record. <Link to={`/strategies/${encodeURIComponent(s.templateId)}`}>See the current version</Link></div>
      )}
      {!s.version.backtestable && !isAi && <div className="tl-notice" data-testid="not-backtestable">{s.version.reason || 'Not backtestable'}</div>}
      {s.design && (
        <Disclosure label="Details" testId="strategy-design">
          <dl className="tl-facts">
            <dt>Objective</dt><dd>{s.design.objective}</dd>
            <dt>Benchmark</dt><dd>{s.design.benchmark}</dd>
            <dt>Parameters</dt><dd>{s.design.parameterBasis}</dd>
            {s.design.developmentEnd && <><dt>Out of sample</dt><dd>After {sessionDate(s.design.developmentEnd, { year: true })}</dd></>}
          </dl>
        </Disclosure>
      )}

      <section className="tl-section" aria-labelledby="results-title">
        <div className="tl-section-head">
          <h2 className="tl-section-title" id="results-title">{STRATEGY_COPY.results}</h2>
          {windows.length > 1 ? (
            <div className="tl-seg" role="group" aria-label="Window">
              {windows.map((w) => <button key={w} type="button" aria-pressed={win === w} onClick={() => setWin(w)}>{WINDOW_LABELS[w] ?? w}</button>)}
            </div>
          ) : <span className="tl-small tl-muted">{isAi ? 'Forward paper' : WINDOW_LABELS[windows[0]] ?? windows[0]}</span>}
        </div>
        <Summary s={s.summary?.[win]} />



        {chosen && chosen.results?.curve && (
          <div style={{ marginTop: 14 }}>
            <ValueChart
              points={chosen.results.curve.map((p) => ({ t: p.date, v: p.equity }))}
              secondaryPoints={chosen.results.buyAndHold?.curve?.map((p) => ({ t: p.date, v: p.equity }))}
              secondaryLabel="Buy & hold"
              baseline={chosen.results.capital}
              baselineLabel={`Start ${moneyWhole(chosen.results.capital)}`}
              height={200}
              label={`${strategyDisplayName(s)} on ${chosen.symbol}`}
              minSpan={chosen.results.capital * 0.01}
            />
            <p className="tl-chart-caption">{chosen.symbol} · Strategy {pctText(chosen.results.metrics?.returnPct)} · Buy &amp; hold {pctText(chosen.results.buyAndHold?.returnPct)}</p>
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
                    {r.status === 'ok' && r.results?.metrics ? (
                      <>
                        <td className={`r ${tone(r.results.metrics.returnPct)}`}>{pctText(r.results.metrics.returnPct)}</td>
                        <td className={`r ${tone(r.results.buyAndHold?.returnPct)}`}>{pctText(r.results.buyAndHold?.returnPct)}</td>
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

      {(s.tags?.includes('ai') || s.templateId === 'tmpl_ai_catalyst_momentum') && (
        <section className="tl-section" aria-labelledby="ai-feed-title" data-testid="ai-decision-feed">
          <div className="tl-section-head">
            <h2 className="tl-section-title" id="ai-feed-title">{STRATEGY_COPY.decisions}</h2>
          </div>
          {aiState.status === 'loading' ? (
            <span className="tl-skel" style={{ height: 48 }} aria-label={STRATEGY_COPY.loadingDecisions} />
          ) : aiState.status === 'error' ? (
            <p className="tl-section-note" role="alert">{STRATEGY_COPY.decisionsUnavailable}</p>
          ) : aiState.decisions.length > 0 ? (
            <div className="tl-ai-feed">
              {aiState.decisions.map((d) => {
                const evaluations = Array.isArray(d.metadata?.symbolEvaluations) ? d.metadata.symbolEvaluations : []
                const counts = decisionCounts(evaluations)
                const proposedOrders = Array.isArray(d.metadata?.selectedDecisions) ? d.metadata.selectedDecisions.length : 0
                return (
                  <div key={d.id} className="tl-card" style={{ marginBottom: 12, padding: 14 }}>
                    <div className="tl-small tl-muted" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
                      <span>{d.metadata?.asOfSession ? sessionDate(d.metadata.asOfSession, { year: true }) : 'Session unavailable'}</span>
                      <span>{counts.evaluated} checked · {proposedOrders ? `${proposedOrders} ${proposedOrders === 1 ? 'order proposed' : 'orders proposed'}` : 'No orders proposed'}</span>
                      {d.metadata?.isReplay && <span>Replay</span>}
                    </div>
                    <div className="tl-ai-decisions" role="list" aria-label="Symbol decisions">
                      {evaluations.map((ev) => (
                        <div role="listitem" key={ev.symbol}>
                          <Disclosure label={ev.symbol} meta={<span className={ev.action === 'BUY' ? 'tl-pos' : ev.action === 'SELL' ? 'tl-neg' : 'tl-muted'}>{decisionLabel(ev.action)}</span>}>
                            {ev.thesis && <p className="tl-small">{ev.thesis}</p>}
                            {Array.isArray(ev.evidence) && ev.evidence.length > 0 && (
                              <ul className="tl-backtest-notes">
                                {ev.evidence.map((item, idx) => <li key={idx}>{item}</li>)}
                              </ul>
                            )}
                          </Disclosure>
                        </div>
                      ))}
                    </div>
                    <Disclosure label="Research">
                      <dl className="tl-facts">
                        <dt>Model</dt><dd>{d.metadata?.model || 'OpenAI'}</dd>
                        <dt>Market data as of</dt><dd>{d.metadata?.asOfSession ? sessionDate(d.metadata.asOfSession, { year: true }) : '—'}</dd>
                        <dt>Generated</dt><dd>{d.metadata?.decisionTimestamp ? new Date(d.metadata.decisionTimestamp).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd>
                        {proposedOrders > 0 && d.metadata?.intendedExecutionSession && <><dt>Proposed for</dt><dd>{sessionDate(d.metadata.intendedExecutionSession, { year: true })}</dd></>}
                      </dl>
                      {d.metadata?.marketSummary && <p className="tl-small">{d.metadata.marketSummary}</p>}
                    </Disclosure>
                  </div>
                )
              })}
            </div>
          ) : <p className="tl-section-note">{STRATEGY_COPY.noDecisions}</p>}
        </section>
      )}

      <section className="tl-section" aria-labelledby="def-title">
        <div className="tl-section-head"><h2 className="tl-section-title" id="def-title">{STRATEGY_COPY.settings}</h2></div>
        {isAi && (
          <dl className="tl-facts" aria-label="AI strategy limits">
            <dt>Paper capital</dt><dd>{moneyWhole(def.config.allocatedAmount ?? 10000)}</dd>
            <dt>Order limit</dt><dd>{moneyWhole(def.config.maxOrderNotional ?? 2000)}</dd>
            <dt>Evaluation</dt><dd>Daily · After close</dd>
          </dl>
        )}
        <ul className="tl-rule-list" data-testid="tested-definition">
          {!isAi && <li>{def.config.direction === 'sell' ? 'Sells shares it already holds of' : 'Buys'} each symbol it’s tested on</li>}
          {guards.map((g) => <li key={g}>{g}</li>)}
          {def.parameters?.triggerPrice === 'close_before_window' && <li>Trigger price: the symbol’s close on the last session before the test window (standardized; shown per result)</li>}
        </ul>

      </section>

      <Disclosure label="Methodology" testId="evidence-method">
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
