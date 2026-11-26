import { Link } from 'react-router-dom'
import { JOURNEY, CAPABILITIES } from './content'

export default function ProductStorySection() {
  return <>
    <section className="tl-public-section" id="how-it-works" aria-labelledby="public-how-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">PRODUCT WORKFLOW</p>
        <h2 id="public-how-title">Choose a strategy. Allocate paper capital. Inspect the results.</h2>
        <p>TradeLoom combines public strategy evidence with account-based simulated bot operations.</p>
      </header>
      <div className="tl-public-story-grid">{JOURNEY.map(item=><article className="tl-public-panel tl-public-story" key={item.number}><span>{item.number}</span><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
    </section>
    <section className="tl-public-section" id="features" aria-labelledby="public-features-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">PLATFORM CAPABILITIES</p>
        <h2 id="public-features-title">Research, automation, and portfolio oversight.</h2>
        <p>Explore the stock research workflow, manage simulated bots, and examine their recorded results.</p>
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
        <h2 id="public-trust-title">Simulated trading, clearly identified.</h2>
        <p>TradeLoom currently uses paper capital. Registration does not require a brokerage deposit and does not initiate a paid subscription. Live brokerage orders are disabled.</p>
        <p>Published historical tests and forward paper observations are not investor returns. No research score, bot action, or past result guarantees a future outcome.</p>
      </div>
    </section>
  </>
}
