import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import alphaEngineService from '../api/services/alphaEngineService.js'
import ConfidenceBadge, { RiskBadge, ConfidenceMeter } from '../components/ConfidenceBadge.jsx'

export default function Home() {
  const navigate = useNavigate()
  const [housePick, setHousePick] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadHousePick()
  }, [])

  const loadHousePick = async () => {
    try {
      setLoading(true)
      const recommendation = await alphaEngineService.getBestRecommendation('balanced', 'long_only')
      setHousePick(recommendation)
    } catch (err) {
      console.error('Failed to load house pick:', err)
      setError('Recommendations temporarily unavailable')
    } finally {
      setLoading(false)
    }
  }

  const handleActionClick = () => {
    if (housePick?.ticker) {
      navigate(`/orders?ticker=${encodeURIComponent(housePick.ticker)}`)
    } else {
      navigate('/orders?ticker=NVDA') // fallback
    }
  }

  if (loading) {
    return (
      <div className="center">
        <div className="muted">Loading recommendation...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="center">
        <span className="eyebrow">Quiet control</span>
        <h1 className="hero">Control your money</h1>
        <p className="subhero">
          Start from one calm action. Big type. Big buttons. No visual scrambling.
        </p>

        <div className="actions">
          <button
            className="primary pressable"
            onClick={() => navigate('/orders?ticker=NVDA')}
          >
            Explore Markets
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="center">
      <span className="eyebrow">House Pick</span>
      <h1 className="hero">{housePick?.ticker || 'NVDA'}</h1>
      
      {housePick && (
        <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <div style={{ marginBottom: '1rem' }}>
            <ConfidenceBadge 
              action={housePick.action} 
              confidence={housePick.confidence}
              size="large"
              style={{ fontSize: '18px', padding: '8px 16px' }}
            />
          </div>
          <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.4', marginBottom: '1rem' }}>
            {housePick.thesis || 'AI-powered recommendation'}
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <RiskBadge risk={housePick.risk || 'Medium'} />
            {housePick.entryZone && (
              <div style={{ 
                fontSize: '12px', 
                color: '#666', 
                background: '#f8f9fa',
                padding: '6px 12px',
                borderRadius: '6px',
                display: 'inline-block'
              }}>
                Entry: {housePick.entryZone}
              </div>
            )}
          </div>

          <ConfidenceMeter confidence={housePick.confidence} size="medium" style={{ maxWidth: '300px', margin: '0 auto' }} />
        </div>
      )}

      <p className="subhero">
        {housePick?.thesis || 'Start from one calm action. Big type. Big buttons. No visual scrambling.'}
      </p>

      <div className="actions">
        <button
          className="primary pressable"
          onClick={handleActionClick}
        >
          {housePick?.action === 'BUY' ? 'View Trade' : 'View Details'}
        </button>
      </div>

      {housePick && (
        <div style={{ 
          marginTop: '2rem', 
          fontSize: '11px', 
          color: '#999',
          textAlign: 'center'
        }}>
          Risk: {housePick.risk || 'Medium'} · Horizon: {housePick.horizon || '30d'} · 
          Mode: {housePick.mode || 'balanced'}
        </div>
      )}
    </div>
  )
}
