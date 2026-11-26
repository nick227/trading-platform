import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../app/AuthProvider'

const FAQ = [
  {q:'Is TradeLoom trading real money?',a:'No. TradeLoom uses simulated capital and paper trading. Live brokerage orders are disabled.'},
  {q:'Can I explore results without registering?',a:'Yes. Public strategy evidence is available without an account, including published negative results.'},
  {q:'Will Premium be charged after the first month?',a:'Premium billing has not launched. We plan a first-month offer; actual pricing, renewal and cancellation terms will be shown before any paid enrollment.'},
  {q:'Can I stop a trading bot?',a:'The app provides controls for eligible user bots, including pause and stop. Simulated orders remain subject to their existing execution rules.'},
  {q:'Are simulated returns guaranteed?',a:'No. Backtests and paper trading are not real-money customer returns and cannot predict future performance.'}
]

export default function ConversionFooter() {
  const { user } = useAuth()
  useEffect(()=>{
    const description='Explore automated paper trading bots, AI strategy research, and transparent simulated performance evidence on TradeLoom.'
    let meta=document.querySelector('meta[name="description"]')
    if (!meta) { meta=document.createElement('meta');meta.name='description';document.head.appendChild(meta) }
    const previous=meta.getAttribute('content')
    meta.setAttribute('content',description)
    return ()=>{if(previous===null)meta.removeAttribute('content');else meta.setAttribute('content',previous)}
  },[])
  return <>
    <section className="tl-public-section" id="faq" aria-labelledby="public-faq-title">
      <header className="tl-public-section-head"><p className="tl-public-eyebrow">QUESTIONS</p><h2 id="public-faq-title">Everything you need to get started.</h2></header>
      <div className="tl-public-faq">{FAQ.map(x=><details key={x.q}><summary>{x.q}</summary><p>{x.a}</p></details>)}</div>
    </section>
    <section className="tl-public-section" id="public-final-cta" aria-labelledby="public-final-title">
      <div className="tl-public-final">
        <h2 id="public-final-title">Your next trading idea starts here.</h2>
        <p>Start exploring automated paper trading and the evidence behind every strategy.</p>
        <a className="tl-public-button tl-public-button--primary" href="#get-started">Create a free account</a>
        <Link className="tl-public-text-link" to="/strategies">Browse strategies first →</Link>
      </div>
    </section>
    <footer className="tl-public-footer"><span>© {new Date().getFullYear()} TradeLoom · Simulated trading only</span><span>Live orders and deposits are disabled. Not a guarantee of investment returns.</span></footer>
  </>
}
