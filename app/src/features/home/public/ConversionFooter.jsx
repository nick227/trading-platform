import { useEffect } from 'react'
import { Link } from 'react-router-dom'

const FAQ = [
  {q:'Does TradeLoom place real-money trades?',a:'No. TradeLoom currently uses simulated capital for paper trading. Deposits and live brokerage orders are disabled.'},
  {q:'Can I inspect results before registering?',a:'Yes. Published strategy evidence, including negative and incomplete results, is available without an account.'},
  {q:'Are stock research rankings buy recommendations?',a:'No. Rankings are research observations; they are not personalized investment advice or predictions of returns.'},
  {q:'Do I need a paid subscription to get started?',a:'No. Registration does not start a subscription or billed trial. Premium features and pricing are still planned.'},
  {q:'What happens when I pause a bot?',a:'Eligible bots have pause and stop controls. Existing simulated orders are handled according to the system\'s execution rules.'},
  {q:'Are backtest returns guaranteed?',a:'No. Backtests and paper trades are simulated observations, not returns earned by investors, and do not predict future results.'},
]

export default function ConversionFooter() {
  useEffect(() => {
    const description = 'TradeLoom offers AI-assisted stock research, automated paper trading bots, public strategy backtests, and transparent simulated performance evidence.'
    let meta = document.querySelector('meta[name="description"]')
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta) }
    const previous = meta.getAttribute('content')
    meta.setAttribute('content', description)
    return () => { if (previous === null) meta.removeAttribute('content'); else meta.setAttribute('content', previous) }
  }, [])
  return <>
    <section className="tl-public-section" id="faq" aria-labelledby="public-faq-title">
      <header className="tl-public-section-head"><p className="tl-public-eyebrow">COMMON QUESTIONS</p><h2 id="public-faq-title">Before you create an account.</h2></header>
      <div className="tl-public-faq">{FAQ.map(x => <details key={x.q}><summary>{x.q}</summary><p>{x.a}</p></details>)}</div>
    </section>
    <section className="tl-public-section" id="public-final-cta" aria-labelledby="public-final-title">
      <div className="tl-public-final">
        <h2 id="public-final-title">Create a free TradeLoom account.</h2>
        <p>Research stocks, evaluate published strategies, and explore automated paper trading. No deposit or paid subscription required to register.</p>
        <a className="tl-public-button tl-public-button--primary" href="#get-started">Create free account</a>
        <Link className="tl-public-text-link" to="/strategies">Inspect strategies without signing in <span aria-hidden="true">↗</span></Link>
      </div>
    </section>
    <footer className="tl-public-footer">
      <span>© {new Date().getFullYear()} TradeLoom · Paper trading only</span>
      <nav aria-label="Public homepage links">
        <a href="#pricing">Membership</a>
        <Link to="/strategies">Strategy results</Link>
        <a href="#faq">FAQ</a>
      </nav>
      <span>No deposits or live orders. Simulated returns are not guaranteed.</span>
    </footer>
  </>
}
