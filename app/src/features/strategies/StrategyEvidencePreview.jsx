import { pctText } from './strategiesApi'
import { catalogResult } from './strategyCatalogCopy'

/** Read-only presentation of published test data, without inferred returns. */
export default function StrategyEvidencePreview({ summary, window }) {
  const comparable = summary?.status === 'ok' && summary?.symbolsTraded !== 0 &&
    Number.isFinite(summary?.medianReturnPct) && Number.isFinite(summary?.medianBuyAndHoldPct)
  return (
    <div className="tl-strategy-evidence-preview">
      {comparable ? (
        <>
          <dl className="tl-strategy-evidence-preview__metrics">
            <div>
              <dt>Typical strategy return</dt>
              <dd>{pctText(summary.medianReturnPct)}</dd>
            </div>
            <div>
              <dt>Buy-and-hold return</dt>
              <dd>{pctText(summary.medianBuyAndHoldPct)}</dd>
            </div>
          </dl>
          <p className="tl-strategy-evidence-preview__context">These are results from the selected {window === 'forward' ? 'simulated trading period' : 'historical test'}, not investor returns.</p>
        </>
      ) : (
        <p className="tl-strategy-catalog-card__result">{catalogResult(summary, window)}</p>
      )}
      {summary?.status === 'ok' && Number.isFinite(summary?.symbolsTested) && (
        <p className="tl-strategy-evidence-preview__context">
          {summary.symbolsTested} {summary.symbolsTested === 1 ? 'stock was' : 'stocks were'} included in this test.
          {Number.isFinite(summary?.trades) ? ` The strategy recorded ${summary.trades} ${summary.trades === 1 ? 'trade' : 'trades'}.` : ''}
        </p>
      )}
    </div>
  )
}
