import { Link } from 'react-router-dom'

const EVIDENCE_TYPES = [
  {
    name:'Testing strategies against past market data',
    detail:'Historical backtesting shows how a strategy would have behaved using recorded prices and trading conditions.',
    limit:'Results depend on the data, assumptions, and test period.',
  },
  {
    name:'Testing against historical data not used during development',
    detail:'These tests use a separate period of past market data to check whether the strategy also performed outside the data used to develop it.',
    limit:'Results from a separate historical period still do not establish future performance.',
  },
  {
    name:'Testing with new market activity without placing real orders',
    detail:'Paper trading records simulated decisions and orders as new market activity occurs after a strategy has been published.',
    limit:'These observations do not represent returns earned with real money.',
  },
]
const REPORT_FIELDS = [
  ['Returns', 'Typical strategy result compared with buying and holding the same investments'],
  ['Risk', 'Available measures of portfolio declines and market exposure'],
  ['Activity', 'Recorded trades, investments tested, and periods without trades'],
  ['Test details', 'Strategy version, dates covered, and how the results were calculated'],
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
          <p className="tl-public-method__eyebrow">STRATEGY REPORT CONTENT</p>
          <h3>Strategy reports include performance comparisons and available risk measurements.</h3>
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
