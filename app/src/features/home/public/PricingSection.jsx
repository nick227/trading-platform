import { useState } from 'react'

const PLANS = [
  {name:'Free',description:'Discover and explore TradeLoom.',features:['Browse published strategies','Read historical and forward paper evidence','Create an account and explore paper trading']},
  {name:'Premium',description:'More ways to automate and investigate.',features:['Expanded automated bot access','Advanced strategy configuration','Detailed portfolio analytics','More AI research tools'],planned:true}
]

export default function PricingSection() {
  const [period,setPeriod] = useState('monthly')
  return (
    <section className="tl-public-section" id="pricing" aria-labelledby="pricing-title">
      <header className="tl-public-section-head">
        <p className="tl-public-eyebrow">PLANS & VALUE</p>
        <h2 id="pricing-title">Start free. Explore what Premium can unlock.</h2>
        <p>TradeLoom is being prepared for monthly and annual memberships. Premium subscriptions are not on sale yet.</p>
      </header>
      <div className="tl-public-billing" role="group" aria-label="Preferred billing period">
        <button type="button" aria-pressed={period==='monthly'} onClick={()=>setPeriod('monthly')}>Monthly</button>
        <button type="button" aria-pressed={period==='annual'} onClick={()=>setPeriod('annual')}>Annual</button>
      </div>
      <div className="tl-public-plan-grid">
        {PLANS.map(plan=><article className={'tl-public-panel tl-public-plan'+(plan.planned?' tl-public-plan--premium':'')} key={plan.name}>
          <p className="tl-public-plan-name">{plan.name}</p>
          <h3>{plan.planned?'First month free at launch':'$0'}</h3>
          <p>{plan.description}</p>
          {plan.planned&&<p className="tl-public-plan-note">Planned offer · {period==='annual'?'Annual':'Monthly'} pricing and renewal terms to be announced before checkout.</p>}
          <ul>{plan.features.map(feature=><li key={feature}>{feature}</li>)}</ul>
          <a className={'tl-public-button '+(plan.planned?'tl-public-button--primary':'tl-public-button--secondary')} href="#get-started">{plan.planned?'Create account for launch':'Create free account'}</a>
        </article>)}
      </div>
      <p className="tl-public-disclosure">Premium features, pricing, trial eligibility and billing are proposed and subject to launch availability. Registration does not start a paid subscription or a billed trial.</p>
    </section>
  )
}
