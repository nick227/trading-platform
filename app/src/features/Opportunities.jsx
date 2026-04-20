import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import alphaEngineService from '../api/services/alphaEngineService.js'
import ConfidenceBadge, { RiskBadge, ConfidenceMeter } from '../components/ConfidenceBadge.jsx'

export default function Opportunities() {
  const navigate = useNavigate()
  const [recommendations, setRecommendations] = useState([])
  const [mode, setMode] = useState('balanced')
  const [preference, setPreference] = useState('long_only')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadRecommendations()
  }, [mode, preference])

  const loadRecommendations = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await alphaEngineService.getRecommendationsLatest(20, mode, preference)
      setRecommendations(data.recommendations || [])
    } catch (err) {
      console.error('Failed to load recommendations:', err)
      setError('Failed to load recommendations')
    } finally {
      setLoading(false)
    }
  }

  const handleTradeClick = (ticker) => {
    navigate(`/orders?ticker=${ticker}`)
  }

  const handleAssetClick = (ticker) => {
    navigate(`/assets/${ticker}`)
  }

  if (loading) {
    return (
      <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <div className="muted">Loading opportunities...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <div style={{ color: '#c0392b', marginBottom: '1rem' }}>{error}</div>
          <button className="primary pressable" onClick={loadRecommendations}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '32px', fontWeight: 800 }}>Opportunities</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '18px' }}>
          AI-powered investment opportunities based on market analysis
        </p>
      </header>

      {/* Controls */}
      <section style={{ marginBottom: '2rem' }}>
        <div style={{ 
          display: 'flex', 
          gap: '2rem', 
          alignItems: 'center', 
          padding: '1rem', 
          background: 'white', 
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
        }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '0.5rem', color: '#666' }}>
              Strategy Mode
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['conservative', 'balanced', 'aggressive'].map(m => (
                <button
                  key={m}
                  className={`pressable ${mode === m ? 'primary' : 'ghost'}`}
                  onClick={() => setMode(m)}
                  style={{ padding: '0.5rem 1rem', fontSize: '12px', textTransform: 'capitalize' }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '0.5rem', color: '#666' }}>
              Preference
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['long_only', 'absolute'].map(p => (
                <button
                  key={p}
                  className={`pressable ${preference === p ? 'primary' : 'ghost'}`}
                  onClick={() => setPreference(p)}
                  style={{ padding: '0.5rem 1rem', fontSize: '12px' }}
                >
                  {p === 'long_only' ? 'Long Only' : 'Absolute'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#666' }}>
            {recommendations.length} opportunities
          </div>
        </div>
      </section>

      {/* Recommendations Grid */}
      <section>
        {recommendations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', background: 'white', borderRadius: '12px' }}>
            <div className="muted">No opportunities available for current settings</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem' }}>
            {recommendations.map(rec => (
              <OpportunityCard 
                key={rec.ticker} 
                recommendation={rec}
                onTrade={() => handleTradeClick(rec.ticker)}
                onAsset={() => handleAssetClick(rec.ticker)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function OpportunityCard({ recommendation, onTrade, onAsset }) {
  const actionColors = {
    'BUY': { bg: '#e8f5e8', text: '#0a7a47', border: '#0a7a47' },
    'SELL': { bg: '#ffe6e6', text: '#c0392b', border: '#c0392b' },
    'HOLD': { bg: '#fff3cd', text: '#856404', border: '#856404' }
  }

  const colors = actionColors[recommendation.action] || actionColors['HOLD']
  
  return (
    <div style={{ 
      background: 'white', 
      borderRadius: '12px', 
      padding: '1.5rem', 
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      border: `2px solid ${colors.border}`,
      position: 'relative'
    }}>
      {/* Action Badge */}
      <div style={{
        position: 'absolute',
        top: '12px',
        right: '12px'
      }}>
        <ConfidenceBadge 
          action={recommendation.action} 
          confidence={recommendation.confidence}
          size="small"
        />
      </div>

      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '0.25rem' }}>
          {recommendation.ticker}
        </div>
        <div style={{ fontSize: '12px', color: '#666', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>Confidence: {Math.round(recommendation.confidence * 100)}%</span>
          <RiskBadge risk={recommendation.risk || 'Medium'} size="small" />
          <span>Horizon: {recommendation.horizon || '30d'}</span>
        </div>
      </div>

      {/* Thesis */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '14px', lineHeight: '1.4', color: '#333' }}>
          {recommendation.thesis || 'AI analysis suggests this opportunity'}
        </div>
      </div>

      {/* Entry Zone */}
      {recommendation.entryZone && (
        <div style={{ 
          background: '#f8f9fa', 
          padding: '8px 12px', 
          borderRadius: '6px', 
          marginBottom: '1rem',
          fontSize: '12px'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '2px' }}>Entry Zone</div>
          <div style={{ color: '#666' }}>{recommendation.entryZone}</div>
        </div>
      )}

      {/* Avoid If */}
      {recommendation.avoidIf && (
        <div style={{ 
          background: '#fff5f5', 
          padding: '8px 12px', 
          borderRadius: '6px', 
          marginBottom: '1rem',
          fontSize: '12px'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '2px', color: '#c0392b' }}>Avoid If</div>
          <div style={{ color: '#666' }}>{recommendation.avoidIf}</div>
        </div>
      )}

      {/* Confidence Meter */}
      <div style={{ marginBottom: '1rem' }}>
        <ConfidenceMeter confidence={recommendation.confidence} size="small" />
      </div>

      {/* Score */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '1rem',
        fontSize: '12px'
      }}>
        <div>
          <span style={{ color: '#666' }}>Score: </span>
          <span style={{ fontWeight: 600 }}>{recommendation.score?.toFixed(2) || 'N/A'}</span>
        </div>
        <div>
          <span style={{ color: '#666' }}>Mode: </span>
          <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>
            {recommendation.mode || 'balanced'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button 
          className="primary pressable" 
          onClick={onTrade}
          style={{ flex: 1, padding: '0.75rem', fontSize: '14px', fontWeight: 600 }}
        >
          {recommendation.action === 'BUY' ? 'Trade' : 'View'}
        </button>
        <button 
          className="ghost pressable" 
          onClick={onAsset}
          style={{ padding: '0.75rem 1rem', fontSize: '14px', fontWeight: 600 }}
        >
          Details
        </button>
      </div>

      {/* Timestamp */}
      <div style={{ 
        marginTop: '1rem', 
        fontSize: '10px', 
        color: '#999', 
        textAlign: 'center' 
      }}>
        {recommendation.asOf ? new Date(recommendation.asOf).toLocaleDateString() : 'Recent'}
      </div>
    </div>
  )
}
