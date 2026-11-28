import { money, signedMoney, signedPct, sessionDate, tone } from '../../ui/format'

/**
 * A public evidence summary, not a personal trading account.
 * All values must come from the recorded flagship payload.
 */
export default function TraderStoryOverview({ data }) {
  const performance = data?.performance
  const latest = Array.isArray(data?.research) ? data.research[0] : null
  const comparison = data?.performanceIntelligence?.comparison
  const sample = data?.performanceIntelligence?.statisticalConfidence
  return <section className="tl-section tl-trader-story" aria-labelledby="trader-story-title"
    data-testid="trader-story-overview">
    <div className="tl-section-head">
      <div>
        <p className="tl-small tl-muted">Public demonstration · simulated money</p>
        <h2 id="trader-story-title" className="tl-section-title">The AI Trader's track record</h2>
        <p className="tl-lead-sentence">Follow the research, decisions and paper orders behind this automated trading system.</p>
      </div>
    </div>
    <dl className="tl-stats tl-stats--3 tl-stat-grid--flush">
      <div className="tl-stat"><dt>Paper portfolio value</dt>
        <dd>{money(performance?.totalEquity)}
          <small>Initial allocation {money(data?.capitalAllocated)}</small></dd></div>
      <div className="tl-stat"><dt>Recorded paper profit or loss</dt>
        <dd className={tone(performance?.totalPnl)}>{signedMoney(performance?.totalPnl)}
          <small>{performance?.fillCount ?? '—'} recorded fills</small></dd></div>
      <div className="tl-stat"><dt>Return compared with S&P 500</dt>
        <dd className={tone(comparison?.excessVsSpyPctPoints)}>
          {sample?.meetsThreshold && Number.isFinite(comparison?.excessVsSpyPctPoints)
            ? signedPct(comparison.excessVsSpyPctPoints) : '—'}
          <small>{sample?.meetsThreshold
            ? 'Comparable period · paper results'
            : 'Insufficient observations for a meaningful comparison'}</small></dd></div>
    </dl>
    <p className="tl-section-note">Latest recorded research: {sessionDate(latest?.asOfSession, { year:true })}.
      {' '}These results describe a platform-operated paper account, not your portfolio or realized investment earnings.</p>
    <div className="tl-trader-story-links">
      <a href="#ai-trader-decisions" className="tl-btn tl-btn--secondary">Read the decisions</a>
      <a href="#ai-trader-history" className="tl-btn tl-btn--secondary">Review performance history</a>
    </div>
  </section>
}
