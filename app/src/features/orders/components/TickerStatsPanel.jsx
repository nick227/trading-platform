export default function TickerStatsPanel({ selectedStock, bootstrapData, loading }) {
  if (!selectedStock) {
    return (
      <article className="card card-pad-md">
        <div className="panel-empty">Select a stock to view statistics</div>
      </article>
    )
  }

  const stats = bootstrapData?.stats
  const quote = bootstrapData?.quote

  return (
    <article className="card card-pad-sm">
      <div className="panel-header">
        <h3 className="panel-title">Key Statistics</h3>
      </div>

      {loading ? (
        <div className="panel-empty">Loading statistics…</div>
      ) : (
        <div className="stack-md">
          <div className="stack-sm">
            <div className="text-xs font-600 muted">Price Performance</div>
            <div className="stack-sm text-xs">
              {quote?.price && (
                <div className="kv">
                  <span className="kv-key">Current Price</span>
                  <span className="font-600">${quote.price.toFixed(2)}</span>
                </div>
              )}
              {quote?.dayChangePct != null && (
                <div className="kv">
                  <span className="kv-key">Day Change</span>
                  <span className={`${quote.dayChangePct >= 0 ? 'text-positive' : 'text-negative'} font-600`}>
                    {quote.dayChangePct >= 0 ? '+' : ''}
                    {(quote.dayChangePct * 100).toFixed(2)}%
                  </span>
                </div>
              )}
              {stats?.high52 && stats?.low52 && (
                <div className="kv">
                  <span className="kv-key">52W Range</span>
                  <span>
                    ${stats.low52.toFixed(2)} – ${stats.high52.toFixed(2)}
                  </span>
                </div>
              )}
              {stats?.ath && quote?.price && (
                <div className="kv">
                  <span className="kv-key">From ATH</span>
                  <span className="muted">{((quote.price / stats.ath - 1) * 100).toFixed(1)}%</span>
                </div>
              )}
            </div>
          </div>

          <div className="stack-sm">
            <div className="text-xs font-600 muted">Volume & Liquidity</div>
            <div className="stack-sm text-xs">
              {quote?.volume && (
                <div className="kv">
                  <span className="kv-key">Volume</span>
                  <span>{(quote.volume / 1e6).toFixed(2)}M</span>
                </div>
              )}
              {stats?.avgVolume && (
                <div className="kv">
                  <span className="kv-key">Avg Volume</span>
                  <span>{(stats.avgVolume / 1e6).toFixed(2)}M</span>
                </div>
              )}
              {selectedStock?.pe && (
                <div className="kv">
                  <span className="kv-key">P/E Ratio</span>
                  <span>{selectedStock.pe}</span>
                </div>
              )}
            </div>
          </div>

          {stats && (
            <div className="stack-sm">
              <div className="text-xs font-600 muted">Market Metrics</div>
              <div className="stack-sm text-xs">
                {stats.marketCap && (
                  <div className="kv">
                    <span className="kv-key">Market Cap</span>
                    <span>${(stats.marketCap / 1e9).toFixed(2)}B</span>
                  </div>
                )}
                {stats.ath && (
                  <div className="kv">
                    <span className="kv-key">All-Time High</span>
                    <span>${stats.ath.toFixed(2)}</span>
                  </div>
                )}
                {stats.ipoDate && (
                  <div className="kv">
                    <span className="kv-key">IPO Date</span>
                    <span>{new Date(stats.ipoDate).toLocaleDateString()}</span>
                  </div>
                )}
                {stats.yearsListed && (
                  <div className="kv">
                    <span className="kv-key">Years Listed</span>
                    <span>{stats.yearsListed}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

