import React from 'react'
import { useAlphaDashboard, useAlphaSignals } from '../hooks/useAlphaEngine.js'

function SignalCard({ signal }) {
  return (
    <div style={{
      background: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '12px',
      marginBottom: '8px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: signal.type === 'ENTRY' ? '#1f8a4c' : '#c0392b'
          }} />
          <strong style={{ fontSize: '14px' }}>{signal.symbol}</strong>
        </div>
        <span style={{
          background: signal.type === 'ENTRY' ? '#f0fdf4' : '#fef2f2',
          color: signal.type === 'ENTRY' ? '#1f8a4c' : '#c0392b',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: 600
        }}>
          {signal.type}
        </span>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
        <div>
          <span style={{ color: '#666' }}>Confidence:</span>
          <strong style={{ marginLeft: '4px' }}>{(signal.confidence * 100).toFixed(0)}%</strong>
        </div>
        <div>
          <span style={{ color: '#666' }}>Score:</span>
          <strong style={{ marginLeft: '4px' }}>{signal.score?.toFixed(2) || 'N/A'}</strong>
        </div>
      </div>
      
      {signal.reasons && signal.reasons.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '11px', color: '#666' }}>
          <div style={{ fontWeight: 600, marginBottom: '2px' }}>Why:</div>
          <div>{signal.reasons.slice(0, 2).join(', ')}</div>
        </div>
      )}
    </div>
  )
}

function RankingTable({ rankings, title }) {
  return (
    <div style={{ background: 'white', borderRadius: '8px', padding: '16px', border: '1px solid #e5e7eb' }}>
      <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600 }}>{title}</h4>
      
      {rankings.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#666', padding: '20px', fontSize: '12px' }}>
          No rankings available
        </div>
      ) : (
        <div style={{ fontSize: '12px' }}>
          {rankings.slice(0, 8).map((ranking, index) => (
            <div key={ranking.symbol || index} style={{
              display: 'grid',
              gridTemplateColumns: '24px 60px 1fr 60px 60px',
              gap: '8px',
              padding: '6px 0',
              borderBottom: index < rankings.length - 1 ? '1px solid #f3f4f6' : 'none',
              alignItems: 'center'
            }}>
              <div style={{ textAlign: 'center', fontWeight: 600, color: '#666' }}>
                {ranking.rank || index + 1}
              </div>
              <div style={{ fontWeight: 600 }}>
                {ranking.symbol}
              </div>
              <div style={{ color: '#666', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {ranking.reasons?.slice(0, 2).join(', ') || 'No reasons available'}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{(ranking.confidence * 100).toFixed(0)}%</div>
                <div style={{ fontSize: '10px', color: '#666' }}>conf</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{ranking.score?.toFixed(2) || 'N/A'}</div>
                <div style={{ fontSize: '10px', color: '#666' }}>score</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HealthIndicator({ health }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'ok': return '#1f8a4c'
      case 'degraded': return '#f59e0b'
      case 'error': case 'unreachable': return '#c0392b'
      default: return '#666'
    }
  }

  const getStatusText = (status) => {
    switch (status) {
      case 'ok': return 'Healthy'
      case 'degraded': return 'Degraded'
      case 'error': return 'Error'
      case 'unreachable': return 'Unreachable'
      default: return 'Unknown'
    }
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      background: 'white',
      borderRadius: '6px',
      border: '1px solid #e5e7eb',
      fontSize: '12px'
    }}>
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: getStatusColor(health.status)
      }} />
      <span style={{ fontWeight: 600 }}>Alpha Engine:</span>
      <span style={{ color: getStatusColor(health.status) }}>
        {getStatusText(health.status)}
      </span>
    </div>
  )
}

export default function AlphaDashboard() {
  const { dashboard, loading: dashboardLoading, error: dashboardError } = useAlphaDashboard()
  const { signals, loading: signalsLoading } = useAlphaSignals({ refreshInterval: 30000 })

  if (dashboardError) {
    return (
      <div style={{
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: '8px',
        padding: '16px',
        color: '#dc2626'
      }}>
        <div style={{ fontWeight: 600, marginBottom: '4px' }}>Alpha Engine Error</div>
        <div style={{ fontSize: '14px' }}>{dashboardError}</div>
      </div>
    )
  }

  if (dashboardLoading || !dashboard) {
    return (
      <div style={{
        background: 'white',
        borderRadius: '8px',
        padding: '40px',
        textAlign: 'center',
        color: '#666',
        border: '1px solid #e5e7eb'
      }}>
        Loading Alpha Engine data...
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      {/* Header with Health Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Alpha Engine Dashboard</h3>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
            Last updated: {new Date(dashboard.lastUpdated).toLocaleTimeString()}
          </div>
        </div>
        <HealthIndicator health={dashboard.health} />
      </div>

      {/* Active Signals */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
        <div>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600 }}>
            Active Signals ({signals.length})
          </h4>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {signals.length === 0 ? (
              <div style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '20px',
                textAlign: 'center',
                color: '#666',
                fontSize: '12px'
              }}>
                No active signals
              </div>
            ) : (
              signals.slice(0, 5).map((signal, index) => (
                <SignalCard key={index} signal={signal} />
              ))
            )}
          </div>
        </div>

        {/* Rankings */}
        <div style={{ display: 'grid', gap: '16px' }}>
          <RankingTable 
            rankings={dashboard.topRankings?.rankings || []} 
            title="Top Rankings" 
          />
          <RankingTable 
            rankings={dashboard.movers?.rankings || []} 
            title="Biggest Movers" 
          />
        </div>
      </div>

      {/* Admission Activity */}
      {dashboard.admission && (
        <div style={{ background: 'white', borderRadius: '8px', padding: '16px', border: '1px solid #e5e7eb' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600 }}>
            Admission Activity ({dashboard.admission.period})
          </h4>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px' }}>
            <div style={{ textAlign: 'center', padding: '8px', background: '#f0fdf4', borderRadius: '4px' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#1f8a4c' }}>
                {dashboard.admission.summary.admitted}
              </div>
              <div style={{ fontSize: '11px', color: '#666' }}>Admitted</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#fef2f2', borderRadius: '4px' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#c0392b' }}>
                {dashboard.admission.summary.removed}
              </div>
              <div style={{ fontSize: '11px', color: '#666' }}>Removed</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: '#f0f9ff', borderRadius: '4px' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: '#1e40af' }}>
                {dashboard.admission.summary.queued}
              </div>
              <div style={{ fontSize: '11px', color: '#666' }}>Queued</div>
            </div>
          </div>

          {dashboard.admission.changes.length > 0 && (
            <div style={{ fontSize: '12px' }}>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>Recent Changes:</div>
              {dashboard.admission.changes.slice(0, 5).map((change, index) => (
                <div key={index} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '4px 0',
                  borderBottom: index < 4 ? '1px solid #f3f4f6' : 'none'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      padding: '2px 6px',
                      borderRadius: '3px',
                      fontSize: '10px',
                      fontWeight: 600,
                      background: change.action === 'admitted' ? '#f0fdf4' : 
                                 change.action === 'removed' ? '#fef2f2' : '#f0f9ff',
                      color: change.action === 'admitted' ? '#1f8a4c' : 
                             change.action === 'removed' ? '#c0392b' : '#1e40af'
                    }}>
                      {change.action.toUpperCase()}
                    </span>
                    <strong>{change.symbol}</strong>
                  </div>
                  <div style={{ color: '#666' }}>
                    {new Date(change.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
