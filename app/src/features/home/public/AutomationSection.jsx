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
        <h2 id="public-automation-title">Track the work behind each trading cycle.</h2>
        <p>Market data, pending simulated orders, AI research, portfolio valuation, and evidence publication are separate stages. The platform records their execution state so you can distinguish completed work from missing or failed events.</p>
      </header>
      {visible ? <PipelinePulse/> : <div className="tl-public-panel tl-public-pipeline__state" aria-hidden="true">Automation status</div>}
    </section>
  )
}
