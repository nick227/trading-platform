import AuthPanel from './AuthPanel'
import PricingSection from './PricingSection'
import LiveBotsSection from './LiveBotsSection'
import ProductStorySection from './ProductStorySection'
import './public-home.css'

/** Logged-out marketing page. Never couple rendering to market-data availability. */
export default function PublicHome() {
  return (
    <main className="tl-public-home" data-testid="public-home">
      <section className="tl-public-section tl-public-hero" aria-labelledby="welcome-title">
        <div className="tl-public-hero__copy">
          <p className="tl-public-eyebrow">AUTOMATED PAPER TRADING</p>
          <h1 id="welcome-title">Trading bots you can watch and control.</h1>
          <p className="tl-public-lede">Choose a strategy, assign simulated capital, and follow every decision. Pause or stop whenever you choose.</p>
          <p className="tl-public-disclosure"><strong>Paper trading only.</strong> No deposits or live orders.</p>
        </div>
        <AuthPanel />
      </section>
      <PricingSection />
      <LiveBotsSection />
      <ProductStorySection />
    </main>
  )
}
