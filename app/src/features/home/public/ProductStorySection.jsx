import { Link } from 'react-router-dom'
import { JOURNEY, CAPABILITIES } from './content'

export default function ProductStorySection() {
  return <>
    <section className="tl-public-section" id="how-it-works" aria-labelledby="public-how-title">
      <header className="tl-public-section-head"><p className="tl-public-eyebrow">HOW IT WORKS</p><h2 id="public-how-title">Automated trading, without the guesswork.</h2><p>Start with an idea, then observe how the bot handles simulated market conditions.</p></header>
      <div className="tl-public-story-grid">{JOURNEY.map(item=><article className="tl-public-panel tl-public-story" key={item.number}><span>{item.number}</span><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
    </section>
    <section className="tl-public-section" id="features" aria-labelledby="public-features-title">
      <header className="tl-public-section-head"><p className="tl-public-eyebrow">PLATFORM CAPABILITIES</p><h2 id="public-features-title">More than a trading chart.</h2><p>Operate bots, examine research, and understand the results of every simulated decision.</p></header>
      <div className="tl-public-story-grid tl-public-story-grid--features">{CAPABILITIES.map(item=><article className="tl-public-panel tl-public-story" key={item.title}><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
      <Link className="tl-public-text-link" to="/strategies">Inspect recorded strategy outcomes →</Link>
    </section>
    <section className="tl-public-section tl-public-trust" aria-labelledby="public-trust-title">
      <div className="tl-public-panel">
        <p className="tl-public-eyebrow">TRANSPARENT BY DESIGN</p><h2 id="public-trust-title">See the results, including the losses.</h2>
        <p>Historical backtests, retrospective research, and forward paper observations are different forms of evidence. TradeLoom distinguishes them so you can evaluate what the bots have actually demonstrated.</p>
        <p><strong>No customer deposits. No live trading.</strong> Automated strategies involve risk in real markets; simulated performance does not guarantee future results.</p>
      </div>
    </section>
  </>
}
