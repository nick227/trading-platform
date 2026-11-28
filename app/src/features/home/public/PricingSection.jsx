export default function PricingSection() {
  return (
    <section className="tl-public-section" id="pricing" aria-labelledby="pricing-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">MEMBERSHIP</p>
        <h2 id="pricing-title">All accounts are free during beta</h2>
        <p>TradeLoom is available without a subscription while the platform is being developed and tested. Paid memberships are planned for commercial release, with Premium intended to provide access to real-money brokerage trading when that capability becomes available.</p>
      </header>
      <div className="tl-public-plan-grid">
        <article className="tl-public-panel tl-public-plan">
          <div className="tl-public-plan__header">
            <p className="tl-public-plan-name">Beta access</p>
            <span className="tl-public-plan__status">Available</span>
          </div>
          <h3>$0 <span className="tl-public-plan__cadence">during beta</span></h3>
          <p>All registered accounts can use the functionality currently available during development, including supported research, strategy evaluation, and paper-trading tools.</p>
          <a className="tl-public-button tl-public-button--primary" href="#get-started">Register for beta access</a>
        </article>
        <article className="tl-public-panel tl-public-plan tl-public-plan--premium">
          <div className="tl-public-plan__header">
            <p className="tl-public-plan-name">Premium</p>
            <span className="tl-public-plan__status tl-public-plan__status--planned">Planned</span>
          </div>
          <h3>Pricing to be announced</h3>
          <p>Premium is planned as a paid membership that will provide access to real-money brokerage trading when live execution is released. Live orders and paid enrollment are not available during the current beta.</p>
          <a className="tl-public-button tl-public-button--secondary" href="#get-started">Access the current beta</a>
        </article>
      </div>
      <p className="tl-public-disclosure">Beta access is temporary, not a commitment to permanent free membership. Pricing, eligibility, brokerage support, and subscription terms will be published before paid enrollment or live trading begins.</p>
    </section>
  )
}
