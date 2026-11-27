import { money, pct, signedMoney, signedPct, sessionDate, ratioPct, tone } from '../../ui/format'

export default function PerformanceIntelligencePanel({ intelligence }) {
  if (!intelligence || intelligence.status === 'not_initialized') return null

  const { comparison, decisionQuality, attribution, diagnostics, statisticalConfidence, window: win } = intelligence
  const awaiting = intelligence.status === 'awaiting_activity'

  return (
    <section className="tl-section" aria-labelledby="perf-intel-heading" data-testid="ai-performance-intelligence">
      <div className="tl-section-head">
        <div>
          <h2 id="perf-intel-heading" className="tl-section-title">AI performance intelligence &amp; attribution</h2>
          <p className="tl-section-note">
            Evaluates whether AI judgment adds measurable value beyond passive market exposure and deterministic screening, net of LLM API spend{win?.firstSession ? ` (${sessionDate(win.firstSession)} → ${sessionDate(win.latestSession, { year: true })})` : ''}.
          </p>
        </div>
        <span className="tl-tag" data-testid="perf-sample-badge">
          {statisticalConfidence?.meetsThreshold ? 'Statistically substantive sample' : `Early sample (${statisticalConfidence?.activeSessionsCount ?? 0}d / ${statisticalConfidence?.closedTradesCount ?? 0} closed)`}
        </span>
      </div>

      {awaiting ? (
        <div className="tl-flow-card" data-testid="perf-intel-awaiting">
          <p><strong>Awaiting multi-session forward activity</strong></p>
          <p className="tl-small tl-muted">
            Benchmark alpha, thesis follow-through, and contributor attribution populate automatically once scheduled paper research cycles and fills are recorded.
          </p>
        </div>
      ) : (
        <>
          <dl className="tl-stats tl-stats--3 tl-stat-grid--flush" data-testid="perf-benchmark-comparison">
            <div className="tl-stat">
              <dt>AI net return (after LLM cost)</dt>
              <dd>
                <span className={tone(comparison?.aiNetReturnPct)}>{signedPct(comparison?.aiNetReturnPct)}</span>
                <small>Gross {signedPct(comparison?.aiGrossReturnPct)} · LLM spend ${comparison?.modelCostUsd?.toFixed(4) ?? '0.0000'}</small>
              </dd>
            </div>
            <div className="tl-stat">
              <dt>vs SPY buy-and-hold</dt>
              <dd>
                <span className={tone(comparison?.excessVsSpyPctPoints)}>{signedPct(comparison?.excessVsSpyPctPoints)}</span>
                <small>SPY window return: {signedPct(comparison?.spyReturnPct)}</small>
              </dd>
            </div>
            <div className="tl-stat">
              <dt>vs Deterministic screener</dt>
              <dd>
                <span className={tone(comparison?.excessVsDeterministicPctPoints)}>{signedPct(comparison?.excessVsDeterministicPctPoints)}</span>
                <small>Screener baseline: {signedPct(comparison?.deterministicScreenerReturnPct)}</small>
              </dd>
            </div>
          </dl>

          <div className="tl-flow-card" style={{ marginTop: '0.75rem' }} data-testid="perf-decision-quality">
            <p className="tl-small">
              <strong>Hypothesis &amp; selectivity scorecard:</strong>{' '}
              Research cycles: <strong>{decisionQuality?.completedCyclesCount ?? 0}</strong> ({decisionQuality?.qualitativeBackedCyclesCount ?? 0} with SEC/news evidence)
              {' · '}
              Thesis hit rate: <strong>{decisionQuality?.thesisHitRatePct != null ? pct(decisionQuality.thesisHitRatePct) : '—'}</strong>
              {' · '}
              Closed-trade win rate: <strong>{decisionQuality?.winRatePct != null ? pct(decisionQuality.winRatePct) : '—'}</strong>
              {' · '}
              Drawdowns avoided via HOLD/abstain: <strong>{decisionQuality?.selectivity?.avoidedDrawdownCount ?? 0}</strong>
              {' · '}
              Protective exits: <strong>{decisionQuality?.protectiveExits?.takeProfitCount ?? 0} TP / {decisionQuality?.protectiveExits?.stopLossCount ?? 0} SL</strong>
            </p>
          </div>

          {(attribution?.topContributors?.length > 0 || attribution?.topDetractors?.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }} data-testid="perf-position-attribution">
              <div className="tl-card tl-card-shell tl-card-shell--compact">
                <h3 className="tl-small"><strong>Top contributors</strong></h3>
                {attribution.topContributors?.length ? (
                  <ul className="tl-backtest-notes">
                    {attribution.topContributors.map(c => (
                      <li key={c.symbol}>
                        <strong>{c.symbol}</strong> ({c.sector}): <span className="tl-pos">{signedMoney(c.totalPnl)} ({signedPct(c.contributionPctPoints)})</span>
                        {c.thesis ? ` — ${c.thesis}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : <p className="tl-small tl-muted">No positive contributors recorded yet.</p>}
              </div>

              <div className="tl-card tl-card-shell tl-card-shell--compact">
                <h3 className="tl-small"><strong>Primary detractors</strong></h3>
                {attribution.topDetractors?.length ? (
                  <ul className="tl-backtest-notes">
                    {attribution.topDetractors.map(d => (
                      <li key={d.symbol}>
                        <strong>{d.symbol}</strong> ({d.sector}): <span className="tl-neg">{signedMoney(d.totalPnl)} ({signedPct(d.contributionPctPoints)})</span>
                        {d.thesis ? ` — ${d.thesis}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : <p className="tl-small tl-muted">No losing positions recorded in window.</p>}
              </div>
            </div>
          )}

          {attribution?.recentHypotheses?.length > 0 && (
            <details className="tl-flow-card" style={{ marginTop: '0.75rem' }} data-testid="perf-hypothesis-ledger">
              <summary><strong>Evaluated thesis outcomes ({attribution.recentHypotheses.length})</strong></summary>
              <ul className="tl-backtest-notes">
                {attribution.recentHypotheses.map((h, idx) => (
                  <li key={`${h.symbol}-${h.asOfSession}-${idx}`}>
                    <strong>{h.symbol}</strong> · {h.action} ({sessionDate(h.asOfSession)}{h.confidence ? `, conviction ${ratioPct(h.confidence, 0)}` : ''}) → Subsequent move{' '}
                    <span className={tone(h.forwardMovePct)}>{signedPct(h.forwardMovePct)}</span>{' '}
                    (<strong>{h.outcome === 'held_up' ? 'Hypothesis held up' : 'Struggled'}</strong>)
                    {h.thesis ? ` — ${h.thesis}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {(diagnostics?.strengths?.length > 0 || diagnostics?.weaknesses?.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }} data-testid="perf-strengths-weaknesses">
          <div className="tl-flow-card">
            <p className="tl-small"><strong>Observed strengths</strong></p>
            {diagnostics.strengths?.length ? (
              <ul className="tl-backtest-notes">
                {diagnostics.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            ) : <p className="tl-small tl-muted">Insufficient forward history to establish strengths.</p>}
          </div>
          <div className="tl-flow-card">
            <p className="tl-small"><strong>Weaknesses &amp; caveats</strong></p>
            {diagnostics.weaknesses?.length ? (
              <ul className="tl-backtest-notes">
                {diagnostics.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            ) : <p className="tl-small tl-muted">No acute weaknesses flagged.</p>}
          </div>
        </div>
      )}

      {statisticalConfidence?.note && (
        <p className="tl-section-note" data-testid="perf-statistical-note">{statisticalConfidence.note}</p>
      )}
    </section>
  )
}
