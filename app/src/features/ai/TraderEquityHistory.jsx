import ValueChart from '../../ui/ValueChart'
import { money, sessionDate } from '../../ui/format'

/** Only completed-session, fill-backed paper history; never fabricate missing days. */
export default function TraderEquityHistory({ intelligence, initialCapital }) {
  const history = intelligence?.equityHistory
  const points = Array.isArray(history?.points) ? history.points.filter(
    p => typeof p?.t === 'string' && Number.isFinite(p.v)) : []
  const compare = points.filter(p => Number.isFinite(p.spy)).map(p=>({t:p.t,v:p.spy}))
  return <section className="tl-section" aria-label="Verified paper equity history"
    data-testid="trader-equity-history">
    <div className="tl-section-head"><div>
      <h2 className="tl-section-title">How the paper account has performed</h2>
      <p className="tl-section-note">Recorded simulated fills valued using the available historical daily closes. This is not an actual brokerage account.</p>
    </div></div>
    {points.length < 2 ? <p role="status" className="tl-section-note">Not enough complete, dated sessions to draw a performance history yet.</p> : <>
      <ValueChart points={points} secondaryPoints={compare.length >= 2 ? compare : null}
        secondaryLabel="SPY buy-and-hold on the same observed dates"
        baseline={Number.isFinite(initialCapital) ? initialCapital : null}
        label="Platform AI paper equity" minSpan={Math.max((initialCapital||0)*0.01,1)}/>
      <p className="tl-small tl-muted">From {sessionDate(points[0].t,{year:true})} to {sessionDate(points.at(-1).t,{year:true})}.
        {' '}SPY is rebased to the initial paper allocation for the chart where matching closes are available.</p>
    </>}
    {history?.omittedSessions > 0 && <p role="status" className="tl-small tl-muted">
      {history.omittedSessions} session(s) omitted because required market closes or valuations were unavailable.
    </p>}
    <p className="tl-section-note">Historical paper performance does not predict future returns. A comparison is descriptive until a sufficient sample has accumulated.</p>
  </section>
}
