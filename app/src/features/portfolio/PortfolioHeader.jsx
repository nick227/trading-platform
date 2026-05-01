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

  const displayName = user?.fullName || user?.name || user?.email
  const welcomeMessages = [
    'Hello',
    'Welcome',
    'Howdy',
    'Hiya',
    'Greetings'
  ]

  return (
    <div className="card card-hero">
      <div className="container">

        <div className="hstack">
          {user?.avatar && <img className="avatar avatar-64 avatar-ring" src={user.avatar} alt="User Avatar" />}

          <div className="stack-sm">
            <h2 className="m-0 text-xxxl font-700">{welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]}, {displayName ?? '—'}</h2>

          </div>
        </div>
      </div>
    </div>
  )
}
