import { Link } from 'react-router-dom'
import { strategyDisplayName } from '../../ui/strategyPresentation'
import {
  catalogOverview,
  catalogPeriod,
  deriveCardEvidenceMetrics,
  strategyCategoryMeta,
} from './strategyCatalogCopy'
import StrategyResultSummary from './StrategyResultSummary'
import StrategyThumbnail from './StrategyThumbnail'

export function mainEvidenceWindow(strategy) {
  const windows = strategy?.windows || {}
  const isAi = strategy?.tags?.includes('ai') || strategy?.templateId === 'tmpl_ai_catalyst_momentum' || strategy?.templateId === 'tmpl_alpha_research'
  if (isAi) return 'forward'
  if (windows['5Y']?.status === 'ok') return '5Y'
  if (windows['1Y']?.status === 'ok') return '1Y'
  if (windows['5Y']) return '5Y'
  if (windows['1Y']) return '1Y'
  if (windows.holdout) return 'holdout'
  return '5Y'
}

/** Semantic card content is static; only its explicit footer action navigates. */
export default function StrategyCard({ strategy, symbolContext = null }) {
  const window = mainEvidenceWindow(strategy)
  const summary = strategy.windows?.[window]
  const category = strategyCategoryMeta(strategy)
  const metrics = deriveCardEvidenceMetrics(summary, window)
  const detailHref = symbolContext
    ? `/strategies/${encodeURIComponent(strategy.templateId)}?symbol=${encodeURIComponent(symbolContext)}`
    : `/strategies/${encodeURIComponent(strategy.templateId)}`
  return (
    <article className="tl-strategy-catalog-card" data-testid="strategy-card">
      <StrategyThumbnail templateId={strategy.templateId} />
      <div className="tl-strategy-catalog-card__body">
        <header className="tl-strategy-catalog-card__identity">
          <div className="tl-strategy-catalog-card__topline">
            <span className="tl-strategy-catalog-card__family" data-testid="strategy-family-tag">{category.family}</span>
            <span className="tl-strategy-catalog-card__mode">{category.mode}</span>
          </div>
          <h2>{strategyDisplayName(strategy)}</h2>
          <p className="tl-strategy-catalog-card__description">{catalogOverview(strategy)}</p>
        </header>
        <section className="tl-strategy-catalog-card__evidence" aria-label="Published test results">
          <div className="tl-strategy-catalog-card__evidence-head">
            <h3 className="tl-strategy-catalog-card__period">{catalogPeriod(window)}</h3>
            <span
              className={`tl-strategy-sample-pill tl-strategy-sample-pill--${metrics.sampleSize.tier}`}
              data-testid="strategy-sample-tier"
            >
              {metrics.sampleSize.label}
            </span>
          </div>
          <StrategyResultSummary summary={summary} window={window} metrics={metrics} />
        </section>
        <footer className="tl-strategy-catalog-card__footer">
          <Link className="tl-strategy-catalog-card__action" to={detailHref}>
            View strategy <span aria-hidden="true">→</span>
          </Link>
        </footer>
      </div>
    </article>
  )
}
