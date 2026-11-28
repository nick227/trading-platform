import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import StrategyCard from './StrategyCard'
import { loadPublicStrategies } from './strategiesApi'
import { strategyCategoryMeta } from './strategyCatalogCopy'
import { ContentState } from '../../components/content/ContentBlocks'
import './strategy-catalog.css'

/** Editorial introduction mirroring the AI Trader showcase header; illustration is non-data artwork. */
function StrategiesIntroduction() {
  return (
    <section className="tl-strat-intro" aria-labelledby="strategies-intro-title" data-testid="strategies-introduction">
      <div className="tl-strat-intro__copy">
        <p className="tl-strat-eyebrow">Automated trading</p>
        <h1 id="strategies-intro-title">Automated strategies, tested openly</h1>
        <p className="tl-strat-intro__lead">
          Automated strategies follow defined rules or structured research to decide when to buy, hold, or exit a stock—replacing guesswork with repeatable discipline. Each strategy below is built around a specific goal, from capturing sustained uptrends and spreading entries over time to limiting position losses.
        </p>
        <p>
          Every card reports standardized historical backtests or post-publication paper trading alongside buy-and-hold benchmarks, drawdowns, and trade counts, including losses and untraded periods. Inspect the full record, customize eligible strategies for paper trading, and prepare for live brokerage execution as it rolls out.
        </p>
      </div>
      <div
        className="tl-strat-art"
        aria-label="Illustration of trading rules, standardized benchmark testing and risk guardrails working together"
        role="img"
      >
        <div className="tl-strat-art__halo" aria-hidden="true" />
        <div className="tl-strat-art-card tl-strat-art-card--rules" aria-hidden="true">
          <span className="tl-strat-art-card__eyebrow">01 / TRADING LOGIC</span>
          <span className="tl-strat-art-card__heading">Entry &amp; exit conditions</span>
          <span className="tl-strat-art-card__rule" />
          <span className="tl-strat-art-card__rule tl-strat-art-card__rule--short" />
          <span className="tl-strat-art-card__bars"><i /><i /><i /><i /><i /><i /></span>
        </div>
        <div className="tl-strat-art-card tl-strat-art-card--benchmark" aria-hidden="true">
          <span className="tl-strat-art-card__eyebrow">02 / BENCHMARK TEST</span>
          <svg viewBox="0 0 230 78" preserveAspectRatio="none" focusable="false">
            <path d="M3 66 L42 58 L84 61 L126 45 L176 48 L227 36" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" opacity=".45" />
            <path d="M3 64 L38 51 L72 54 L108 34 L146 38 L186 19 L227 14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 64 L38 51 L72 54 L108 34 L146 38 L186 19 L227 14 L227 78 L3 78Z" fill="currentColor" opacity=".09" />
          </svg>
          <span className="tl-strat-art-card__meta">Standardized $10k runs vs. buy &amp; hold</span>
        </div>
        <div className="tl-strat-art-card tl-strat-art-card--guard" aria-hidden="true">
          <span className="tl-strat-art-card__eyebrow">03 / RISK GUARDRAILS</span>
          <span className="tl-strat-art-card__heading">Drawdown &amp; position limits</span>
          <span className="tl-strat-art-card__rule" />
          <span className="tl-strat-art-card__rule tl-strat-art-card__rule--medium" />
          <span className="tl-strat-art-card__rule tl-strat-art-card__rule--short" />
        </div>
        <span className="tl-strat-art-card__caption">Concept illustration · not a recorded backtest</span>
      </div>
    </section>
  )
}

/** Public strategy catalog. Present recorded evidence without inferring missing results. */
export default function StrategiesIndex() {
  const location = useLocation()
  const searchParams = new URLSearchParams(location?.search || '')
  const focusedSymbol = (searchParams.get('symbol') || searchParams.get('ticker') || '').trim().toUpperCase() || null

  const [state, setState] = useState({ status: 'loading', rows: [] })
  useEffect(() => {
    let active = true
    loadPublicStrategies()
      .then(rows => {
        if (!active) return
        const filtered = (Array.isArray(rows) ? rows : []).filter(s => s?.templateId !== 'tmpl_ai_stock_trader')
        setState({ status: 'done', rows: filtered })
      })
      .catch(() => { if (active) setState({ status: 'error', rows: [] }) })
    return () => { active = false }
  }, [])

  const aiOrResearchCount = state.rows.filter(s => strategyCategoryMeta(s).isAiOrResearch).length
  const ruleCount = state.rows.length - aiOrResearchCount
  const fmtCount = n => String(n).padStart(2, '0')

  return (
    <main className="tl-page tl-strategies-page" data-testid="strategies-index">
      <StrategiesIntroduction />
      {focusedSymbol && (
        <section
          className="tl-card tl-card-shell tl-card-shell--compact tl-strategy-symbol-banner"
          aria-label="Selected stock context"
          data-testid="strategy-symbol-context"
        >
          <div className="tl-section-head">
            <p className="tl-small tl-strategy-symbol-banner__text">
              <strong>Exploring strategies for {focusedSymbol}</strong> — opening any strategy below keeps {focusedSymbol} pre-selected through evidence review and bot setup.
            </p>
            <div className="tl-strategy-symbol-banner__actions">
              <Link to={`/opportunities?symbol=${encodeURIComponent(focusedSymbol)}`} className="tl-link-btn">← Back to {focusedSymbol} in Stocks</Link>
              <Link to={`/bots/new?ticker=${encodeURIComponent(focusedSymbol)}`} className="tl-link-btn">Automate {focusedSymbol} →</Link>
              <Link to="/strategies" className="tl-link-btn">Clear symbol</Link>
            </div>
          </div>
        </section>
      )}
      <section className="tl-strategy-explorer" aria-labelledby="published-strategies-title">
        <div className="tl-strategy-explorer__heading">
          <div>
            <p className="tl-strat-eyebrow">Compare our approaches</p>
            <h2 id="published-strategies-title">Explore trading strategies</h2>
            <p>Each strategy approaches timing and risk differently. Review its method and standardized test record.</p>
          </div>
          {state.status === 'done' && state.rows.length > 0 && (
            <p className="tl-strategy-explorer__count" data-testid="strategy-family-counts">
              {fmtCount(ruleCount)} rule-based <span aria-hidden="true">/</span> {fmtCount(aiOrResearchCount)} AI &amp; research
            </p>
          )}
        </div>
        {state.status === 'loading' && <span className="tl-skel" style={{ height: 240 }} aria-label="Loading strategies" />}
        {state.status === 'error' && <ContentState tone="error" title="Strategy information is unavailable." description="The list could not be loaded. You can reload the page to request it again." />}
        {state.status === 'done' && state.rows.length === 0 && <ContentState title="No strategies have been published." description="Published strategies and their available test results will appear here." />}
        {state.status === 'done' && state.rows.length > 0 && (
          <ul className="tl-strategy-catalog" aria-label="Published trading strategies">
            {state.rows.map(s => <li key={s.templateId}><StrategyCard strategy={s} symbolContext={focusedSymbol} /></li>)}
          </ul>
        )}
      </section>
    </main>
  )
}
