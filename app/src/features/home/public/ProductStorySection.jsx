import { Link } from 'react-router-dom'
import { JOURNEY, CAPABILITIES } from './content'

export default function ProductStorySection() {
  return <>
    <section className="tl-public-section" id="how-it-works" aria-labelledby="public-how-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">PRODUCT WORKFLOW</p>
        <h2 id="public-how-title">TradeLoom connects research, strategy selection, and automated execution.</h2>
        <p>TradeLoom is designed to bring market research, strategy configuration, trade execution, and portfolio monitoring into one system. Live brokerage execution is under development; available beta trading workflows use simulated orders.</p>
      </header>
      <div className="tl-public-story-grid">{JOURNEY.map(item=><article className="tl-public-panel tl-public-story" key={item.number}><span>{item.number}</span><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
    </section>
    <section className="tl-public-section" id="features" aria-labelledby="public-features-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">PLATFORM CAPABILITIES</p>
        <h2 id="public-features-title">The platform integrates stock research, automated strategies, and portfolio management.</h2>
        <p>The platform combines stock research, supported strategy controls, and portfolio reporting. Brokerage connections for real-money orders are planned for a later release.</p>
      </header>
      <div className="tl-public-story-grid tl-public-story-grid--features">{CAPABILITIES.map(item=><article className="tl-public-panel tl-public-story" key={item.title}><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
      <div className="tl-public-feature-links">
        <Link className="tl-public-text-link" to="/strategies">Compare strategies <span aria-hidden="true">↗</span></Link>
        <Link className="tl-public-text-link" to="/research">Open stock research <span aria-hidden="true">↗</span></Link>
      </div>
    </section>
    <section className="tl-public-section tl-public-trust" aria-labelledby="public-trust-title">
      <div className="tl-public-panel">
        <p className="tl-public-eyebrow">PRODUCT LIMITATIONS</p>
        <h2 id="public-trust-title">Published strategy results include losses and testing limitations.</h2>
        <p>TradeLoom is being developed for real-money brokerage trading. The current beta supports paper trading, and live orders and deposits are not yet available. All accounts are free during beta</p>
        <p>Historical backtests and forward paper observations are not actual investor returns. Research scores and past strategy performance do not establish future outcomes.</p>
      </div>
    </section>
  </>
}
