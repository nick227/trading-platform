import { Link } from 'react-router-dom'

/** Public product description; internal operational events are not an AI decision diagram. */
export default function AutomationSection() {
  return (
    <section className="tl-public-section" id="public-automation" aria-labelledby="public-automation-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">AUTOMATED TRADING</p>
        <h2 id="public-automation-title">TradeLoom is being developed to automate trading strategies through connected brokerage accounts.</h2>
        <p>TradeLoom brings together market research, strategy configuration, automated execution, and portfolio monitoring. The goal is to help users manage trading systems without placing every order manually.</p>
        <p>Live brokerage execution is still under development. The current beta provides access to supported research, strategy testing, and paper-trading functionality.</p>
      </header>
      <Link className="tl-public-text-link" to="/strategies">Review published strategy results <span aria-hidden="true">↗</span></Link>
    </section>
  )
}
