import { Link } from 'react-router-dom'
import { strategyDisplayName } from '../../ui/strategyPresentation'
import { catalogOverview, catalogPeriod } from './strategyCatalogCopy'
import StrategyEvidencePreview from './StrategyEvidencePreview'

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

/** The entire card links to the report; no overlapping controls or nested links. */
export default function StrategyCard({ strategy }) {
  const isAi = strategy.tags?.includes('ai') || strategy.templateId === 'tmpl_ai_catalyst_momentum'
  const window = mainEvidenceWindow(strategy)
  const summary = strategy.windows?.[window]
  return (
    <article className="tl-strategy-catalog-card" data-testid="strategy-card">
      <Link className="tl-strategy-catalog-card__link" to={`/strategies/${encodeURIComponent(strategy.templateId)}`}>
        <div className="tl-strategy-catalog-card__top">
          <h2>{strategyDisplayName(strategy)}</h2>
          {isAi && <span className="tl-strategy-catalog-card__type">Uses AI research</span>}
        </div>
        <p className="tl-strategy-catalog-card__description">{catalogOverview(strategy)}</p>
        <div className="tl-strategy-catalog-card__evidence">
          <p className="tl-strategy-catalog-card__period">{catalogPeriod(window)}</p>
          <StrategyEvidencePreview summary={summary} window={window} />
        </div>
        <span className="tl-strategy-catalog-card__action">Read strategy details <span aria-hidden="true">→</span></span>
      </Link>
    </article>
  )
}
