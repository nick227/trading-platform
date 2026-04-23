import { useState, useEffect } from 'react'

export default function PortfolioHeader({ user, stats, onRefresh }) {
  const [portfolioMetrics, setPortfolioMetrics] = useState(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  // Fetch live portfolio metrics
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setMetricsLoading(true)
        const response = await fetch('/api/metrics/portfolio/summary')
        const data = await response.json()
        setPortfolioMetrics(data)
      } catch (error) {
        console.error('Failed to fetch portfolio metrics:', error)
      } finally {
        setMetricsLoading(false)
      }
    }

    fetchMetrics()
  }, [])

  // Use live metrics if available, fallback to original stats
  const totalReturn = portfolioMetrics?.totalPnl ?? stats?.totalReturn ?? 0
  const totalReturnPct = portfolioMetrics?.portfolioReturn ?? stats?.totalReturnPct ?? 0
  const winRate = portfolioMetrics?.winRate ?? 0
  const totalTrades = portfolioMetrics?.totalTrades ?? 0
  const positive = totalReturn >= 0

  const displayName = user?.fullName || user?.name || user?.email

  return (
    <div className="card card-hero">
      <div className="container">

            <div className="meta-row row">
              <span>
                <span className="muted text-xs">Portfolio PnL: </span>
                <span className={`${positive ? 'text-positive' : 'text-negative'} font-600`}>
                  {positive ? '+' : ''}
                  {`$${totalReturn.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${positive ? '+' : ''}${totalReturnPct.toFixed(1)}%)`}
                </span>
              </span>
              {!metricsLoading && portfolioMetrics && (
                <>
                  <span>
                    <span className="muted text-xs">Win Rate: </span>
                    <span className="font-600 text-positive">
                      {winRate.toFixed(1)}%
                    </span>
                  </span>
                  <span>
                    <span className="muted text-xs">Trades: </span>
                    <span className="font-600">
                      {totalTrades}
                    </span>
                  </span>
                </>
              )}
            </div>

        <div className="hstack">
          {user?.avatar && <img className="avatar avatar-64 avatar-ring" src={user.avatar} alt="User Avatar" />}

          <div className="stack-sm">
            <h2 className="m-0 text-xxxl font-700">Hello, {displayName ?? '—'}</h2>

          </div>
        </div>
      </div>
    </div>
  )
}
