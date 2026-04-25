import { useState, useEffect, useCallback, useMemo } from 'react'
import LazyLoad from '../components/LazyLoad.jsx'
import { usePortfolio } from '../hooks/usePortfolio.js'

export default function Performance() {
  const { performanceStats, loading: portfolioLoading } = usePortfolio()
  const [dailySnapshots, setDailySnapshots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchDailySnapshots = async () => {
      try {
        setLoading(true)
        const snapshotsRes = await fetch('/api/performance/daily-snapshots')
        setDailySnapshots(await snapshotsRes.json())
      } catch (error) {
        setError(error.message)
      } finally {
        setLoading(false)
      }
    }

    fetchDailySnapshots()
    const interval = setInterval(fetchDailySnapshots, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [])
  
  if (portfolioLoading || loading) {
    return (
      <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
        <div className="muted">Loading performance data…</div>
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
        <div style={{ color: '#c0392b', marginBottom: '1rem' }}>Failed to load performance: {error}</div>
        <button className="ghost pressable" onClick={() => window.location.reload()}>Retry</button>
      </div>
    )
  }
  
  return (
    <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '28px', fontWeight: 700 }}>Performance</h1>
        <p className="muted">Trading performance and bot analytics</p>
      </header>
      
      {/* Performance Summary */}
      {stats && (
        <section style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div className="muted" style={{ fontSize: '12px', marginBottom: '0.5rem' }}>Total Trades</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>{stats.total_trades}</div>
            </div>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div className="muted" style={{ fontSize: '12px', marginBottom: '0.5rem' }}>Win Rate</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: stats.win_rate >= 50 ? '#0a7a47' : '#c0392b' }}>
                {stats.win_rate?.toFixed(1)}%
              </div>
            </div>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div className="muted" style={{ fontSize: '12px', marginBottom: '0.5rem' }}>Total P&L</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: stats.total_pnl >= 0 ? '#0a7a47' : '#c0392b' }}>
                ${stats.total_pnl?.toFixed(2)}
              </div>
            </div>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div className="muted" style={{ fontSize: '12px', marginBottom: '0.5rem' }}>Winning Trades</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#0a7a47' }}>
                {stats.winning_trades}
              </div>
            </div>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div className="muted" style={{ fontSize: '12px', marginBottom: '0.5rem' }}>Losing Trades</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#c0392b' }}>
                {stats.losing_trades}
              </div>
            </div>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div className="muted" style={{ fontSize: '12px', marginBottom: '0.5rem' }}>Avg Hold Time</div>
              <div style={{ fontSize: '24px', fontWeight: 700 }}>
                {stats.avg_hold_time ?? 0} min
              </div>
            </div>
            <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div className="muted" style={{ fontSize: '12px', marginBottom: '0.5rem' }}>Most Traded</div>
              <div style={{ fontSize: '20px', fontWeight: 700 }}>
                {stats.most_traded_asset || '—'}
              </div>
            </div>
          </div>
        </section>
      )}
      
      {/* Daily Performance */}
      <LazyLoad
        fallback={
          <div style={{ 
            height: '300px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            background: 'white',
            borderRadius: '16px',
            marginBottom: '1rem'
          }}>
            <div style={{ color: '#666' }}>Loading daily performance...</div>
          </div>
        }
        rootMargin="100px"
      >
        <section>
          <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            <h2 style={{ margin: '0 0 1.5rem', fontSize: '20px', fontWeight: 600 }}>Daily Performance</h2>
          
          {dailySnapshots.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
              <div style={{ fontSize: '48px', marginBottom: '1rem' }}>📊</div>
              <p>No daily performance data yet. Start trading to see daily snapshots.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {dailySnapshots.map(snapshot => (
                <div key={snapshot.id} style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  padding: '1rem',
                  background: '#f8f9fa',
                  borderRadius: '8px',
                  border: '1px solid #e9ecef'
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>
                      {new Date(snapshot.snapshot_date).toLocaleDateString()}
                    </div>
                    <div className="muted" style={{ fontSize: '12px' }}>
                      {snapshot.total_trades} trades
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ 
                      fontWeight: 600, 
                      fontSize: '16px',
                      color: snapshot.day_pnl >= 0 ? '#0a7a47' : '#c0392b' 
                    }}>
                      ${snapshot.day_pnl?.toFixed(2)}
                    </div>
                    <div className="muted" style={{ fontSize: '12px' }}>
                      {snapshot.winning_trades} wins / {snapshot.total_trades - snapshot.winning_trades} losses
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          </article>
        </section>
      </LazyLoad>
    </div>
  )
}
