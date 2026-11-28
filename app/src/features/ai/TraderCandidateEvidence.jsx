import { sessionDate, signedPct, tone } from '../../ui/format'

/**
 * Screening results are NOT AI decisions. Only matching persisted research
 * decisions may carry an action, thesis or model confidence.
 */
export function matchRecordedDecision(research, symbol) {
  for (const cycle of Array.isArray(research) ? research : []) {
    const found = (cycle.decisions || []).find(d => d.symbol === symbol)
    if (found) return { ...found, asOfSession: cycle.asOfSession }
  }
  return null
}

export default function TraderCandidateEvidence({ discovery, research = [] }) {
  const candidates = Array.isArray(discovery?.discoveries) ? discovery.discoveries.slice(0, 8) : []
  return <section className="tl-section" aria-label="AI trader stock screening">
    <div className="tl-section-head">
      <div>
        <h2 className="tl-section-title">Stocks under consideration</h2>
        <p className="tl-section-note">Screened from {discovery?.universeScanned ?? 'an unavailable number of'} companies as of {sessionDate(discovery?.asOfSession, { year: true })}. Screening alone does not mean the AI recommended or purchased a stock.</p>
      </div>
    </div>
    {!candidates.length ? <p className="tl-section-note">No screening candidates are available for this session.</p> :
      <div className="tl-ai-feed" data-testid="trader-screened-candidates">
        {candidates.map(item => {
          const decision = matchRecordedDecision(research, item.symbol)
          return <article className="tl-card tl-card-shell tl-card-shell--compact" key={item.symbol}>
            <div className="tl-section-head">
              <div><h3>{item.symbol} · {item.name}</h3>
                <p className="tl-small tl-muted">{item.sector} · {item.themeLabel || 'Screened candidate'}</p></div>
              <strong className={tone(item.indicators?.return20dPct)}>{signedPct(item.indicators?.return20dPct)} <small className="tl-muted">20 sessions</small></strong>
            </div>
            {item.whyItMatters?.length > 0 && <p>{item.whyItMatters[0]}</p>}
            {decision ? <div className="tl-flow-card">
              <p><strong>Recorded AI decision:</strong> {decision.action} · {sessionDate(decision.asOfSession)}</p>
              {decision.thesis && <p>{decision.thesis}</p>}
              {decision.risks?.length > 0 && <p className="tl-small">Recorded risks: {decision.risks.join('; ')}</p>}
              <p className="tl-small tl-muted">A model decision is not proof of order execution.</p>
            </div> : <p className="tl-small tl-muted">No recorded AI decision for this symbol in the available research cycles.</p>}
          </article>
        })}
      </div>}
  </section>
}
