import React, { useState, useEffect } from 'react'

const PortfolioAttribution = ({ period = '30d' }) => {
  const [attribution, setAttribution] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        
        // Fetch both attribution and summary in parallel
        const [attributionResponse, summaryResponse] = await Promise.all([
          fetch(`/api/metrics/portfolio/attribution?period=${period}`),
          fetch('/api/metrics/portfolio/summary')
        ])
        
        const attributionData = await attributionResponse.json()
        const summaryData = await summaryResponse.json()
        
        if (!attributionResponse.ok || !summaryResponse.ok) {
          throw new Error('Failed to fetch portfolio data')
        }
        
        setAttribution(attributionData)
        setSummary(summaryData)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [period])

  if (loading) {
    return (
      <div className="portfolio-attribution-loading">
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-gray-200 rounded"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="portfolio-attribution-error">
        <div className="text-red-500">Unable to load portfolio data</div>
      </div>
    )
  }

  return (
    <div className="portfolio-attribution">
      {/* Portfolio Summary */}
      {summary && (
        <div className="portfolio-summary mb-6">
          <h3 className="text-lg font-semibold mb-4">Portfolio Performance</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="summary-card">
              <div className={`text-xl font-bold ${
                summary.portfolioReturn >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {summary.portfolioReturn ? `${summary.portfolioReturn.toFixed(1)}%` : '0.0%'}
              </div>
              <div className="text-sm text-gray-500">Total Return</div>
            </div>
            
            <div className="summary-card">
              <div className="text-xl font-bold text-blue-600">
                {summary.winRate ? `${summary.winRate.toFixed(1)}%` : '0.0%'}
              </div>
              <div className="text-sm text-gray-500">Win Rate</div>
            </div>
            
            <div className="summary-card">
              <div className="text-xl font-bold text-purple-600">
                {summary.totalTrades}
              </div>
              <div className="text-sm text-gray-500">Total Trades</div>
            </div>
            
            <div className="summary-card">
              <div className="text-xl font-bold text-orange-600">
                {summary.activeBots}
              </div>
              <div className="text-sm text-gray-500">Active Bots</div>
            </div>
          </div>
        </div>
      )}

      {/* Attribution Breakdown */}
      {attribution && (
        <div className="attribution-breakdown">
          <h3 className="text-lg font-semibold mb-4">Performance by Source</h3>
          
          {attribution.message && (
            <div className="text-sm text-yellow-600 mb-4">
              ⚠️ {attribution.message}
            </div>
          )}
          
          {attribution.attribution.length > 0 ? (
            <div className="space-y-4">
              {/* Attribution Donut (simplified as bar chart for MVP) */}
              <div className="attribution-chart">
                {attribution.attribution.map((source, index) => (
                  <div key={`${source.sourceType}-${index}`} className="attribution-source">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium">{source.name}</span>
                      <span className={`font-bold ${
                        source.pnl >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {source.pnl >= 0 ? '+' : ''}{source.pnl.toFixed(2)}
                      </span>
                    </div>
                    
                    {/* Contribution bar */}
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${
                          source.pnl >= 0 ? 'bg-green-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min(Math.abs(source.contribution), 100)}%` }}
                      ></div>
                    </div>
                    
                    {/* Additional details */}
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>{source.trades} trades</span>
                      <span>{source.winRate ? `${source.winRate.toFixed(1)}% win rate` : '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Attribution summary */}
              <div className="attribution-summary mt-6 pt-4 border-t border-gray-200">
                <div className="text-sm text-gray-600">
                  <div>Total sources: {attribution.attribution.length}</div>
                  {attribution.hasUnknownData && (
                    <div className="text-yellow-600">
                      Note: ${attribution.unknownPnl.toFixed(2)} from unclassified trades
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 text-center py-8">
              No attribution data available for this period
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default PortfolioAttribution
