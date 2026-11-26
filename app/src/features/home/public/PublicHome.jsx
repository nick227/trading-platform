import { Link } from 'react-router-dom'
import AuthPanel from './AuthPanel'
import PricingSection from './PricingSection'
import LiveBotsSection from './LiveBotsSection'
import StockResearchSection from './StockResearchSection'
import AutomationSection from './AutomationSection'
import ProductStorySection from './ProductStorySection'
import ConversionFooter from './ConversionFooter'
import './public-home.css'

const WORKFLOW = [
  { step: '01', label: 'Research', description: 'Review AI research and published strategy evidence.' },
  { step: '02', label: 'Automate', description: 'Assign simulated capital to an eligible bot.' },
  { step: '03', label: 'Inspect', description: 'Review paper orders, holdings, and strategy results.' },
]

/** Honest, data-independent workflow preview: no fabricated trades or performance. */
function WorkflowPreview() {
  return (
    <div className="tl-public-workflow" aria-label="TradeLoom product workflow" data-testid="hero-workflow">
      <div className="tl-public-workflow__head">
        <div>
          <span className="tl-public-workflow__eyebrow">INSIDE TRADELOOM</span>
          <h2>Research to execution, in one place.</h2>
        </div>
        <span className="tl-public-workflow__mode">PAPER MODE</span>
      </div>
      <ol className="tl-public-workflow__steps">
        {WORKFLOW.map(item => (
          <li key={item.step}>
            <span className="tl-public-workflow__index">{item.step}</span>
            <div><strong>{item.label}</strong><span>{item.description}</span></div>
          </li>
        ))}
      </ol>
      <Link to="/strategies" className="tl-public-workflow__link">Inspect published strategy evidence <span aria-hidden="true">↗</span></Link>
      <p className="tl-public-workflow__note">Workflow overview, not a live trade or performance report.</p>
    </div>
  )
}

/** Logged-out home is intentionally independent of evidence API availability. */
export default function PublicHome() {
  return (
    <main className="tl-public-home" data-testid="public-home">
      <section className="tl-public-section tl-public-hero" aria-labelledby="welcome-title">
        <div className="tl-public-hero__copy">
          <p className="tl-public-eyebrow">AI RESEARCH · AUTOMATED PAPER TRADING</p>
          <h1 id="welcome-title">AI stock research and automated trading.</h1>
          <p className="tl-public-lede">Research stocks, evaluate strategies, and run automated paper trades. Review recorded results and maintain control of your bots.</p>
          <div className="tl-public-hero__actions">
            <a className="tl-public-button tl-public-button--secondary" href="#get-started">Create a free account</a>
            <Link className="tl-public-hero__evidence-link" to="/strategies">Explore published results <span aria-hidden="true">↗</span></Link>
          </div>
          <ul className="tl-public-hero__facts" aria-label="Account and trading facts">
            <li>No deposit required</li><li>Paper trading only</li><li>No paid subscription to start</li>
          </ul>
          <WorkflowPreview />
        </div>
        <AuthPanel />
      </section>
      <PricingSection />
      <LiveBotsSection />
      <StockResearchSection />
      <AutomationSection />
      <ProductStorySection />
      <ConversionFooter />
    </main>
  )
}
