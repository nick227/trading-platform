import { useEffect, useState } from 'react'
import PipelinePulse from './PipelinePulse'

export default function AutomationSection() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const element = document.getElementById('public-automation')
    if (!element) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(item => item.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, {rootMargin:'320px'})
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <section className="tl-public-section" id="public-automation" aria-labelledby="public-automation-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">AUTOMATED PAPER TRADING</p>
        <h2 id="public-automation-title">Trading strategies are designed to operate through automated execution workflows.</h2>
        <p>TradeLoom coordinates market data, research decisions, order processing, portfolio valuation, and strategy reporting. The current beta records the execution status of supported paper-trading stages. Real-money brokerage execution is planned for a future release.</p>
      </header>
      {visible ? <PipelinePulse/> : <div className="tl-public-panel tl-public-pipeline__state" aria-hidden="true">Automation status</div>}
    </section>
  )
}
