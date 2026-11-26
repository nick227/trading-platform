import { Link } from 'react-router-dom'
import { strategyDisplayName } from '../../ui/strategyPresentation'
import { catalogOverview, catalogPeriod } from './strategyCatalogCopy'
import StrategyEvidencePreview from './StrategyEvidencePreview'
import StrategyThumbnail from './StrategyThumbnail'

export function mainEvidenceWindow(strategy) {
  const windows = strategy?.windows || {}
  const isAi = strategy?.tags?.includes('ai') || strategy?.templateId === 'tmpl_ai_catalyst_momentum'
  if (isAi) return 'forward'
  if (windows['5Y']?.status === 'ok') return '5Y'
  if (windows['1Y']?.status === 'ok') return '1Y'
  if (windows['5Y']) return '5Y'
  if (windows['1Y']) return '1Y'
  if (windows.holdout) return 'holdout'
  return '5Y'
}

/** Semantic card content is static; only its explicit footer action navigates. */
export default function StrategyCard({ strategy }) {
  const window = mainEvidenceWindow(strategy)
  const summary = strategy.windows?.[window]
  return (
    <article className="tl-strategy-catalog-card" data-testid="strategy-card">
      <StrategyThumbnail templateId={strategy.templateId} />
      <div className="tl-strategy-catalog-card__body">
        <header className="tl-strategy-catalog-card__identity">
          <h2>{strategyDisplayName(strategy)}</h2>
          <p className="tl-strategy-catalog-card__description">{catalogOverview(strategy)}</p>
        </header>
        <section className="tl-strategy-catalog-card__evidence" aria-label="Published test results">
          <h3 className="tl-strategy-catalog-card__period">{catalogPeriod(window)}</h3>
          <StrategyEvidencePreview summary={summary} window={window} />
        </section>
        <footer className="tl-strategy-catalog-card__footer">
          <Link className="tl-strategy-catalog-card__action" to={`/strategies/${encodeURIComponent(strategy.templateId)}`}>
            View strategy <span aria-hidden="true">→</span>
          </Link>
        </footer>
      </div>
    </article>
  )
}
