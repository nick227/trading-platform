import './ai-trader-showcase.css'

/** Public product explanation: illustration is intentionally not presented as live research. */
export function AiTradingIntroduction() {
  return (
    <section className="tl-ai-intro" aria-labelledby="ai-trading-intro-title" data-testid="ai-trading-introduction">
      <div className="tl-ai-intro__copy">
        <p className="tl-ai-eyebrow">AI-powered strategies</p>
        <h1 id="ai-trading-intro-title">What is AI trading?</h1>
        <p className="tl-ai-intro__lead">Traditional trading bots buy and sell stocks according to predefined rules. AI trading adds the ability to research companies, interpret financial news, compare opportunities, and consider information beyond stock prices.</p>
        <p>AI traders can explain their decisions and approach the market with different objectives. TradeLoom keeps trading permissions and risk limits separate from the AI's research.</p>
      </div>
      <div className="tl-ai-research-art" aria-label="Illustration of financial reports, market context and research being examined together" role="img">
        <div className="tl-ai-research-art__halo" aria-hidden="true" />
        <div className="tl-ai-art-card tl-ai-art-card--reports" aria-hidden="true">
          <span className="tl-ai-art-card__eyebrow">01 / FINANCIAL REPORTS</span>
          <span className="tl-ai-art-card__heading">Company fundamentals</span>
          <span className="tl-ai-art-card__rule" />
          <span className="tl-ai-art-card__rule tl-ai-art-card__rule--short" />
          <span className="tl-ai-art-card__bars"><i /><i /><i /><i /><i /><i /></span>
        </div>
        <div className="tl-ai-art-card tl-ai-art-card--market" aria-hidden="true">
          <span className="tl-ai-art-card__eyebrow">02 / MARKET CONTEXT</span>
          <svg viewBox="0 0 230 78" preserveAspectRatio="none" focusable="false">
            <path d="M3 63 L35 49 L61 55 L88 32 L114 39 L145 18 L172 33 L201 12 L227 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3 63 L35 49 L61 55 L88 32 L114 39 L145 18 L172 33 L201 12 L227 18 L227 78 L3 78Z" fill="currentColor" opacity=".08"/>
          </svg>
          <span className="tl-ai-art-card__meta">Evidence considered together</span>
        </div>
        <div className="tl-ai-art-card tl-ai-art-card--insight" aria-hidden="true">
          <span className="tl-ai-art-card__eyebrow">03 / RESEARCH</span>
          <span className="tl-ai-art-card__heading">What changed — and why?</span>
          <span className="tl-ai-art-card__rule" />
          <span className="tl-ai-art-card__rule tl-ai-art-card__rule--medium" />
          <span className="tl-ai-art-card__rule tl-ai-art-card__rule--short" />
        </div>
        <span className="tl-ai-research-art__caption">Concept illustration · not a recorded AI decision</span>
      </div>
    </section>
  )
}

const BOTS = [
  {
    id: 'flagship', name: 'Flagship AI Trader', kind: 'Public research portfolio',
    description: 'Researches market opportunities and evaluates which stocks to buy, sell, or hold.',
    tag: 'Available', number: '01', theme: 'flagship',
    detail: 'Explore recorded research, decisions, paper trades and performance.'
  },
  {
    id: 'personal', name: 'Personal AI Trader', kind: 'Your own paper-trading portfolio',
    description: 'Looks for opportunities using the industries, risk limits and approval settings you choose.',
    tag: 'Available', number: '02', theme: 'personal',
    detail: 'Set your preferences and review activity in your own account.'
  },
  {
    id: 'catalyst', name: 'Catalyst Research Trader', kind: 'Earnings & company developments',
    description: 'A proposed approach focused on earnings, company announcements and the events behind price changes.',
    tag: 'Planned concept', number: '03', theme: 'catalyst',
    detail: 'An idea for future development. No trading or performance record yet.'
  },
  {
    id: 'defensive', name: 'Defensive AI Trader', kind: 'Conservative opportunities',
    description: 'A proposed approach that would emphasize caution, market uncertainty and selective opportunities.',
    tag: 'Planned concept', number: '04', theme: 'defensive',
    detail: 'An idea for future development. No trading or performance record yet.'
  }
]

export const AI_TRADER_BOTS = BOTS

function statusLabel(id, { user, personalStatus, publicState, publicData }) {
  if (id === 'catalyst' || id === 'defensive') return 'Not released'
  if (id === 'flagship') {
    if (publicState === 'loading') return 'Checking activity'
    if (publicState === 'error') return 'Data unavailable'
    if (publicData?.status === 'not_initialized') return 'Awaiting first run'
    if (publicData?.status === 'enabled') return 'Running'
    if (publicData?.status === 'paused') return 'Paused'
    return 'Status unavailable'
  }
  if (!user) return 'Sign in to configure'
  if (personalStatus?.status === 'unavailable') return 'Status unavailable'
  if (!personalStatus) return 'Checking status'
  if (!personalStatus.configured) return 'Not configured'
  return personalStatus.enabled ? 'Active' : 'Paused'
}

export function AiTraderBotExplorer({ selected, onSelect, user, personalStatus, publicState, publicData, children }) {
  const selectedBot = BOTS.find(bot => bot.id === selected) || BOTS[0]
  return (
    <section className="tl-ai-explorer" aria-labelledby="ai-traders-title" data-testid="ai-bot-explorer">
      <div className="tl-ai-explorer__heading">
        <div>
          <p className="tl-ai-eyebrow">Explore our approaches</p>
          <h2 id="ai-traders-title">Meet the AI traders</h2>
          <p>Each trader approaches the market differently. Explore the available systems and see the research and activity behind them.</p>
        </div>
        <p className="tl-ai-explorer__count">02 available <span aria-hidden="true">/</span> 02 concepts</p>
      </div>
      <div className="tl-ai-bot-grid" aria-label="Select an AI trader">
        {BOTS.map(bot => {
          const isPlanned = bot.tag === 'Planned concept'
          const isSelected = bot.id === selectedBot.id
          return (
            <button type="button" className={`tl-ai-bot-card tl-ai-bot-card--${bot.theme}${isSelected ? ' is-selected' : ''}`}
              onClick={() => onSelect(bot.id)} aria-pressed={isSelected} aria-controls="ai-trader-selected"
              data-testid={`ai-bot-select-${bot.id}`} key={bot.id}>
              <span className="tl-ai-bot-card__visual" aria-hidden="true">
                <span className="tl-ai-bot-card__index">{bot.number} / AI</span>
                <span className="tl-ai-bot-card__orb"><span className="tl-ai-bot-card__orb-core"/></span>
                <span className="tl-ai-bot-card__mesh" />
              </span>
              <span className="tl-ai-bot-card__body">
                <span className="tl-ai-bot-card__topline">
                  <span className="tl-ai-bot-card__tag">{bot.tag}</span>
                  <span className="tl-ai-bot-card__state">{statusLabel(bot.id, {user, personalStatus, publicState, publicData})}</span>
                </span>
                <strong className="tl-ai-bot-card__name">{bot.name}</strong>
                <span className="tl-ai-bot-card__kind">{bot.kind}</span>
                <span className="tl-ai-bot-card__description">{bot.description}</span>
                <span className="tl-ai-bot-card__action">{isSelected ? 'Currently selected' : isPlanned ? 'Explore the concept' : 'Explore this trader'} <span aria-hidden="true">↗</span></span>
              </span>
            </button>
          )
        })}
      </div>
      <section id="ai-trader-selected" aria-live="off" aria-label={`${selectedBot.name} details`}
        className="tl-ai-selected" data-testid="ai-trader-selected-detail">
        <div className="tl-ai-selected__header">
          <div>
            <p className="tl-ai-eyebrow">{selectedBot.tag} · {selectedBot.kind}</p>
            <h3>{selectedBot.name}</h3>
            <p>{selectedBot.detail}</p>
          </div>
          <span className="tl-ai-selected__status">{statusLabel(selectedBot.id, {user, personalStatus, publicState, publicData})}</span>
        </div>
        {children}
      </section>
    </section>
  )
}
