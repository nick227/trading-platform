import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { usePortfolio } from '../hooks/usePortfolio.js'
import { useBotConsole } from '../hooks/useBotConsole.js'
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
  const { botStatus, todayPNL, runOnce, toggleBot } = useBotConsole({ onAction: refetch })

  // Immediately invalidate and refetch whenever an order is confirmed as filled,
  // regardless of whether the component was already mounted.
  useEffect(() => {
    if (state.lastFilledAt) refetch()
  }, [state.lastFilledAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="page">
        <div className="container portfolio" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
          <div className="muted">Loading portfolio…</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <div className="container portfolio">
          <div style={{ color: '#c0392b', marginBottom: '1rem' }}>Failed to load portfolio: {error}</div>
          <button className="ghost pressable" onClick={refetch}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="container portfolio">
      <header style={{ marginBottom: '0' }}>
        <PortfolioHeader user={user} stats={stats} onRefresh={refetch} />
      </header>

      {/* Bot Console Section */}
      <article className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Bot Console</h3>
          <button className="ghost pressable" onClick={() => navigate('/bot')} style={{ fontSize: '14px' }}>Full Console</button>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: botStatus === 'running' ? '#0a7a47' : '#666' }}>
              {botStatus === 'running' ? '🤖' : '⏸️'}
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '0.25rem' }}>Status</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: todayPNL >= 0 ? '#0a7a47' : '#c0392b' }}>
              ${todayPNL.toFixed(2)}
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '0.25rem' }}>Today P&L</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <button className="primary pressable" onClick={runOnce} style={{ padding: '0.5rem 1rem', fontSize: '12px' }}>
              Run Once
            </button>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '0.25rem' }}>Manual Trade</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <button className="ghost pressable" onClick={toggleBot} style={{ padding: '0.5rem 1rem', fontSize: '12px' }}>
              {botStatus === 'running' ? 'Stop' : 'Start'}
            </button>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '0.25rem' }}>Auto Bot</div>
          </div>
        </div>
      </article>

      <section style={{ marginBottom: '0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
          <StatCard
            iconBg="#e8f5e8" icon="#"
            label="Active Bots"
            value={<span style={{ color: '#0a7a47' }}>{stats?.activeBots.running ?? 0} / {stats?.activeBots.total ?? 0}</span>}
            subtitle="Currently running / total created"
          />
          <StatCard
            iconBg="#f0f9f4" icon="#"
            label="Top Strategy"
            value={stats?.topStrategy.return !== 0 ? `${stats?.topStrategy.return}%` : 'N/A'}
            subtitle={stats?.topStrategy.name}
          />
          <StatCard
            iconBg="#f3e5f5" icon="#"
            label="Avg Hold Time"
            value={`${stats?.avgHoldTime ?? 0} days`}
            subtitle="Average duration of positions"
          />
          <StatCard
            iconBg="#e3f2fd" icon="#"
            label="Most Traded Asset"
            value={stats?.mostTradedAsset ?? '—'}
            subtitle="Asset with highest activity"
          />
        </div>
      </section>

      <section style={{ marginBottom: '0' }}>
        <article className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Holdings</h3>
            <button className="ghost pressable" style={{ fontSize: '14px' }} onClick={() => navigate('/assets')}>View All</button>
          </div>
          <HoldingsTable holdings={holdings} />
        </article>
      </section>

      <section>
        <article className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Recent Activity</h3>
            <button className="ghost pressable" style={{ fontSize: '14px' }} onClick={() => navigate('/orders')}>View All</button>
          </div>
          <ActivityFeed activities={recentActivity} />
        </article>
      </section>
      </div>
    </div>
  )
}
