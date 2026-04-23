import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import StrategyChart from '../components/StrategyChart'
import Calendar from '../components/Calendar'
import { useAlphaDashboard, useAlphaSignals } from '../hooks/useAlphaEngine.js'
import { getMarketPulse, getFeaturedAssets } from '../services/marketData.js'
import { useAuth } from '../app/AuthProvider.jsx'
import { usePendingOrders } from '../hooks/usePendingOrders.js'


const performanceMetrics = {
  dailyPnL: 2847.32,
  weeklyPnL: 12468.91,
  monthlyPnL: 48927.45,
  winRate: 0.68,
  sharpeRatio: 1.84,
  maxDrawdown: -0.082,
  activePositions: 12,
  totalTrades: 284,
  avgWin: 342.18,
  avgLoss: -189.73
}

const strategyPerformance = [
  { name: 'Volatility Breakout', edge: '+2.1%', winRate: '72%', trades: 48, avgHold: '3.2d', status: 'ACTIVE' },
  { name: 'AI Regime Filter', edge: '+1.7%', winRate: '68%', trades: 36, avgHold: '5.1d', status: 'ACTIVE' },
  { name: 'DCA Accumulator', edge: '+0.9%', winRate: '64%', trades: 89, avgHold: '12.4d', status: 'ACTIVE' },
  { name: 'Sniper Coil', edge: '+2.8%', winRate: '76%', trades: 27, avgHold: '2.1d', status: 'ACTIVE' },
  { name: 'Silent Compounder', edge: '+1.3%', winRate: '71%', trades: 54, avgHold: '8.7d', status: 'ACTIVE' }
]


const recentTrades = [
  { symbol: 'GOOGL', entry: 142.38, exit: 147.92, pnl: 552.34, holdTime: '3d', exitReason: 'TARGET' },
  { symbol: 'META', entry: 312.45, exit: 308.91, pnl: -354.12, holdTime: '2d', exitReason: 'STOP' },
  { symbol: 'TSLA', entry: 238.91, exit: 251.47, pnl: 1256.28, holdTime: '4d', exitReason: 'TARGET' },
  { symbol: 'AMZN', entry: 178.23, exit: 182.94, pnl: 471.85, holdTime: '2d', exitReason: 'SIGNAL' }
]

// Helper functions to transform alpha-engine data
function transformSignalsToLiveFormat(signals) {
  return signals.map(signal => ({
    symbol: signal.symbol,
    strategy: signal.source === 'top_ranked' ? 'Alpha Ranking' : 'Momentum Signal',
    confidence: signal.confidence,
    entry: '$145.32', // Mock data - would come from execution service
    stop: '$142.15',
    target: '$152.80',
    type: signal.type
  }))
}

function transformRankingsToPredictions(rankings) {
  return rankings.map(ranking => ({
    symbol: ranking.symbol,
    axis: `${ranking.confidence > 0.8 ? 'HIGH' : ranking.confidence > 0.6 ? 'MED' : 'LOW'}_VOL_PREDICT_${ranking.symbol}_AGGRESSIVE_7d`,
    prediction: (ranking.score || 0.05) * (ranking.rank > 0 ? 1 : -1),
    confidence: ranking.confidence,
    actual: null
  }))
}

function transformRankingsToFeaturedAssets(rankings) {
  return rankings.slice(0, 5).map(ranking => ({
    symbol: ranking.symbol,
    prediction: ranking.rank > 0 ? 'Bullish' : 'Bearish',
    thesis: ranking.reasons?.slice(0, 2).join(', ') || 'Strong technical signal detected',
    conviction: ranking.confidence > 0.8 ? 'HIGH' : ranking.confidence > 0.6 ? 'MEDIUM' : 'LOW',
    entry: '$145.32', // Mock data
    stop: '$142.15',
    target: '$152.80',
    riskReward: '2.1:1',
    timeHorizon: '3-5d'
  }))
}

export default function Landing() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [currentTime, setCurrentTime] = useState(new Date())
  const [selectedSignal, setSelectedSignal] = useState(null)
  const [marketPulse, setMarketPulse] = useState(getMarketPulse())

  const { pendingOrders, cancelOrder, isCanceling } = usePendingOrders({
    enabled: Boolean(user),
    pollIntervalMs: 10000
  })
  
  // Alpha Engine data
  const { dashboard, loading: dashboardLoading, error: dashboardError } = useAlphaDashboard()
  const { signals, loading: signalsLoading } = useAlphaSignals({ refreshInterval: 30000 })
  
  // Transform alpha-engine data for UI components
  const liveSignals = transformSignalsToLiveFormat(signals || [])
  const dimensionalPredictions = transformRankingsToPredictions(dashboard?.topRankings?.rankings || [])
  const featuredAssets = transformRankingsToFeaturedAssets(dashboard?.topRankings?.rankings || [])

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem 1rem 3rem' }}>

      {/* Alpha Engine Status */}
      {dashboardError && (
        <section style={{ 
          background: '#fef2f2', 
          border: '1px solid #fecaca', 
          borderRadius: 12, 
          padding: '1rem', 
          marginBottom: '1rem' 
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: '#c0392b' 
            }} />
            <strong style={{ color: '#c0392b' }}>Alpha Engine Connection Error</strong>
          </div>
          <div style={{ fontSize: '14px', color: '#c0392b', marginTop: '0.5rem' }}>
            {dashboardError}
          </div>
        </section>
      )}

      {/* Strategy Performance Chart */}
      <section style={{ background: 'white', borderRadius: 24, padding: '1.5rem', boxShadow: '0 8px 26px rgba(0,0,0,0.06)', marginBottom: '1rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <div className="eyebrow">Performance Tracking</div>
          <h2 style={{ margin: '0.5rem 0', fontSize: '1.5rem', fontWeight: 700 }}>Strategy vs Market</h2>
          <p className="muted">60-day performance comparison with entry/exit predictions from our Volatility Breakout strategy</p>
        </div>
        <StrategyChart />
      </section>

      {/* Market Pulse & Performance Grid */}
      <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <article style={{ background: 'linear-gradient(140deg, #111, #2a2a2a)', color: '#fff', borderRadius: 24, padding: '1.2rem' }}>
          <div className="eyebrow" style={{ color: '#d9d9d9' }}>Market Pulse</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '2rem', fontWeight: 700 }}>{marketPulse.regime}</div>
              <div style={{ marginTop: '0.5rem', opacity: 0.88 }}>Signal breadth: {marketPulse.signalBreadth}% bullish</div>
              <div style={{ opacity: 0.88 }}>Volatility regime: {marketPulse.volatilityRegime}</div>
              <div style={{ opacity: 0.88 }}>VIX: {marketPulse.vix}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#6effb6' }}>{marketPulse.sp500Change}</div>
              <div style={{ fontSize: '0.9rem', opacity: 0.88 }}>S&P 500</div>
              <div style={{ marginTop: '0.8rem', color: '#6effb6', fontWeight: 700 }}>Top: {marketPulse.topOpportunity}</div>
            </div>
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Performance Today</strong>
          <div style={{ marginTop: '0.8rem' }}>
            <div className="muted">Daily P&L</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: performanceMetrics.dailyPnL > 0 ? '#1f8a4c' : '#c0392b' }}>
              ${performanceMetrics.dailyPnL.toFixed(2)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
              <div>
                <div className="muted">Win Rate</div>
                <div style={{ fontWeight: 600 }}>{(performanceMetrics.winRate * 100).toFixed(1)}%</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="muted">Sharpe</div>
                <div style={{ fontWeight: 600 }}>{performanceMetrics.sharpeRatio.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </article>
      </section>

      {/* Live Signals & Predictions */}
      <section style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Live Signals</strong>
            <div style={{ fontSize: '12px', color: '#7a7a7a' }}>
              {signalsLoading ? 'Loading...' : `${liveSignals.length} active`}
            </div>
          </div>
          <div style={{ marginTop: '0.8rem', maxHeight: '300px', overflowY: 'auto' }}>
            {signalsLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                Loading signals from Alpha Engine...
              </div>
            ) : liveSignals.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                No active signals available
              </div>
            ) : (
              liveSignals.map((signal, index) => (
                <div
                  key={`${signal.symbol}-${index}`}
                  style={{
                    borderBottom: '1px solid #eee',
                    paddingBottom: '0.8rem',
                    marginBottom: '0.8rem',
                    cursor: 'pointer',
                    backgroundColor: selectedSignal?.symbol === signal.symbol ? '#f8f9fa' : 'transparent',
                    padding: '0.5rem',
                    borderRadius: '8px'
                  }}
                  onClick={() => setSelectedSignal(signal)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '16px' }}>{signal.symbol}</div>
                      <div className="muted" style={{ fontSize: '12px' }}>{signal.strategy}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        backgroundColor: signal.confidence > 0.8 ? '#1f8a4c' : signal.confidence > 0.7 ? '#f39c12' : '#e74c3c',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 600
                      }}>
                        {(signal.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '12px' }}>
                    <div>
                      <span className="muted">Entry:</span> {signal.entry}
                    </div>
                    <div>
                      <span className="muted">Stop:</span> {signal.stop}
                    </div>
                    <div>
                      <span className="muted">Target:</span> {signal.target}
                    </div>
                    <div>
                      <span className="muted">Type:</span> {signal.type}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Dimensional Predictions</strong>
          <div style={{ marginTop: '0.8rem', fontSize: '12px', color: '#7a7a7a' }}>6D Tagged Predictions</div>
          <div style={{ maxHeight: '300px', overflowY: 'auto', marginTop: '0.5rem' }}>
            {dashboardLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                Loading predictions from Alpha Engine...
              </div>
            ) : dimensionalPredictions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                No predictions available
              </div>
            ) : (
              dimensionalPredictions.map((pred, index) => (
                <div key={`${pred.symbol}-${index}`} style={{ borderBottom: '1px solid #eee', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{pred.symbol}</strong>
                    <span style={{ color: pred.actual ? '#1f8a4c' : '#7a7a7a' }}>
                      {pred.actual ? `${(pred.actual * 100).toFixed(1)}%` : `${(pred.prediction * 100).toFixed(1)}%`}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: '11px', marginTop: '0.2rem' }}>{pred.axis}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem', fontSize: '11px' }}>
                    <span className="muted">Conf: {(pred.confidence * 100).toFixed(0)}%</span>
                    {pred.actual && <span className="muted">Actual: {(pred.actual * 100).toFixed(1)}%</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      {/* Featured Assets with Enhanced Details */}
      <section style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)', marginBottom: '1rem' }}>
        <strong>Featured Assets</strong>
        <div style={{ display: 'grid', gap: '0.8rem', marginTop: '0.8rem' }}>
          {dashboardLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
              Loading featured assets from Alpha Engine...
            </div>
          ) : featuredAssets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
              No featured assets available
            </div>
          ) : (
            featuredAssets.map((asset) => (
            <div key={asset.symbol} style={{
              border: '1px solid #eee',
              borderRadius: 12,
              padding: '1rem',
              backgroundColor: asset.conviction === 'HIGH' ? '#f8f9fa' : 'white'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <strong style={{ fontSize: '18px' }}>{asset.symbol}</strong>
                    <span style={{
                      backgroundColor: asset.prediction.includes('Bullish') ? '#1f8a4c' : asset.prediction.includes('Neutral') ? '#f39c12' : '#e74c3c',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 600
                    }}>
                      {asset.prediction}
                    </span>
                    {asset.conviction === 'HIGH' && (
                      <span style={{
                        backgroundColor: '#6c5ce7',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 600
                      }}>
                        HIGH CONVICTION
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ marginTop: '0.3rem', fontSize: '14px' }}>{asset.thesis}</div>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '12px' }}>
                    <div>
                      <span className="muted">Entry:</span> ${asset.entry}
                    </div>
                    <div>
                      <span className="muted">Stop:</span> ${asset.stop}
                    </div>
                    <div>
                      <span className="muted">Target:</span> ${asset.target}
                    </div>
                    <div>
                      <span className="muted">R:R</span> {asset.riskReward}
                    </div>
                    <div>
                      <span className="muted">Horizon:</span> {asset.timeHorizon}
                    </div>
                  </div>
                </div>
                <button
                  className="ghost pressable"
                  onClick={() => navigate(`/assets/${asset.symbol}`)}
                  style={{ padding: '0.5rem 1rem', fontSize: '12px' }}
                >
                  Analyze
                </button>
              </div>
            </div>
          )))}
        </div>
      </section>

      {/* Strategy Performance & Recent Trades */}
      <section style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Strategy Performance</strong>
          <div style={{ marginTop: '0.8rem', maxHeight: '300px', overflowY: 'auto' }}>
            {strategyPerformance.map((strategy) => (
              <div key={strategy.name} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto auto',
                gap: '0.5rem',
                borderBottom: '1px solid #eee',
                paddingBottom: '0.5rem',
                marginBottom: '0.5rem',
                alignItems: 'center',
                fontSize: '12px'
              }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{strategy.name}</div>
                  <div className="muted">{strategy.trades} trades</div>
                </div>
                <div style={{ color: '#1f8a4c', fontWeight: 700 }}>{strategy.edge}</div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 600 }}>{strategy.winRate}</div>
                  <div className="muted">Win Rate</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontWeight: 600 }}>{strategy.avgHold}</div>
                  <div className="muted">Avg Hold</div>
                </div>
                <div>
                  <span style={{
                    backgroundColor: strategy.status === 'ACTIVE' ? '#1f8a4c' : '#e74c3c',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '8px',
                    fontSize: '10px',
                    fontWeight: 600
                  }}>
                    {strategy.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Recent Trades</strong>
          <div style={{ marginTop: '0.8rem', maxHeight: '300px', overflowY: 'auto' }}>
            {user ? (
              pendingOrders.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#666', textAlign: 'center', padding: '1rem' }}>
                  No pending orders.
                </div>
              ) : (
                pendingOrders.slice(0, 10).map((o) => {
                  const side = (o.side ?? '').toUpperCase()
                  const qty = o.quantity ?? 0
                  const price = o.price ?? 0
                  return (
                    <div key={o.id} style={{ borderBottom: '1px solid #eee', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                        <strong>{o.ticker}</strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#856404' }}>
                            {o.status === 'queued' ? 'Queued' : 'Processing'}
                          </span>
                          <button
                            className="ghost pressable"
                            onClick={() => cancelOrder(o.id)}
                            disabled={isCanceling(o.id)}
                            style={{ padding: '0.25rem 0.5rem', fontSize: '11px' }}
                          >
                            {isCanceling(o.id) ? 'Canceling…' : 'Cancel'}
                          </button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem', fontSize: '12px' }}>
                        <div>
                          <span className="muted">{side} {qty} @ ${Number(price).toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="muted">{o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}</span>
                        </div>
                      </div>
                    </div>
                  )
                })
              )
            ) : (
              recentTrades.map((trade, index) => (
                <div key={index} style={{ borderBottom: '1px solid #eee', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{trade.symbol}</strong>
                    <span style={{ color: trade.pnl > 0 ? '#1f8a4c' : '#c0392b', fontWeight: 600 }}>
                      ${trade.pnl.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem', fontSize: '12px' }}>
                    <div>
                      <span className="muted">${trade.entry} → ${trade.exit}</span>
                    </div>
                    <div>
                      <span className="muted">{trade.holdTime}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: '#7a7a7a' }}>
                    Exit: {trade.exitReason}
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      {/* Trading Calendar */}
      <section style={{ background: 'white', borderRadius: 24, padding: '2rem', boxShadow: '0 8px 26px rgba(0,0,0,0.06)', marginBottom: '1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div className="eyebrow">Trading Calendar</div>
          <h2 style={{ margin: '0.5rem 0', fontSize: '2rem', fontWeight: 700, lineHeight: 1.2 }}>Alpha Engine Predictions</h2>
          <p className="muted" style={{ maxWidth: 600, margin: '0 auto', fontSize: '18px', lineHeight: 1.5 }}>
            Interactive calendar showing all trading signals, predictions, and economic events for the current month.
          </p>
        </div>

        <Calendar />

        {/* Call to Action */}
        <div style={{ textAlign: 'center', marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid #e9ecef' }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '1rem' }}>Never miss a trading opportunity</h3>
          <p className="muted" style={{ marginBottom: '1.5rem' }}>
            Get instant notifications when our Alpha Engine generates new signals or targets are reached.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="primary pressable" onClick={() => navigate('/notifications')}>
              Get Notified
            </button>
            <button className="ghost pressable" onClick={() => navigate('/signals')}>
              View All Signals
            </button>
            <button className="ghost pressable" onClick={() => navigate('/calendar')}>
              Export Calendar
            </button>
          </div>
        </div>
      </section>

      {/* System Health & Automation */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>System Health</strong>
          <div style={{ marginTop: '0.8rem' }}>
            <div className="muted">Bots Online</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>9 / 10</div>
            <div style={{ color: '#1f8a4c', fontWeight: 600, fontSize: '14px' }}>Execution latency normal</div>
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Risk Metrics</strong>
          <div style={{ marginTop: '0.8rem' }}>
            <div className="muted">Portfolio Heat</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>6.8%</div>
            <div style={{ color: '#f39c12', fontWeight: 600, fontSize: '14px' }}>Within limits</div>
          </div>
        </article>

        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Prediction Quality</strong>
          <div style={{ marginTop: '0.8rem' }}>
            <div className="muted">7-day precision</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>71%</div>
            <div style={{ color: '#1f8a4c', fontWeight: 600, fontSize: '14px' }}>Improving trend</div>
          </div>
        </article>
      </section>

      {/* What We Do Section */}
      <section style={{ background: 'white', borderRadius: 24, padding: '2rem', boxShadow: '0 8px 26px rgba(0,0,0,0.06)', marginBottom: '1rem' }}>
        <div style={{ textAlign: 'right', fontSize: '12px', color: '#7a7a7a' }}>
          <div>Last Update</div>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>{currentTime.toLocaleTimeString()}</div>
        </div>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h2 style={{ margin: '0.5rem 0', fontSize: '2rem', fontWeight: 700, lineHeight: 1.2 }}>Algorithmic Trading Made Intelligent</h2>
          <p className="muted" style={{ maxWidth: 600, margin: '0 auto', fontSize: '18px', lineHeight: 1.5 }}>
            Lumantic transforms complex market data into actionable trading intelligence through advanced machine learning and automated execution.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>#</div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '0.5rem', color: '#111' }}>Signal Generation</h3>
            <p className="muted" style={{ lineHeight: 1.5 }}>
              Our Alpha Engine analyzes thousands of data points in real-time to generate high-confidence trading signals across multiple strategies and timeframes.
            </p>
            <button className="ghost pressable" style={{ marginTop: '1rem', fontSize: '14px' }} onClick={() => navigate('/signals')}>
              Learn More
            </button>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>#</div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '0.5rem', color: '#111' }}>Risk Management</h3>
            <p className="muted" style={{ lineHeight: 1.5 }}>
              Sophisticated position sizing, stop-loss management, and portfolio heat controls protect capital while maximizing opportunity capture.
            </p>
            <button className="ghost pressable" style={{ marginTop: '1rem', fontSize: '14px' }} onClick={() => navigate('/risk')}>
              Learn More
            </button>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>#</div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '0.5rem', color: '#111' }}>Automated Execution</h3>
            <p className="muted" style={{ lineHeight: 1.5 }}>
              Lightning-fast trade execution with minimal latency ensures signals are captured at optimal prices across multiple market conditions.
            </p>
            <button className="ghost pressable" style={{ marginTop: '1rem', fontSize: '14px' }} onClick={() => navigate('/bots')}>
              Start a Bot
            </button>
          </div>
        </div>

        <div style={{ textAlign: 'center', paddingTop: '2rem', borderTop: '1px solid #e9ecef' }}>
          <h3 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '1rem' }}>Ready to get started?</h3>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="primary pressable" onClick={() => navigate('/register')}>
              Start Trading Now
            </button>
            <button className="ghost pressable" onClick={() => navigate('/demo')}>
              Request Demo
            </button>
            <button className="ghost pressable" onClick={() => navigate('/notifications')}>
              Get Notified
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
