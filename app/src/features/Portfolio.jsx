import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { usePortfolio } from '../hooks/usePortfolio.js'
import { useApp } from '../app/AppProvider.jsx'
import { useAuth } from '../app/AuthProvider.jsx'
import StatCard from '../components/StatCard.jsx'
import PortfolioHeader from './portfolio/PortfolioHeader.jsx'
import HoldingsTable from './portfolio/HoldingsTable.jsx'
import ActivityFeed from './portfolio/ActivityFeed.jsx'

export default function Portfolio() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { state } = useApp()
  const { holdings, stats, recentActivity, loading, error, refetch } = usePortfolio()

  useEffect(() => {
    if (state.lastFilledAt) refetch()
  }, [state.lastFilledAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="l-page loading">
        <div className="indicator">Loading portfolio</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="l-page">
        <div className="container l-stack-md">
          <div className="text-negative mb-3">Failed to load portfolio: {error}</div>
          <button className="btn btn-sm btn-ghost" type="button" onClick={refetch}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="l-page">
      <div className="container l-stack-lg">
        <header className="mb-0">
          <PortfolioHeader user={user} stats={stats} onRefresh={refetch} />
        </header>

        <section>
          <div className="l-grid-auto-250">
            <StatCard
              icon="🤖"
              iconTone="positive"
              valueTone="positive"
              label="Active Bots"
              value={`${stats?.activeBots.running ?? 0} / ${stats?.activeBots.total ?? 0}`}
              subtitle="Currently running / total created"
            />
            <StatCard
              icon="📈"
              iconTone="accent"
              label="Top Strategy"
              value={stats?.topStrategy.return !== 0 ? `${stats?.topStrategy.return}%` : 'N/A'}
              subtitle={stats?.topStrategy.name}
            />
            <StatCard
              icon="⏱️"
              iconTone="soft"
              label="Avg Hold Time"
              value={`${stats?.avgHoldTime ?? 0} days`}
              subtitle="Average duration of positions"
            />
            <StatCard
              icon="⭐"
              iconTone="soft"
              label="Most Traded Asset"
              value={stats?.mostTradedAsset ?? '—'}
              subtitle="Asset with highest activity"
            />
          </div>
        </section>

        <section>
          <article className="card">
            <div className="panel-header">
              <h3 className="panel-title">Holdings</h3>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => navigate('/orders')}>
                Place Order
              </button>
            </div>
            <HoldingsTable holdings={holdings} />
          </article>
        </section>

        <section>
          <article className="card">
            <div className="panel-header">
              <h3 className="panel-title">Recent Activity</h3>
            </div>
            <ActivityFeed activities={recentActivity} />
          </article>
        </section>
      </div>
    </div>
  )
}

