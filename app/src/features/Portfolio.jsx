import { useNavigate } from 'react-router-dom'
import { useState, useMemo } from 'react'

// Enhanced company data with avatars and details
const holdingsData = [
  {
    ticker: 'NVDA',
    company: 'NVIDIA Corporation',
    marketValue: 12400,
    buyIn: 10800,
    shares: 45,
    avgCost: 240.00,
    currentPrice: 275.56,
    change: +35.56,
    changePct: +14.8,
    ageDays: 12,
    sector: 'Technology',
    avatar: 'https://logo.clearbit.com/nvidia.com',
    weight: 59.0
  },
  {
    ticker: 'AAPL',
    company: 'Apple Inc.',
    marketValue: 5400,
    buyIn: 5000,
    shares: 32,
    avgCost: 156.25,
    currentPrice: 168.75,
    change: +12.50,
    changePct: +8.0,
    ageDays: 19,
    sector: 'Technology',
    avatar: 'https://logo.clearbit.com/apple.com',
    weight: 25.7
  },
  {
    ticker: 'TSLA',
    company: 'Tesla, Inc.',
    marketValue: 3200,
    buyIn: 2800,
    shares: 12,
    avgCost: 233.33,
    currentPrice: 266.67,
    change: +33.34,
    changePct: +14.3,
    ageDays: 8,
    sector: 'Automotive',
    avatar: 'https://logo.clearbit.com/tesla.com',
    weight: 15.2
  }
]

// User aggregate facts
const userStats = {
  totalValue: 21000,
  dailyChangeAmount: 420,
  dailyChangePct: 2.0,
  totalReturn: 4200,
  totalReturnPct: 25.0,
  cashBalance: 4200,
  investedAmount: 16800,
  winRate: 75.0,
  avgHoldTime: 13,
  totalTrades: 24,
  bestPerformer: 'NVDA (+14.8%)',
  worstPerformer: 'TSLA (+14.3%)',
  activeBots: { running: 3, total: 8 },
  topStrategy: { name: 'Alpha Momentum', return: 34.2 },
  highConfidenceWins: 18,
  mostTradedAsset: 'NVDA'
}

export default function Portfolio() {
  const navigate = useNavigate()
  const [sortConfig, setSortConfig] = useState({ key: 'marketValue', direction: 'desc' })

  // Sorting function
  const handleSort = (key) => {
    // Only update if different key or same key with different direction
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      // If clicking the same column that's already descending, cycle back to ascending
      setSortConfig({ key, direction: 'asc' })
    } else if (sortConfig.key === key && sortConfig.direction === 'asc') {
      // If clicking the same column that's ascending, change to descending
      setSortConfig({ key, direction: 'desc' })
    } else {
      // If clicking a different column, start with ascending
      setSortConfig({ key, direction: 'asc' })
    }
  }

  // Memoized sorted holdings to prevent flickering
  const sortedHoldings = useMemo(() => {
    const sorted = [...holdingsData].sort((a, b) => {
      let aVal = a[sortConfig.key]
      let bVal = b[sortConfig.key]
      
      // Handle numeric values
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal
      }
      
      // Handle string values
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [sortConfig.key, sortConfig.direction])

  // Recent activity data
  const recentActivity = [
    { event: 'Alpha Bot executed NVDA', value: '+$420', time: '2m ago', type: 'buy' },
    { event: 'Bought AAPL', value: '+$500', time: '1h ago', type: 'buy' },
    { event: 'Sold TSLA', value: '+$320', time: '3h ago', type: 'sell' },
    { event: 'Dividend from AAPL', value: '+$24', time: '1d ago', type: 'dividend' },
    { event: 'Alpha Bot executed AMD', value: '+$180', time: '2d ago', type: 'buy' }
  ]

  return (
    <div className="page container" style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Personalized Portfolio Header */}
      <header style={{ marginBottom: '0' }}>
        {/* User Welcome Section */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          marginBottom: '0',
          padding: '1.5rem',
          background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
          borderRadius: '16px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <img 
              src="https://api.dicebear.com/7.x/avataaars/svg?seed=John" 
              alt="User Avatar"
              style={{ 
                width: '64px', 
                height: '64px', 
                borderRadius: '50%', 
                marginRight: '1rem',
                border: '3px solid white',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}
            />
            <div>
              <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>Welcome back</div>
              <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#111' }}>
                John Anderson
              </h2>
              <div className="muted" style={{ fontSize: '14px', marginBottom: '0.5rem' }}>
                Portfolio performing well today
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div>
                  <span className="muted" style={{ fontSize: '12px' }}>Portfolio Value: </span>
                  <span style={{ fontSize: '16px', fontWeight: 600 }}>
                    ${userStats.totalValue.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="muted" style={{ fontSize: '12px' }}>Today: </span>
                  <span style={{ 
                    fontSize: '16px', 
                    fontWeight: 600,
                    color: userStats.dailyChangeAmount >= 0 ? '#0a7a47' : '#c0392b'
                  }}>
                    {userStats.dailyChangeAmount >= 0 ? '+' : ''}${userStats.dailyChangeAmount.toLocaleString()} ({userStats.dailyChangeAmount >= 0 ? '+' : ''}{userStats.dailyChangePct.toFixed(1)}%)
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: '12px', marginBottom: '0.25rem' }}>Last Updated</div>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>
              {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>
      </header>

      {/* Enhanced Summary Section */}
      <section style={{ marginBottom: '0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
          <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#e8f5e8', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '1rem' }}>
                <span style={{ fontSize: '20px' }}>#</span>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Active Bots</h3>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#0a7a47' }}>
                  {userStats.activeBots.running} / {userStats.activeBots.total}
                </div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: '12px' }}>
              Currently running / total created
            </div>
          </article>

          <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#f0f9f4', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '1rem' }}>
                <span style={{ fontSize: '20px' }}>#</span>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Top Strategy</h3>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>
                  {userStats.topStrategy.return}%
                </div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: '12px' }}>
              {userStats.topStrategy.name}
            </div>
          </article>

          <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#f3e5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '1rem' }}>
                <span style={{ fontSize: '20px' }}>#</span>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Avg Hold Time</h3>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>
                  {userStats.avgHoldTime} days
                </div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: '12px' }}>
              Average duration of positions
            </div>
          </article>

          <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#e3f2fd', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '1rem' }}>
                <span style={{ fontSize: '20px' }}>#</span>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Most Traded Asset</h3>
                <div style={{ fontSize: '24px', fontWeight: 700 }}>
                  {userStats.mostTradedAsset}
                </div>
              </div>
            </div>
            <div className="muted" style={{ fontSize: '12px' }}>
              Asset with highest activity
            </div>
          </article>
        </div>
      </section>

      {/* Enhanced Holdings Section */}
      <section style={{ marginBottom: '0' }}>
        <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Holdings</h3>
            <button className="ghost pressable" style={{ fontSize: '14px' }} onClick={() => navigate('/assets')}>
              View All
            </button>
          </div>
          
          {/* Table Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '60px 2fr 1fr 1fr 1fr 1fr 1fr auto', gap: '1rem', padding: '0.75rem 0', borderBottom: '2px solid #e9ecef', fontSize: '12px', fontWeight: 600, color: '#7a7a7a' }}>
            <div></div>
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={() => handleSort('ticker')}>
              <span>Company</span>
              {sortConfig.key === 'ticker' && (
                <span style={{ marginLeft: '4px', fontSize: '10px' }}>
                  {sortConfig.direction === 'asc' ? 'up' : 'down'}
                </span>
              )}
            </div>
            <div style={{ cursor: 'pointer', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }} onClick={() => handleSort('shares')}>
              <span>Shares</span>
              {sortConfig.key === 'shares' && (
                <span style={{ marginLeft: '4px', fontSize: '10px' }}>
                  {sortConfig.direction === 'asc' ? 'up' : 'down'}
                </span>
              )}
            </div>
            <div style={{ cursor: 'pointer', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }} onClick={() => handleSort('avgCost')}>
              <span>Avg Cost</span>
              {sortConfig.key === 'avgCost' && (
                <span style={{ marginLeft: '4px', fontSize: '10px' }}>
                  {sortConfig.direction === 'asc' ? 'up' : 'down'}
                </span>
              )}
            </div>
            <div style={{ cursor: 'pointer', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }} onClick={() => handleSort('currentPrice')}>
              <span>Current</span>
              {sortConfig.key === 'currentPrice' && (
                <span style={{ marginLeft: '4px', fontSize: '10px' }}>
                  {sortConfig.direction === 'asc' ? 'up' : 'down'}
                </span>
              )}
            </div>
            <div style={{ cursor: 'pointer', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }} onClick={() => handleSort('changePct')}>
              <span>Change</span>
              {sortConfig.key === 'changePct' && (
                <span style={{ marginLeft: '4px', fontSize: '10px' }}>
                  {sortConfig.direction === 'asc' ? 'up' : 'down'}
                </span>
              )}
            </div>
            <div style={{ cursor: 'pointer', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }} onClick={() => handleSort('marketValue')}>
              <span>Value</span>
              {sortConfig.key === 'marketValue' && (
                <span style={{ marginLeft: '4px', fontSize: '10px' }}>
                  {sortConfig.direction === 'asc' ? 'up' : 'down'}
                </span>
              )}
            </div>
            <div style={{ textAlign: 'center' }}>Actions</div>
          </div>
          
          {/* Holdings Rows */}
          {sortedHoldings.map((holding) => (
            <div key={holding.ticker} style={{ display: 'grid', gridTemplateColumns: '60px 2fr 1fr 1fr 1fr 1fr 1fr auto', gap: '1rem', padding: '1rem 0', borderBottom: '1px solid #f0f0f0', alignItems: 'center' }}>
              <div>
                <img 
                  src={holding.avatar} 
                  alt={holding.ticker}
                  style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }}
                  onError={(e) => { e.target.src = `https://via.placeholder.com/32x32/${holding.ticker === 'NVDA' ? '76b900' : holding.ticker === 'AAPL' ? '000000' : 'cc0000'}/ffffff?text=${holding.ticker}` }}
                />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{holding.company}</div>
                <div className="muted" style={{ fontSize: '12px' }}>{holding.ticker} · {holding.sector}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{holding.shares}</div>
                <div className="muted" style={{ fontSize: '11px' }}>{((holding.shares * holding.currentPrice) / userStats.totalValue * 100).toFixed(1)}%</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>${holding.avgCost.toFixed(2)}</div>
                <div className="muted" style={{ fontSize: '11px' }}>{holding.ageDays} days</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>${holding.currentPrice.toFixed(2)}</div>
                <div className="muted" style={{ fontSize: '11px' }}>Market</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: holding.change >= 0 ? '#0a7a47' : '#c0392b' }}>
                  {holding.change >= 0 ? '+' : ''}${holding.change.toFixed(2)}
                </div>
                <div className="muted" style={{ fontSize: '11px', color: holding.change >= 0 ? '#0a7a47' : '#c0392b' }}>
                  {holding.change >= 0 ? '+' : ''}{holding.changePct.toFixed(1)}%
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, fontSize: '16px' }}>${holding.marketValue.toLocaleString()}</div>
                <div className="muted" style={{ fontSize: '11px' }}>{holding.weight.toFixed(1)}%</div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="primary pressable"
                  onClick={() => navigate(`/orders?ticker=${holding.ticker}`)}
                  style={{ 
                    padding: '0.5rem 1rem', 
                    fontSize: '12px', 
                    fontWeight: 600,
                    minWidth: '60px'
                  }}
                  title={`Buy more ${holding.ticker}`}
                >
                  Buy
                </button>
                <button
                  className="ghost pressable"
                  onClick={() => navigate(`/orders?ticker=${holding.ticker}`)}
                  style={{ 
                    padding: '0.5rem 1rem', 
                    fontSize: '12px', 
                    fontWeight: 600,
                    minWidth: '60px',
                    borderColor: '#c0392b',
                    color: '#c0392b'
                  }}
                  title={`Sell ${holding.ticker}`}
                >
                  Sell
                </button>
              </div>
            </div>
          ))}
        </article>
      </section>

      {/* Recent Activity - Moved to Bottom */}
      <section>
        <article style={{ background: 'white', borderRadius: 16, padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Recent Activity</h3>
            <button className="ghost pressable" style={{ fontSize: '14px' }} onClick={() => navigate('/activity')}>
              View All
            </button>
          </div>
          
          <div style={{ display: 'grid', gap: '1rem' }}>
            {recentActivity.map((activity, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', padding: '1rem', background: '#f8f9fa', borderRadius: '8px' }}>
                <div style={{ 
                  width: '32px', 
                  height: '32px', 
                  borderRadius: '50%', 
                  background: activity.type === 'buy' ? '#e8f5e8' : activity.type === 'sell' ? '#ffeaea' : '#fff3e0',
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  marginRight: '1rem'
                }}>
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>
                    {activity.type === 'buy' ? 'B' : activity.type === 'sell' ? 'S' : 'D'}
                  </span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>{activity.event}</div>
                  <div className="muted" style={{ fontSize: '12px' }}>{activity.time}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: '16px', color: '#0a7a47' }}>
                    {activity.value}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  )
}
