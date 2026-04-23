import React, { useState, useEffect } from 'react'

const TemplateMetrics = ({ templateId }) => {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/metrics/templates/${templateId}`)
        const data = await response.json()
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch metrics')
        }
        
        setMetrics(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    if (templateId) {
      fetchMetrics()
    }
  }, [templateId])

  if (loading) {
    return (
      <div className="metrics-loading">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
          <div className="h-8 bg-gray-200 rounded w-16"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="metrics-error">
        <div className="text-red-500 text-sm">Metrics unavailable</div>
      </div>
    )
  }

  if (!metrics) {
    return null
  }

  // Show insufficient data state
  if (metrics.dataQuality !== 'sufficient') {
    return (
      <div className="metrics-insufficient">
        <div className="text-gray-500 text-sm">{metrics.message || 'Building track record'}</div>
        <div className="text-xs text-gray-400 mt-1">
          {metrics.metrics?.totalTrades || 0} trades • {metrics.metrics?.activeUsers || 0} users
        </div>
      </div>
    )
  }

  const { metrics: m } = metrics

  return (
    <div className="template-metrics">
      <div className="grid grid-cols-2 gap-4">
        {/* Annual Return */}
        <div className="metric-card">
          <div className={`text-lg font-bold ${
            m.annualReturn >= 0 ? 'text-green-600' : 'text-red-600'
          }`}>
            {m.annualReturn ? `${m.annualReturn.toFixed(1)}%` : '—'}
          </div>
          <div className="text-xs text-gray-500">Annual Return</div>
        </div>

        {/* Win Rate */}
        <div className="metric-card">
          <div className="text-lg font-bold text-blue-600">
            {m.winRate ? `${m.winRate.toFixed(1)}%` : '—'}
          </div>
          <div className="text-xs text-gray-500">Win Rate</div>
        </div>

        {/* Sharpe Ratio */}
        <div className="metric-card">
          <div className="text-lg font-bold text-purple-600">
            {m.sharpeRatio ? m.sharpeRatio.toFixed(2) : '—'}
          </div>
          <div className="text-xs text-gray-500">Sharpe Ratio</div>
        </div>

        {/* Max Drawdown */}
        <div className="metric-card">
          <div className={`text-lg font-bold ${
            m.maxDrawdown <= 0 ? 'text-green-600' : 'text-red-600'
          }`}>
            {m.maxDrawdown ? `${m.maxDrawdown.toFixed(1)}%` : '—'}
          </div>
          <div className="text-xs text-gray-500">Max Drawdown</div>
        </div>
      </div>

      {/* Additional info */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex justify-between text-xs text-gray-500">
          <span>{m.totalTrades} trades</span>
          <span>{m.activeUsers} users</span>
          <span>Updated {new Date(m.lastUpdated).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  )
}

export default TemplateMetrics
