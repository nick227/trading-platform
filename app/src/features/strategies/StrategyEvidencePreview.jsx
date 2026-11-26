import { pctText } from './strategiesApi'
import { catalogResult } from './strategyCatalogCopy'

/** The cards show one measured comparison or one explicit availability state. */
export default function StrategyEvidencePreview({ summary, window }) {
  const comparable = summary?.status === 'ok' && summary?.symbolsTraded !== 0 &&
    Number.isFinite(summary?.medianReturnPct) && Number.isFinite(summary?.medianBuyAndHoldPct)
  const message = catalogResult(summary, window)
  return (
    <div className="tl-strategy-evidence-preview">
      {comparable ? (
        <dl className="tl-strategy-evidence-preview__metrics">
          <div>
            <dt>Strategy return</dt>
            <dd>{pctText(summary.medianReturnPct)}</dd>
          </div>
          <div>
            <dt>Buy-and-hold return</dt>
            <dd>{pctText(summary.medianBuyAndHoldPct)}</dd>
          </div>
        </dl>
      ) : (
        <p className="tl-strategy-catalog-card__result">{message}</p>
      )}
      {summary?.status === 'ok' && Number.isFinite(summary?.symbolsTested) && (
        <p className="tl-strategy-evidence-preview__context">
          The test covered {summary.symbolsTested} {summary.symbolsTested === 1 ? 'stock' : 'stocks'}.
          {Number.isFinite(summary.trades) ? ` It recorded ${summary.trades} ${summary.trades === 1 ? 'trade' : 'trades'}.` : ''}
        </p>
      )}
    </div>
  )
}
