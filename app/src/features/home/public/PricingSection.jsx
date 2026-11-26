const AVAILABLE = [
  'Create a free account',
  'Browse published strategies without signing in',
  'Inspect historical backtests and forward paper observations',
  'Explore simulated trading through available account features',
]
const PLANNED = [
  'Expanded automated bot access',
  'More advanced strategy configuration',
  'Additional portfolio analytics',
  'Extended AI research tools',
]
export default function PricingSection() {
  return (
    <section className="tl-public-section" id="pricing" aria-labelledby="pricing-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">MEMBERSHIP</p>
        <h2 id="pricing-title">Start free. Upgrade when you need more.</h2>
        <p>Open an account without depositing money or starting a paid subscription. Premium access is being prepared; its pricing and availability have not been announced.</p>
      </header>
      <div className="tl-public-plan-grid">
        <article className="tl-public-panel tl-public-plan">
          <div className="tl-public-plan__header">
            <p className="tl-public-plan-name">Free</p>
            <span className="tl-public-plan__status">Available</span>
          </div>
          <h3>$0 <span className="tl-public-plan__cadence">to start</span></h3>
          <p>Explore the platform and inspect published paper-trading evidence.</p>
          <ul>{AVAILABLE.map(item => <li key={item}>{item}</li>)}</ul>
          <a className="tl-public-button tl-public-button--primary" href="#get-started">Create free account</a>
        </article>
        <article className="tl-public-panel tl-public-plan tl-public-plan--premium">
          <div className="tl-public-plan__header">
            <p className="tl-public-plan-name">Premium</p>
            <span className="tl-public-plan__status tl-public-plan__status--planned">Planned</span>
          </div>
          <h3>Pricing to be announced</h3>
          <p>Additional tools and higher levels of access are planned for a paid membership.</p>
          <ul>{PLANNED.map(item => <li key={item}>{item} <span className="tl-public-plan__future">(planned)</span></li>)}</ul>
          <a className="tl-public-button tl-public-button--secondary" href="#get-started">Explore with a free account</a>
        </article>
      </div>
      <p className="tl-public-disclosure">Premium features, entitlements, monthly and annual pricing, and any first-month promotion remain subject to launch. Account registration does not start a subscription or billed trial.</p>
    </section>
  )
}
