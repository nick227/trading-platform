import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import StrategyChart from '../components/StrategyChart'
import Calendar from '../components/Calendar'
import { useAlphaDashboard, useAlphaSignals } from '../hooks/useAlphaEngine.js'
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

function transformRankingsForTable(rankings) {
  return rankings.map(ranking => ({
    symbol: ranking.symbol,
    direction: (ranking.score ?? 0) >= 0 ? 'Bullish' : 'Bearish',
    score: ranking.score,
    confidence: ranking.confidence,
    reason: ranking.reasons?.[0] || null,
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

function formatTimeLabel(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toFixed(digits)
}

function buildMarketPulse({ dashboard, signals }) {
  const list = Array.isArray(signals) ? signals : []
  const entries = list.filter(s => s?.type === 'ENTRY').length
  const exits = list.filter(s => s?.type === 'EXIT').length
  const totalAlerts = entries + exits

  const confidences = list
    .map(s => Number(s?.confidence))
    .filter(c => Number.isFinite(c))

  const confidenceCoverage = totalAlerts > 0 ? `${confidences.length}/${totalAlerts}` : '—'
  const confidenceCoverageNote = totalAlerts > 0
    ? (confidences.length === totalAlerts ? 'complete' : 'partial')
    : '—'

  const topRankings = dashboard?.topRankings?.rankings || []
  const topRanked = topRankings.slice(0, 5).map((r, idx) => ({
    symbol: String(r?.symbol || '').toUpperCase(),
    rank: typeof r?.rank === 'number' ? r.rank : idx + 1,
    score: Number.isFinite(Number(r?.score)) ? Number(r.score) : null,
    edgeScore: Number.isFinite(Number(r?.edgeScore)) ? Number(r.edgeScore) : null,
    price: Number.isFinite(Number(r?.price)) ? Number(r.price) : null,
    dailyChangePct: Number.isFinite(Number(r?.dailyChangePct)) ? Number(r.dailyChangePct) : null
  })).filter(r => Boolean(r.symbol))

  const topScoreMax = topRanked.reduce((mx, r) => {
    const score = Number.isFinite(r.score) ? r.score : null
    return score == null ? mx : Math.max(mx, score)
  }, 0)

  const movers = dashboard?.movers?.rankings || []
  const uniqueBySymbol = (rows) => {
    const seen = new Set()
    const out = []
    for (const row of rows) {
      const symbol = String(row?.symbol || '').toUpperCase()
      if (!symbol || seen.has(symbol)) continue
      seen.add(symbol)
      out.push(row)
    }
    return out
  }

  const improving = uniqueBySymbol(movers)
    .filter(m => (Number(m?.rankChange) || 0) > 0)
    .sort((a, b) => (Number(b?.rankChange) || 0) - (Number(a?.rankChange) || 0))
    .slice(0, 3)
    .map(m => ({ symbol: m?.symbol || '—', change: Number(m?.rankChange) || 0 }))

  const cooling = uniqueBySymbol(movers)
    .filter(m => (Number(m?.rankChange) || 0) < 0)
    .sort((a, b) => (Number(a?.rankChange) || 0) - (Number(b?.rankChange) || 0))
    .slice(0, 3)
    .map(m => ({ symbol: m?.symbol || '—', change: Number(m?.rankChange) || 0 }))

  const admission = dashboard?.admission?.summary || {}
  const admitted = typeof admission.admitted === 'number' ? admission.admitted : null
  const removed = typeof admission.removed === 'number' ? admission.removed : null
  const queued = typeof admission.queued === 'number' ? admission.queued : null
  const admissionPeriod = dashboard?.admission?.period || 'recent'

  const healthStatus = dashboard?.health?.status || 'unknown'
  const asOf = dashboard?.lastUpdated || dashboard?.topRankings?.asOf || null
  const snapshotAgeHours = dashboard?.topRankings?.pipelineSignals?.latestRankingSnapshotAgeHours
  const snapshotAgeLabel = Number.isFinite(Number(snapshotAgeHours))
    ? `${Number(snapshotAgeHours).toFixed(1)}h`
    : '—'

  const statusHeadline = healthStatus === 'ok'
    ? 'Alpha Engine active'
    : healthStatus === 'unreachable'
      ? 'Alpha Engine unreachable'
      : 'Alpha Engine status unknown'

  const statusSubhead = totalAlerts > 0
    ? `${entries} entries / ${exits} exits • Confidence data ${confidenceCoverageNote} (${confidenceCoverage}) • Ranked names ${topRankings.length} • Snapshot age ${snapshotAgeLabel}`
    : `No current alerts • Ranked names ${topRankings.length} • Snapshot age ${snapshotAgeLabel}`

  const whyThisMatters = 'This is an engine status snapshot (freshness + output volume). It is not a “market” indicator.'

  return {
    healthStatus,
    asOf,
    statusHeadline,
    statusSubhead,
    whyThisMatters,
    metrics: {
      signalMix: totalAlerts > 0 ? `${entries} entries / ${exits} exits` : '—',
      confidenceCoverage,
      rankedCount: Array.isArray(topRankings) ? topRankings.length : 0
    },
    topRanked,
    topScoreMax,
    improving,
    cooling,
    admissionMeta: { admitted, removed, queued, admissionPeriod }
  }
}

export default function Landing() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [currentTime, setCurrentTime] = useState(new Date())
  const [selectedSignal, setSelectedSignal] = useState(null)

  const { pendingOrders, cancelOrder, isCanceling } = usePendingOrders({
    enabled: Boolean(user),
    pollIntervalMs: 10000
  })
  
  // Alpha Engine data
  const { dashboard, loading: dashboardLoading, error: dashboardError } = useAlphaDashboard()
  const { signals, loading: signalsLoading } = useAlphaSignals({ refreshInterval: 30000 })
  
  // Transform alpha-engine data for UI components
  const liveSignals = transformSignalsToLiveFormat(signals || [])
  const engineRankings = transformRankingsForTable(dashboard?.topRankings?.rankings || [])
  const featuredAssets = transformRankingsToFeaturedAssets(dashboard?.topRankings?.rankings || [])

  const pulse = useMemo(() => buildMarketPulse({ dashboard, signals }), [dashboard, signals])

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
        <article style={{ background: 'linear-gradient(140deg, #0b0b0c, #1b1c20)', color: '#fff', borderRadius: 24, padding: '1.2rem', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <div className="eyebrow" style={{ color: '#d9d9d9' }}>Alpha Engine Pulse</div>
              <div style={{ marginTop: '0.35rem', fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                {pulse.statusHeadline}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.2rem 0.55rem',
                borderRadius: 999,
                background: pulse.healthStatus === 'ok' ? 'rgba(110,255,182,0.12)' : pulse.healthStatus === 'unreachable' ? 'rgba(255,99,99,0.12)' : 'rgba(255,255,255,0.10)',
                border: pulse.healthStatus === 'ok' ? '1px solid rgba(110,255,182,0.25)' : pulse.healthStatus === 'unreachable' ? '1px solid rgba(255,99,99,0.25)' : '1px solid rgba(255,255,255,0.18)'
              }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: pulse.healthStatus === 'ok' ? '#6effb6' : pulse.healthStatus === 'unreachable' ? '#ff6363' : '#d9d9d9' }} />
                <span style={{ fontSize: 12, color: '#e9e9e9', fontWeight: 600 }}>
                  Engine: {pulse.healthStatus}
                </span>
              </div>
              <div style={{ marginTop: '0.45rem', fontSize: 12, color: '#cfcfcf' }}>
                Updated {formatTimeLabel(pulse.asOf)}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '0.6rem', color: '#d6d6d6', lineHeight: 1.35 }}>
            <div style={{ fontSize: 15 }}>{pulse.statusSubhead}</div>
            <div style={{ marginTop: '0.35rem', color: '#bdbdbd', fontSize: 12 }}>
              {pulse.whyThisMatters}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem', marginTop: '1rem' }}>
            <div style={{ padding: '0.75rem', borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
                <strong style={{ fontSize: 14 }}>Top ranked names</strong>
                <span style={{ fontSize: 12, color: '#bdbdbd' }}>Ordered by engine rank</span>
              </div>
              <div style={{ marginTop: '0.65rem', display: 'grid', gap: '0.45rem' }}>
                {dashboardLoading ? (
                  <div style={{ color: '#bdbdbd', fontSize: 13 }}>Loading…</div>
                ) : pulse.topRanked.length === 0 ? (
                  <div style={{ color: '#bdbdbd', fontSize: 13 }}>—</div>
                ) : (
                  pulse.topRanked.map((row) => {
                    const base = Number.isFinite(row.score) ? row.score : null
                    const denom = pulse.topScoreMax > 0 ? pulse.topScoreMax : null
                    const pct = base != null && denom != null ? Math.max(0, Math.min(1, base / denom)) : null

                    return (
                      <button
                        key={row.symbol}
                        className="ghost pressable"
                        onClick={() => navigate(`/assets/${row.symbol}`)}
                        style={{
                          textAlign: 'left',
                          padding: '0.5rem 0.6rem',
                          fontSize: 12,
                          color: '#fff',
                          borderColor: 'rgba(255,255,255,0.18)',
                          background: 'rgba(255,255,255,0.04)',
                          borderRadius: 12
                        }}
                        title="This is the engine’s current ranking (not a buy/sell instruction)."
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'baseline' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                            <span style={{ fontWeight: 900, letterSpacing: '0.02em' }}>{row.symbol}</span>
                            <span style={{ color: '#bdbdbd' }}>{`#${row.rank}`}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
                            <span style={{ color: '#cfcfcf' }}>{`score ${formatNumber(row.score, 3)}`}</span>
                            <span style={{ color: '#bdbdbd' }}>{`edge ${formatNumber(row.edgeScore, 2)}`}</span>
                          </div>
                        </div>
                        <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}>
                            <div style={{
                              width: pct == null ? '0%' : `${Math.round(pct * 100)}%`,
                              height: '100%',
                              background: 'rgba(110,255,182,0.65)'
                            }} />
                          </div>
                          {(row.price != null) && (
                            <span style={{ color: '#cfcfcf' }}>
                              ${row.price.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
              <div style={{ marginTop: '0.5rem', fontSize: 12, color: '#bdbdbd' }}>
                Why these: they are the top rows returned by the engine’s `/ranking/top` endpoint. This widget does not label them “buy” or “sell” because that instruction is not provided by alpha-engine here.
              </div>
            </div>

            <div style={{ padding: '0.75rem', borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
                <strong style={{ fontSize: 14 }}>Biggest rank moves</strong>
                <span style={{ fontSize: 12, color: '#bdbdbd' }}>Since prior snapshot</span>
              </div>
              <div style={{ marginTop: '0.65rem', display: 'grid', gap: '0.65rem' }}>
                {(dashboardLoading) ? (
                  <div style={{ color: '#bdbdbd', fontSize: 13 }}>Loading…</div>
                ) : (pulse.improving.length === 0 && pulse.cooling.length === 0) ? (
                  <div style={{ color: '#bdbdbd', fontSize: 13 }}>No meaningful rank movement yet.</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <div style={{ fontSize: 12, color: '#cfcfcf' }}>Up</div>
                      <div style={{ marginTop: '0.3rem', display: 'grid', gap: '0.25rem' }}>
                        {pulse.improving.length === 0 ? (
                          <div style={{ color: '#bdbdbd', fontSize: 12 }}>—</div>
                        ) : (
                          pulse.improving.map((m) => (
                            <div key={m.symbol} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                              <span style={{ fontWeight: 800 }}>{m.symbol}</span>
                              <span style={{ color: '#6effb6', fontWeight: 700 }}>{`+${m.change}`}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, color: '#cfcfcf' }}>Down</div>
                      <div style={{ marginTop: '0.3rem', display: 'grid', gap: '0.25rem' }}>
                        {pulse.cooling.length === 0 ? (
                          <div style={{ color: '#bdbdbd', fontSize: 12 }}>—</div>
                        ) : (
                          pulse.cooling.map((m) => (
                            <div key={m.symbol} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                              <span style={{ fontWeight: 800 }}>{m.symbol}</span>
                              <span style={{ color: '#ff6363', fontWeight: 700 }}>{`${m.change}`}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
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
          <div className='signal-box-4' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                  <div className='signal-box-1' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
          <div>
            <strong>Top Picks</strong>
            <div style={{ fontSize: '12px', color: '#7a7a7a', marginTop: '0.2rem' }}>Highest-conviction names right now</div>
          </div>
          <div style={{ maxHeight: '300px', overflowY: 'auto', marginTop: '0.8rem' }}>
            {dashboardLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                Loading...
              </div>
            ) : dashboardError ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#c0392b', fontSize: '13px' }}>
                Engine offline — picks unavailable
              </div>
            ) : engineRankings.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                No picks yet
              </div>
            ) : (
              engineRankings.map((item, index) => (
                <div key={`${item.symbol}-${index}`} style={{ borderBottom: '1px solid #eee', paddingBottom: '0.65rem', marginBottom: '0.65rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                      <strong style={{ fontSize: '14px' }}>{item.symbol}</strong>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: item.direction === 'Bullish' ? '#1f8a4c' : '#c0392b'
                      }}>
                        {item.direction === 'Bullish' ? '↑' : '↓'} {item.direction}
                      </span>
                    </div>
                    <span className="muted" style={{ fontSize: '11px' }}>
                      {(item.confidence * 100).toFixed(0)}% conviction
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#555', marginTop: '0.25rem', lineHeight: 1.4 }}>
                    {item.reason || 'Strong technical setup detected'}
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
                      <div className='signal-box-2' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
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
