import AuthPanel from './AuthPanel'
import PricingSection from './PricingSection'
import LiveBotsSection from './LiveBotsSection'
import ProductStorySection from './ProductStorySection'
import StockResearchSection from './StockResearchSection'
import AutomationSection from './AutomationSection'
import EvidenceMethodSection from './EvidenceMethodSection'
import ConversionFooter from './ConversionFooter'
import './public-home.css'

/** Keep the original explanation + registration entry and information sequence. */
export default function PublicHome() {
  return (
    <main className="tl-public-home" data-testid="public-home">
      <section className="tl-public-section tl-public-hero" aria-labelledby="welcome-title">
        <div className="tl-public-hero__copy">
          <p className="tl-public-eyebrow">AUTOMATED TRADING PLATFORM</p>
          <h1 id="welcome-title">Automated trading with integrated research, strategy testing, and portfolio management.</h1>
          <p className="tl-public-lede">TradeLoom is being developed to research market opportunities, evaluate trading strategies, and automate execution through connected brokerage accounts. The current beta supports available paper-trading workflows while live brokerage trading is under development.</p>
          <p className="tl-public-disclosure"><strong>Beta access is currently free.</strong> Real-money brokerage execution is not yet available.</p>
        </div>
        <AuthPanel />
      </section>
      <PricingSection />
      <LiveBotsSection />
      <ProductStorySection />
      <StockResearchSection />
      <AutomationSection />
      <EvidenceMethodSection />
      <ConversionFooter />
    </main>
  )
}
