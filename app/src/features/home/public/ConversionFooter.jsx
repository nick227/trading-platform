import { useEffect } from 'react'
import { Link } from 'react-router-dom'

const FAQ = [
  {q:'When will TradeLoom support real-money trading?',a:'TradeLoom is being developed for live brokerage execution, with access intended for a future Premium membership. Live trading, deposits, and a launch date are not currently available.'},
  {q:'Can I inspect results before registering?',a:'Yes. Published strategy evidence, including negative and incomplete results, is available without an account.'},
  {q:'Are stock research rankings buy recommendations?',a:'No. Rankings are research observations; they are not personalized investment advice or predictions of returns.'},
  {q:'Are TradeLoom accounts free during beta?',a:'Yes. All accounts are currently free during beta development. Paid memberships are planned for commercial release, but pricing and subscription terms have not been announced.'},
  {q:'What trading capabilities are available now?',a:'The beta includes available stock research, strategy evaluation, and supported paper-trading workflows. Live brokerage orders and deposits are not yet available.'},
  {q:'Are backtest returns guaranteed?',a:'No. Backtests and paper trades are simulated observations, not returns earned by investors, and do not predict future results.'},
]

export default function ConversionFooter() {
  useEffect(() => {
    const description = 'TradeLoom is an automated trading platform in beta development, integrating AI-assisted stock research, strategy testing, execution workflows, and portfolio monitoring. Live brokerage trading is planned.'
    let meta = document.querySelector('meta[name="description"]')
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta) }
    const previous = meta.getAttribute('content')
    meta.setAttribute('content', description)
    return () => { if (previous === null) meta.removeAttribute('content'); else meta.setAttribute('content', previous) }
  }, [])
  return <>
    <section className="tl-public-section" id="faq" aria-labelledby="public-faq-title">
      <header className="tl-public-section-head"><p className="tl-public-eyebrow">COMMON QUESTIONS</p><h2 id="public-faq-title">Information about the current beta and planned release.</h2></header>
      <div className="tl-public-faq">{FAQ.map(x => <details key={x.q}><summary>{x.q}</summary><p>{x.a}</p></details>)}</div>
    </section>
    <section className="tl-public-section" id="public-final-cta" aria-labelledby="public-final-title">
      <div className="tl-public-final">
        <h2 id="public-final-title">Register for the TradeLoom beta.</h2>
        <p>All accounts are currently free during development. Registered users can explore supported research, strategy testing, and paper-trading features while live brokerage execution is being developed.</p>
        <a className="tl-public-button tl-public-button--primary" href="#get-started">Register for beta access</a>
        <Link className="tl-public-text-link" to="/strategies">Inspect strategies without signing in <span aria-hidden="true">↗</span></Link>
      </div>
    </section>
    <footer className="tl-public-footer">
      <span>© {new Date().getFullYear()} TradeLoom · Beta development</span>
      <nav aria-label="Public homepage links">
        <a href="#pricing">Membership</a>
        <Link to="/strategies">Strategy results</Link>
        <a href="#faq">FAQ</a>
      </nav>
      <span>Live brokerage orders are not yet available. Historical and simulated results do not guarantee future returns.</span>
    </footer>
  </>
}
