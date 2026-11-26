import { Link } from 'react-router-dom'

const EVIDENCE_TYPES = [
  {
    name:'Historical backtests',
    detail:'Evaluate strategy rules over recorded market periods.',
    limit:'Results depend on the data, assumptions, and test period.',
  },
  {
    name:'Holdout evaluations',
    detail:'Inspect available periods separated from development.',
    limit:'Holdout results are still historical and can overstate future robustness.',
  },
  {
    name:'Forward paper trading',
    detail:'Review simulated decisions and orders recorded after publication.',
    limit:'A paper track record is not an actual investor return.',
  },
]
const REPORT_FIELDS = [
  ['Returns', 'Strategy median alongside a buy-and-hold benchmark'],
  ['Risk', 'Available drawdown measurements and exposure'],
  ['Execution', 'Trades, tested symbols, and nontrading periods'],
  ['Traceability', 'Strategy version, observation window, and methodology'],
]

/** Methodology explains actual strategy-detail reports without fabricating a backtest. */
export default function EvidenceMethodSection() {
  return (
    <section className="tl-public-section" id="public-testing" aria-labelledby="public-testing-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">BACKTESTING & METHODOLOGY</p>
        <h2 id="public-testing-title">Evaluate trading strategies using historical and forward-testing results.</h2>
        <p>TradeLoom publishes historical backtests and available forward paper-trading observations with performance comparisons, execution records, and testing limitations. Each report distinguishes the conditions under which the results were produced.</p>
      </header>
      <div className="tl-public-method-grid">
        <div className="tl-public-method__types">
          {EVIDENCE_TYPES.map((type, index) => (
            <article className="tl-public-method__type" key={type.name}>
              <span className="tl-public-method__number">0{index + 1}</span>
              <div>
                <h3>{type.name}</h3>
                <p>{type.detail}</p>
                <p className="tl-public-method__limit">{type.limit}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="tl-public-panel tl-public-method__report">
          <p className="tl-public-method__eyebrow">INSIDE A STRATEGY REPORT</p>
          <h3>Compare performance and examine risk.</h3>
          <dl>
            {REPORT_FIELDS.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          <Link className="tl-public-button tl-public-button--primary" to="/strategies">Review published strategy reports</Link>
          <p className="tl-public-method__disclaimer">Only metrics present in the selected strategy's evidence are shown. No investment returns are guaranteed.</p>
        </div>
      </div>
    </section>
  )
}
