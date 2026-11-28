import { pctText } from './strategiesApi'
import { catalogResult, catalogResultHeading, deriveCardEvidenceMetrics } from './strategyCatalogCopy'

/** Uniform result presentation for completed tests and missing observations. */
export default function StrategyResultSummary({ summary, window, metrics: providedMetrics = null }) {
  const metrics = providedMetrics || deriveCardEvidenceMetrics(summary, window)
  return (
    <div className="tl-strategy-result" data-testid="strategy-result">
      {metrics.comparable ? (
        <>
          <div className="tl-strategy-result__primary">
            <span className="tl-strategy-result__label">Typical strategy return</span>
            <div className="tl-strategy-result__headline">
              <strong className="tl-strategy-result__value" data-testid="strategy-primary-return">
                {pctText(summary.medianReturnPct)}
              </strong>
              {metrics.excessVsBenchmarkPct !== null && (
                <span
                  className={`tl-strategy-result__delta ${metrics.excessTone}`}
                  data-testid="strategy-benchmark-delta"
                >
                  {pctText(metrics.excessVsBenchmarkPct)} vs bench
                </span>
              )}
            </div>
          </div>
          <div className="tl-strategy-metrics-grid">
            <div className="tl-strategy-metric-cell">
              <span>Typical buy-and-hold return</span>
              <strong>{pctText(summary.medianBuyAndHoldPct)}</strong>
            </div>
            <div className="tl-strategy-metric-cell">
              <span>Max drawdown</span>
              <strong data-testid="strategy-drawdown">{metrics.drawdownText}</strong>
            </div>
            <div className="tl-strategy-metric-cell">
              <span>Return / drawdown</span>
              <strong className={metrics.scoreTone} data-testid="strategy-risk-score">{metrics.riskAdjustedText}</strong>
            </div>
            <div className="tl-strategy-metric-cell">
              <span>Sample depth</span>
              <strong data-testid="strategy-sample-detail">{metrics.sampleDetailText}</strong>
            </div>
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
