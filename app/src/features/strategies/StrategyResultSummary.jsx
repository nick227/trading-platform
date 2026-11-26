import { pctText } from './strategiesApi'
import { catalogResult, catalogResultHeading } from './strategyCatalogCopy'

/** Uniform result presentation for completed tests and missing observations. */
export default function StrategyResultSummary({ summary, window }) {
  const comparable = summary?.status === 'ok' && summary?.symbolsTraded !== 0 &&
    Number.isFinite(summary?.medianReturnPct) && Number.isFinite(summary?.medianBuyAndHoldPct)
  return (
    <div className="tl-strategy-result" data-testid="strategy-result">
      {comparable ? (
        <>
          <div className="tl-strategy-result__primary">
            <span className="tl-strategy-result__label">Typical strategy return</span>
            <strong className="tl-strategy-result__value" data-testid="strategy-primary-return">
              {pctText(summary.medianReturnPct)}
            </strong>
          </div>
          <div className="tl-strategy-result__secondary">
            <span>Typical buy-and-hold return</span>
            <strong>{pctText(summary.medianBuyAndHoldPct)}</strong>
          </div>
        </>
      ) : (
        <>
          <div className="tl-strategy-result__primary">
            <span className="tl-strategy-result__label">Reported performance</span>
            <strong className="tl-strategy-result__value tl-strategy-result__value--unavailable">
              {catalogResultHeading(summary)}
            </strong>
          </div>
          <p className="tl-strategy-result__message">{catalogResult(summary, window)}</p>
        </>
      )}
    </div>
  )
}
