import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { get } from '../../api/client'
import Disclosure from '../../ui/Disclosure'
import ValueChart from '../../ui/ValueChart'
import { describeGuards } from '../../ui/describeBot'
import { money, moneyWhole, plural, sessionDate, tone } from '../../ui/format'
import pageTitleService from '../../services/pageTitleService'
import { WINDOW_LABELS, loadPublicStrategy, pctText } from './strategiesApi'
import { STRATEGY_COPY, decisionCounts, decisionLabel, strategyDisplayName, strategyWindowOptions } from '../../ui/strategyPresentation'
import { PageIdentity, ContentSection, ContentState, FactGrid, TechnicalDetail } from '../../components/content/ContentBlocks'
import { strategyOverview, evidenceState, decisionState, uniqueStatements, describeEvaluationTiming } from '../../ui/contentPresentation'

const SKIP_TEXT = {
  no_position: 'the strategy had no shares to sell', cooldown_active: 'the strategy was waiting between trades', price_above_threshold_not_met: 'the stock price did not reach the purchase threshold',
  price_below_threshold_not_met: 'the stock price did not reach the sale threshold', time_window_outside: 'the evaluation fell outside the configured trading window',
  position_limit_reached: 'the configured position limit was reached', relative_volume_below: 'trading volume was below the required level', invalid_quantity: 'the proposed order did not meet the minimum size',
}
function whyNot(r) {
  const top = Object.entries(r.results?.skips ?? {}).sort((a, b) => b[1] - a[1])[0]
  return top ? (SKIP_TEXT[top[0]] ?? top[0].replace(/_/g, ' ')) : null
}

function Summary({ s }) {
  if (!s || s.status !== 'ok') {
    const state = evidenceState(s, s?.window ?? 'forward')
    return <ContentState title={state.title} description={state.description} testId="window-status" />
  }
  return (
    <dl className="tl-stats tl-stats--4 tl-stat-grid--flush" data-testid="window-summary">
      <div className="tl-stat"><dt>Typical strategy return</dt><dd className={tone(s.medianReturnPct)}>{pctText(s.medianReturnPct)}<small>across {plural(s.symbolsTested, 'stock')} tested</small></dd></div>
      <div className="tl-stat"><dt>Typical buy-and-hold return</dt><dd className={tone(s.medianBuyAndHoldPct)}>{pctText(s.medianBuyAndHoldPct)}<small>The strategy returned more on {s.beatBuyAndHold} of {s.symbolsTested} tested stocks.</small></dd></div>
      <div className="tl-stat"><dt>Largest recorded decline</dt><dd>{s.worstDrawdownPct ? `${s.worstDrawdownPct.toFixed(2)}%` : '—'}<small>The largest decline recorded for an individual stock in this test.</small></dd></div>
      <div className="tl-stat"><dt>Recorded trades</dt><dd>{s.trades}<small>The strategy traded {s.symbolsTraded} of {s.symbolsTested} tested stocks.{s.exits ? ` It recorded ${s.exits} sales that closed positions.` : ''}</small></dd></div>
      {s.medianDrawdownPct !== undefined && s.medianDrawdownPct !== null && (
        <div className="tl-stat" data-testid="drawdown-benchmark"><dt>Typical decline during the test</dt><dd>{s.medianDrawdownPct.toFixed(2)}%<small>Buying and holding declined {s.medianBuyAndHoldDrawdownPct?.toFixed(2)}%. The strategy had smaller declines for {s.lowerDrawdownThanBuyAndHold} of {s.symbolsTested} stocks.</small></dd></div>
      )}
      {s.medianTimeInMarketPct !== undefined && s.medianTimeInMarketPct !== null && (
        <div className="tl-stat"><dt>Time invested</dt><dd>{s.medianTimeInMarketPct.toFixed(0)}%<small>The typical percentage of test sessions with an open position.</small></dd></div>
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

  const isAi = s.tags?.includes('ai') || s.templateId === 'tmpl_ai_catalyst_momentum'
  const windows = strategyWindowOptions(s.standard?.windows ?? ['5Y', '1Y', 'forward'], s.design, { forwardOnly: isAi })
  return (
    <main className="tl-page" data-testid="strategy-detail">
      <p className="tl-small"><Link to="/strategies">← Strategies</Link></p>
      <PageIdentity
        title={strategyDisplayName(s)}
        description={strategyOverview(s)}
        tags={<>{isAi && <span className="tl-tag tl-tag--sim">AI-assisted strategy</span>}<span className="tl-tag">Historical or simulated evidence</span></>}
        action={s.workshopAvailable === true ? <Link to={`/bots/new?template=${encodeURIComponent(s.templateId)}${win !== '5Y' ? `&window=${encodeURIComponent(win)}` : ''}`} className="tl-btn tl-btn--primary" data-testid="open-in-workshop">Customize</Link> : null}
      />
      {!s.version.current && (
        <div className="tl-notice" data-testid="earlier-version">An earlier version of this strategy, kept with its results for the record. <Link to={`/strategies/${encodeURIComponent(s.templateId)}`}>See the current version</Link></div>
      )}
      {!s.version.backtestable && !isAi && <div className="tl-notice" data-testid="not-backtestable">{s.version.reason || 'Not backtestable'}</div>}


      <section className="tl-section" aria-labelledby="results-title">
        <div className="tl-section-head">
          <h2 className="tl-section-title" id="results-title">{STRATEGY_COPY.results}</h2>
          {windows.length > 1 ? (
            <div className="tl-seg" role="group" aria-label="Window">
              {windows.map((w) => <button key={w} type="button" aria-pressed={win === w} onClick={() => setWin(w)}>{WINDOW_LABELS[w] ?? w}</button>)}
            </div>
          ) : null}
        </div>
        <p className="tl-content-help">Published strategy returns are compared with the result of buying and holding the same investments during the selected test period. These figures are historical or simulated, not returns earned by investors.</p>
        <Summary s={s.summary?.[win] ? { ...s.summary[win], window: win } : { window: win, status: win === 'forward' ? 'awaiting_sessions' : 'unavailable' }} />



        {chosen && chosen.results?.curve && (
          <div style={{ marginTop: 14 }}>
            <ValueChart
              points={chosen.results.curve.map((p) => ({ t: p.date, v: p.equity }))}
              secondaryPoints={chosen.results.buyAndHold?.curve?.map((p) => ({ t: p.date, v: p.equity }))}
              secondaryLabel="Buy and hold"
              baseline={chosen.results.capital}
              baselineLabel={`Start ${moneyWhole(chosen.results.capital)}`}
              height={200}
              label={`${strategyDisplayName(s)} on ${chosen.symbol}`}
              minSpan={chosen.results.capital * 0.01}
            />
            <p className="tl-chart-caption">For {chosen.symbol}, the strategy returned {pctText(chosen.results.metrics?.returnPct)} compared with {pctText(chosen.results.buyAndHold?.returnPct)} from buying and holding.</p>
          </div>
        )}
        {rows.length > 0 && (
          <div className="tl-internal-scroll">
            <table className="tl-table" data-testid="symbol-results">
              <thead><tr><th>Stock</th><th className="r">Strategy return</th><th className="r">Buy-and-hold return</th><th className="r tl-hide-sm">Largest decline</th><th className="r">Trades</th><th className="r tl-hide-sm">Winning trades</th></tr></thead>
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
                    ) : <td colSpan={5} className="tl-muted">{r.status === 'awaiting_sessions' ? 'The strategy has not completed enough trading sessions yet.' : r.status === 'not_backtestable' ? 'This strategy cannot be evaluated with the available historical test.' : r.reason ?? 'No completed result has been published.'}</td>}
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
          <p className="tl-content-help">These entries show recorded stock evaluations and any proposed orders. They are not a complete transcript of the AI system's reasoning or evidence that a trade was executed.</p>
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
                  <div key={d.id} className="tl-card tl-card-shell tl-card-shell--compact">
                    <div className="tl-small tl-muted tl-evidence-meta">
                      <span>{d.metadata?.asOfSession ? sessionDate(d.metadata.asOfSession, { year: true }) : 'Session unavailable'}</span>
                      <span>{counts.evaluated} {counts.evaluated === 1 ? 'stock was' : 'stocks were'} evaluated. {proposedOrders ? `${proposedOrders} ${proposedOrders === 1 ? 'order was' : 'orders were'} proposed.` : 'No orders proposed.'}</span>
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
          ) : <ContentState {...decisionState(aiState.status, 0)} />}
        </section>
      )}

      <ContentSection title="How this strategy is configured" description="These are the trading limits and evaluation settings published for this strategy." testId="tested-definition">
        {isAi && <FactGrid label="AI trading limits" items={[
          { key: 'capital', label: 'Starting simulated capital', value: moneyWhole(def.config.allocatedAmount ?? 10000) },
          { key: 'order', label: 'Maximum per order', value: moneyWhole(def.config.maxOrderNotional ?? 2000) },
          { key: 'frequency', label: 'Evaluation timing', value: describeEvaluationTiming(def.config, { isAi: true }) },
        ]} />}
        {uniqueStatements(describeGuards({
          config: isAi ? { ...def.config, allocatedAmount: null, maxOrderNotional: null } : def.config,
          rules: def.rules,
        })).length > 0 && (
          <div className="tl-content-rule-group">
            <h3 className="tl-content-subheading">Conditions that determine when the strategy can place an order</h3>
            <ul className="tl-rule-list">
              {!isAi && <li>{def.config.direction === 'sell' ? 'Sells shares it already holds of' : 'Buys'} each symbol it’s tested on</li>}
              {uniqueStatements(describeGuards({
                config: isAi ? { ...def.config, allocatedAmount: null, maxOrderNotional: null } : def.config,
                rules: def.rules,
              })).map((g) => <li key={g}>{g}</li>)}
              {def.parameters?.triggerPrice === 'close_before_window' && <li>Historical trigger: the last closing price before the selected test period</li>}
            </ul>
          </div>
        )}
      </ContentSection>

      {s.design && (
        <TechnicalDetail label="How this strategy is defined and compared" testId="strategy-design">
          <p className="tl-content-help">The following information describes the published strategy objective, the comparison used to evaluate it, and the available decision method.</p>
          <dl className="tl-facts">
            <dt>What the strategy is designed to do</dt><dd>{s.design.objective}</dd>
            <dt>How performance is compared</dt><dd>{s.design.benchmark}</dd>
            <dt>How trading decisions are evaluated</dt><dd>{s.design.parameterBasis}</dd>
            {s.design.developmentEnd && <><dt>Additional historical testing begins</dt><dd>After {sessionDate(s.design.developmentEnd, { year: true })}</dd></>}
          </dl>
        </TechnicalDetail>
      )}

      <TechnicalDetail label="How the performance results were tested" testId="evidence-method">
        <p className="tl-content-help">Historical tests and simulated trades do not predict future investment returns. Actual brokerage orders may execute at different prices or times.</p>
        <ul className="tl-backtest-notes">
          {uniqueStatements(s.assumptions).map((a) => <li key={a}>{a}</li>)}
          {rows[0]?.riskPolicyVersion && <li>Risk policy: {rows[0].riskPolicyVersion}.</li>}
        </ul>
        {rows.some((r) => r.parameters?.triggerPrice) && (
          <p className="tl-small tl-muted">Test-specific trigger prices: {rows.filter((r) => r.parameters?.triggerPrice).map((r) => `${r.symbol} ${money(r.parameters.triggerPrice)} (${sessionDate(r.parameters.triggerFrom, { year: true })})`).join(' · ')}</p>
        )}
      </TechnicalDetail>
      <TechnicalDetail label="Previous published versions" testId="version-history">
        <p className="tl-content-help">Each published version keeps its own strategy definition and results, so earlier tests remain distinguishable from current ones.</p>
        <ul className="tl-backtest-notes" data-testid="version-list">
          {s.versions.map((v) => (
            <li key={v.id}>
              {v.selected ? <strong>{v.id.slice(3, 11)}</strong> : <Link to={v.current ? `/strategies/${encodeURIComponent(s.templateId)}` : `/strategies/${encodeURIComponent(s.templateId)}?version=${v.id}`}>{v.id.slice(3, 11)}</Link>}
              {' '}· published {sessionDate(v.firstSession, { year: true })}{v.current ? ' · current' : ''}
            </li>
          ))}
        </ul>
      </TechnicalDetail>
    </main>
  )
}
