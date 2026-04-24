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
  const currentPrice = quote?.price ?? stats?.price ?? null
  const dayChangePct = quote?.change ?? quote?.dayChangePct ?? stats?.dayChangePct ?? null

  const formatDateOnly = (value) => {
    if (!value) return null
    const raw = String(value)
    // If the backend sends a YYYY-MM-DD string, format in UTC to avoid off-by-one local TZ shifts.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const d = new Date(`${raw}T00:00:00Z`)
      if (Number.isNaN(d.getTime())) return raw
      return d.toLocaleDateString(undefined, { timeZone: 'UTC' })
    }
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw
    return d.toLocaleDateString()
  }

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
              {!quote?.price && currentPrice != null && (
                <div className="kv">
                  <span className="kv-key">Current Price</span>
                  <span className="font-600">${Number(currentPrice).toFixed(2)}</span>
                </div>
              )}
              {dayChangePct != null && (
                <div className="kv">
                  <span className="kv-key">Day Change</span>
                  <span className={`${dayChangePct >= 0 ? 'text-positive' : 'text-negative'} font-600`}>
                    {dayChangePct >= 0 ? '+' : ''}
                    {Number(dayChangePct).toFixed(2)}%
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
              {stats?.ath && currentPrice != null && (
                <div className="kv">
                  <span className="kv-key">From ATH</span>
                  <span className="muted">{(((Number(currentPrice) / stats.ath) - 1) * 100).toFixed(1)}%</span>
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
                    <span className="kv-key">Data start</span>
                    <span>{formatDateOnly(stats.ipoDate)}</span>
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
