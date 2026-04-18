import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useApp } from '../app/AppProvider'
import { getBotCatalog } from '../api/services/botCatalogService.js'

export default function Bots() {
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const [catalog, setCatalog] = useState({ ruleBased: [], strategyBased: [] })
  const [loading, setLoading] = useState(true)
  const [successMessage, setSuccessMessage] = useState(null)
  
  const runningCount = state.bots.filter((bot) => bot.status === 'running').length

  // Load catalog on mount
  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const data = await getBotCatalog()
        setCatalog(data)
      } catch (error) {
        console.error('Failed to load bot catalog:', error)
      } finally {
        setLoading(false)
      }
    }
    loadCatalog()
  }, [])

  // Check for success message from navigation
  useEffect(() => {
    if (window.history.state?.success) {
      setSuccessMessage(`Bot "${window.history.state.botName}" created successfully!`)
      // Clear the state after showing message
      setTimeout(() => setSuccessMessage(null), 5000)
    }
  }, [])

  // Unified catalog items
  const catalogItems = [
    ...catalog.ruleBased.map(item => ({ ...item, type: 'RULE_BASED' })),
    ...catalog.strategyBased.map(item => ({ ...item, type: 'STRATEGY_BASED' }))
  ]

  return (
    <div className="page container" style={{ maxWidth: 1040, margin: '0 auto', padding: '2rem 1rem 3rem' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 className="hero" style={{ marginBottom: '0.5rem' }}>Bots</h1>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ color: '#0a7a47', fontWeight: 700 }}>{runningCount} running</div>
          <div className="muted">{state.bots.length - runningCount} paused</div>
          <div className="muted">Execution health normal</div>
        </div>
      </header>

      <section style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1.4fr 1fr', marginBottom: '1rem' }}>
        <article style={{ background: 'white', borderRadius: 24, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
          <strong>Active Bot Queue</strong>
          <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.7rem' }}>
            {state.bots.map((bot) => (
              <div key={bot.id} style={{ borderBottom: '1px solid #eee', paddingBottom: '0.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <div>
                    <strong>{bot.name}</strong>
                    <div className="muted">Asset: {bot.asset}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: bot.status === 'running' ? '#0a7a47' : '#aa7a00', fontWeight: 600 }}>{bot.status}</div>
                    <button
                      className="primary pressable"
                      onClick={() => {
                        dispatch({ type: 'SELECT_BOT', payload: bot.id })
                        navigate('/bots/confirm')
                      }}
                    >
                      Review
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article style={{ background: 'linear-gradient(140deg, #111, #2a2a2a)', color: '#fff', borderRadius: 24, padding: '1rem' }}>
          <div className="eyebrow" style={{ color: '#d9d9d9' }}>Bot Performance</div>
          <div style={{ fontSize: '1.7rem', fontWeight: 700 }}>+6.8% this month</div>
          <div style={{ marginTop: '0.45rem', opacity: 0.88 }}>Win rate: 64%</div>
          <div style={{ opacity: 0.88 }}>Avg hold: 1.8 sessions</div>
          <div style={{ marginTop: '0.7rem', color: '#6effb6', fontWeight: 700 }}>Best actor: Momentum Swing</div>
        </article>
      </section>

      {successMessage && (
        <article style={{ 
          background: '#f0f9f4', 
          border: '1px solid #c6f6d5', 
          borderRadius: 8, 
          padding: '1rem', 
          marginBottom: '1.5rem',
          color: '#0a7a47'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Success!</div>
          <div style={{ fontSize: '14px' }}>{successMessage}</div>
        </article>
      )}

      <section style={{ background: 'white', borderRadius: 22, padding: '1rem', boxShadow: '0 8px 26px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <strong>Available Templates & Strategies</strong>
          <button 
            className="primary pressable"
            onClick={() => navigate('/bots/create')}
            style={{ fontSize: '14px', padding: '0.5rem 1rem' }}
          >
            Create New Bot
          </button>
        </div>
        
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
            Loading catalog...
          </div>
        ) : catalogItems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
            No templates or strategies available
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.55rem' }}>
            {catalogItems.map((item) => (
              <div 
                key={item.id} 
                style={{ 
                  display: 'grid', 
                  gridTemplateColumns: '1fr auto auto', 
                  borderBottom: '1px solid #eee', 
                  paddingBottom: '0.45rem',
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {item.name}
                    <span style={{
                      background: item.type === 'RULE_BASED' ? '#f0fdf4' : '#eff6ff',
                      color: item.type === 'RULE_BASED' ? '#0a7a47' : '#1e40af',
                      padding: '0.125rem 0.375rem',
                      borderRadius: 4,
                      fontSize: '11px',
                      fontWeight: 600
                    }}>
                      {item.type === 'RULE_BASED' ? 'Rules' : 'Strategy'}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: '13px' }}>
                    {item.category === 'alpha_engine' ? 'Alpha Engine' : item.category}
                    {item.metadata?.cadence && ` · ${item.metadata.cadence}`}
                  </div>
                </div>
                {item.metadata?.edge && (
                  <div style={{ color: '#0a7a47', fontWeight: 700, fontSize: '14px' }}>
                    {item.metadata.edge}
                  </div>
                )}
                <button
                  className="ghost pressable"
                  onClick={() => navigate('/bots/create', { 
                    state: { 
                      defaultTemplate: item,
                      defaultConfig: { tickers: ['SPY'] }
                    } 
                  })}
                  style={{ fontSize: '13px', padding: '0.25rem 0.5rem' }}
                >
                  Use
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
