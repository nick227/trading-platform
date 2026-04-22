import { useState, useEffect } from 'react'
import alphaEngineService from '../api/services/alphaEngineService.js'

// Widget Components (will be expanded)
const WidgetCard = ({ title, grade, children, gradeColor = '#666' }) => (
  <div style={{
    background: 'white',
    borderRadius: '12px',
    padding: '1.5rem',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    border: `2px solid ${gradeColor}`,
    position: 'relative'
  }}>
    <div style={{
      position: 'absolute',
      top: '8px',
      right: '8px',
      background: gradeColor,
      color: 'white',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '11px',
      fontWeight: 700
    }}>
      {grade}
    </div>
    <h3 style={{ margin: '0 0 1rem 0', fontSize: '16px', fontWeight: 700 }}>{title}</h3>
    {children}
  </div>
)

const GradeLegend = () => (
  <div style={{ 
    display: 'flex', 
    gap: '2rem', 
    marginBottom: '2rem', 
    padding: '1rem', 
    background: '#f8f9fa', 
    borderRadius: '8px',
    fontSize: '14px'
  }}>
    <div><strong>A:</strong> Must ship - Premium, trustworthy, useful, exciting</div>
    <div><strong>B:</strong> Nice later - Good but not essential</div>
    <div><strong>C:</strong> Remove - Clutter, confusing, low value</div>
  </div>
)

export default function AlphaShowcase() {
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [grades, setGrades] = useState({})

  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    try {
      setLoading(true)
      
      // Load everything alpha-engine can provide
      const [
        health,
        topRankings,
        movers,
        admission,
        recommendationsLatest,
        recommendationsBest,
        dashboardData,
        activeSignals
      ] = await Promise.allSettled([
        alphaEngineService.checkHealth(),
        alphaEngineService.getTopRankings(20),
        alphaEngineService.getRankingMovers(20),
        alphaEngineService.getAdmissionChanges(24),
        alphaEngineService.getRecommendationsLatest(10, 'balanced'),
        alphaEngineService.getBestRecommendation('balanced'),
        alphaEngineService.getDashboardData(),
        alphaEngineService.getActiveSignals()
      ])

      setData({
        health: health.status === 'fulfilled' ? health.value : null,
        topRankings: topRankings.status === 'fulfilled' ? topRankings.value : null,
        movers: movers.status === 'fulfilled' ? movers.value : null,
        admission: admission.status === 'fulfilled' ? admission.value : null,
        recommendationsLatest: recommendationsLatest.status === 'fulfilled' ? recommendationsLatest.value : null,
        recommendationsBest: recommendationsBest.status === 'fulfilled' ? recommendationsBest.value : null,
        dashboardData: dashboardData.status === 'fulfilled' ? dashboardData.value : null,
        activeSignals: activeSignals.status === 'fulfilled' ? activeSignals.value : null
      })

      // Default grades - these will be updated based on user feedback
      setGrades({
        // Homepage widgets
        'house-pick': 'A',
        'top-10-picks': 'A',
        'movers': 'A',
        'regime-meter': 'B',
        'risk-sentiment': 'B',
        'sector-leaders': 'C',
        'recent-admissions': 'B',
        'strategy-champions': 'C',
        'market-breadth': 'B',
        
        // Portfolio widgets
        'ai-verdict': 'A',
        'trim-add-suggestions': 'A',
        'concentration-warnings': 'B',
        'diversification-score': 'B',
        'conviction-score': 'C',
        'missed-opportunities': 'C',
        'replacement-ideas': 'B',
        
        // Orders widgets
        'verdict-card': 'A',
        'confidence-meter': 'A',
        'entry-zone': 'A',
        'avoid-triggers': 'B',
        'alternative-picks': 'B',
        'chart-overlays': 'C',
        'candle-mode': 'C',
        'historical-analogs': 'C'
      })

    } catch (error) {
      console.error('Failed to load showcase data:', error)
    } finally {
      setLoading(false)
    }
  }

  const updateGrade = (widgetId, newGrade) => {
    setGrades(prev => ({ ...prev, [widgetId]: newGrade }))
  }

  const getGradeColor = (grade) => {
    switch(grade) {
      case 'A': return '#0a7a47'
      case 'B': return '#f39c12'
      case 'C': return '#c0392b'
      default: return '#666'
    }
  }

  if (loading) {
    return (
      <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <div className="muted">Loading Alpha Engine Showcase...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page container" style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '32px', fontWeight: 800 }}>Alpha Engine Showcase</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '18px' }}>
          Every possible widget powered by Alpha Engine APIs. Grade each to decide what ships.
        </p>
      </header>

      <GradeLegend />

      {/* Homepage Widgets */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ margin: '0 0 1.5rem 0', fontSize: '24px', fontWeight: 700 }}>Homepage Widgets</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          
          {/* House Pick */}
          <WidgetCard title="House Pick" grade={grades['house-pick']} gradeColor={getGradeColor(grades['house-pick'])}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 700 }}>NVDA</div>
                <div style={{ color: '#0a7a47', fontSize: '14px' }}>Strong Buy</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '16px', fontWeight: 600 }}>$485.23</div>
                <div style={{ color: '#0a7a47', fontSize: '12px' }}>+2.4%</div>
              </div>
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '0.5rem' }}>
              AI compute demand surge with data center capex accelerating
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', fontSize: '11px' }}>
              <span style={{ background: '#e8f5e8', padding: '2px 6px', borderRadius: '4px' }}>85% confidence</span>
              <span style={{ background: '#f0f9f4', padding: '2px 6px', borderRadius: '4px' }}>2.1:1 risk/reward</span>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['house-pick'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('house-pick', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['house-pick'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['house-pick'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

          {/* Top 10 Picks */}
          <WidgetCard title="Top 10 Picks" grade={grades['top-10-picks']} gradeColor={getGradeColor(grades['top-10-picks'])}>
            <div style={{ fontSize: '12px', marginBottom: '1rem' }}>
              {data.topRankings?.rankings?.slice(0, 5).map((stock, i) => (
                <div key={stock.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span>{i + 1}. {stock.symbol}</span>
                  <span style={{ color: stock.confidence > 0.8 ? '#0a7a47' : stock.confidence > 0.6 ? '#f39c12' : '#666' }}>
                    {Math.round(stock.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['top-10-picks'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('top-10-picks', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['top-10-picks'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['top-10-picks'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

          {/* Movers */}
          <WidgetCard title="Market Movers" grade={grades['movers']} gradeColor={getGradeColor(grades['movers'])}>
            <div style={{ fontSize: '12px', marginBottom: '1rem' }}>
              {data.movers?.rankings?.slice(0, 5).map((stock, _i) => (
                <div key={stock.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span>{stock.symbol}</span>
                  <span style={{ color: stock.rank > 0 ? '#0a7a47' : '#c0392b' }}>
                    {stock.rank > 0 ? '+' : ''}{stock.rank}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['movers'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('movers', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['movers'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['movers'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

          {/* Regime Meter */}
          <WidgetCard title="Regime Meter" grade={grades['regime-meter']} gradeColor={getGradeColor(grades['regime-meter'])}>
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#f39c12' }}>BULLISH</div>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '0.5rem' }}>Market regime detected</div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['regime-meter'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('regime-meter', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['regime-meter'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['regime-meter'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

          {/* Risk Sentiment */}
          <WidgetCard title="Risk Sentiment" grade={grades['risk-sentiment']} gradeColor={getGradeColor(grades['risk-sentiment'])}>
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#0a7a47' }}>LOW</div>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '0.5rem' }}>Market risk sentiment</div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['risk-sentiment'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('risk-sentiment', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['risk-sentiment'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['risk-sentiment'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

          {/* Recent Admissions */}
          <WidgetCard title="Recent Admissions" grade={grades['recent-admissions']} gradeColor={getGradeColor(grades['recent-admissions'])}>
            <div style={{ fontSize: '12px', marginBottom: '1rem' }}>
              {data.admission?.changes?.slice(0, 3).map((change, _i) => (
                <div key={change.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span>{change.symbol}</span>
                  <span style={{ 
                    color: change.action === 'admitted' ? '#0a7a47' : 
                           change.action === 'removed' ? '#c0392b' : '#f39c12'
                  }}>
                    {change.action}
                  </span>
                </div>
              )) || <div style={{ color: '#666' }}>No recent changes</div>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['recent-admissions'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('recent-admissions', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['recent-admissions'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['recent-admissions'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

        </div>
      </section>

      {/* Portfolio Widgets */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ margin: '0 0 1.5rem 0', fontSize: '24px', fontWeight: 700 }}>Portfolio Widgets</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          
          {/* AI Verdict per Holding */}
          <WidgetCard title="AI Verdict per Holding" grade={grades['ai-verdict']} gradeColor={getGradeColor(grades['ai-verdict'])}>
            <div style={{ fontSize: '12px', marginBottom: '1rem' }}>
              <div style={{ padding: '8px', background: '#f8f9fa', borderRadius: '4px', marginBottom: '8px' }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>NVDA - HOLD</div>
                <div style={{ color: '#666', fontSize: '11px' }}>Strong fundamentals but consider trimming</div>
              </div>
              <div style={{ padding: '8px', background: '#f8f9fa', borderRadius: '4px', marginBottom: '8px' }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>AAPL - BUY</div>
                <div style={{ color: '#666', fontSize: '11px' }}>Undervalued, good entry point</div>
              </div>
              <div style={{ padding: '8px', background: '#f8f9fa', borderRadius: '4px' }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>TSLA - SELL</div>
                <div style={{ color: '#666', fontSize: '11px' }}>Volatility too high for current risk</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['ai-verdict'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('ai-verdict', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['ai-verdict'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['ai-verdict'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

          {/* Trim/Add Suggestions */}
          <WidgetCard title="Trim/Add Suggestions" grade={grades['trim-add-suggestions']} gradeColor={getGradeColor(grades['trim-add-suggestions'])}>
            <div style={{ fontSize: '12px', marginBottom: '1rem' }}>
              <div style={{ padding: '8px', background: '#ffe6e6', borderRadius: '4px', marginBottom: '8px' }}>
                <div style={{ fontWeight: 600, color: '#c0392b', marginBottom: '4px' }}>TRIM: TSLA (-25%)</div>
                <div style={{ color: '#666', fontSize: '11px' }}>Reduce exposure, high volatility</div>
              </div>
              <div style={{ padding: '8px', background: '#e6f7e6', borderRadius: '4px', marginBottom: '8px' }}>
                <div style={{ fontWeight: 600, color: '#0a7a47', marginBottom: '4px' }}>ADD: MSFT (+15%)</div>
                <div style={{ color: '#666', fontSize: '11px' }}>Strong cloud growth, AI tailwinds</div>
              </div>
              <div style={{ padding: '8px', background: '#e6f7e6', borderRadius: '4px' }}>
                <div style={{ fontWeight: 600, color: '#0a7a47', marginBottom: '4px' }}>ADD: GOOGL (+10%)</div>
                <div style={{ color: '#666', fontSize: '11px' }}>Undervalued, search dominance</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['trim-add-suggestions'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('trim-add-suggestions', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['trim-add-suggestions'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['trim-add-suggestions'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

          {/* Diversification Score */}
          <WidgetCard title="Diversification Score" grade={grades['diversification-score']} gradeColor={getGradeColor(grades['diversification-score'])}>
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <div style={{ fontSize: '32px', fontWeight: 700, color: '#f39c12' }}>7.2/10</div>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '0.5rem' }}>Good diversification</div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '1rem' }}>
                Tech heavy (65%) - Consider adding healthcare/energy
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['diversification-score'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('diversification-score', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['diversification-score'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['diversification-score'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

        </div>
      </section>

      {/* Orders Widgets */}
      <section style={{ marginBottom: '3rem' }}>
        <h2 style={{ margin: '0 0 1.5rem 0', fontSize: '24px', fontWeight: 700 }}>Orders Widgets</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          
          {/* Verdict Card */}
          <WidgetCard title="Verdict Card" grade={grades['verdict-card']} gradeColor={getGradeColor(grades['verdict-card'])}>
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#0a7a47', marginBottom: '0.5rem' }}>BUY</div>
              <div style={{ fontSize: '14px', color: '#666', marginBottom: '1rem' }}>NVDA</div>
              <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: '12px' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>85%</div>
                  <div style={{ color: '#666' }}>Confidence</div>
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>2.1:1</div>
                  <div style={{ color: '#666' }}>Risk/Reward</div>
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>7d</div>
                  <div style={{ color: '#666' }}>Timeframe</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['verdict-card'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('verdict-card', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['verdict-card'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['verdict-card'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

          {/* Confidence Meter */}
          <WidgetCard title="Confidence Meter" grade={grades['confidence-meter']} gradeColor={getGradeColor(grades['confidence-meter'])}>
            <div style={{ padding: '1rem 0' }}>
              <div style={{ background: '#e0e0e0', height: '8px', borderRadius: '4px', marginBottom: '0.5rem' }}>
                <div style={{ 
                  background: '#0a7a47', 
                  height: '100%', 
                  width: '85%', 
                  borderRadius: '4px',
                  position: 'relative'
                }}>
                  <div style={{
                    position: 'absolute',
                    right: '4px',
                    top: '-8px',
                    background: '#0a7a47',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontWeight: 600
                  }}>
                    85%
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'center', fontSize: '12px', color: '#666' }}>
                Very High Confidence
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['confidence-meter'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('confidence-meter', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['confidence-meter'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['confidence-meter'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

          {/* Entry Zone */}
          <WidgetCard title="Entry Zone" grade={grades['entry-zone']} gradeColor={getGradeColor(grades['entry-zone'])}>
            <div style={{ fontSize: '12px', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span>Current:</span>
                <span style={{ fontWeight: 600 }}>$485.23</span>
              </div>
              <div style={{ 
                background: '#e6f7e6', 
                padding: '8px', 
                borderRadius: '4px', 
                textAlign: 'center',
                border: '2px solid #0a7a47'
              }}>
                <div style={{ fontWeight: 600, color: '#0a7a47' }}>Ideal Entry: $475-485</div>
                <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>Buy zone active</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                <span>Stop:</span>
                <span style={{ color: '#c0392b', fontWeight: 600 }}>$458.90</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Target:</span>
                <span style={{ color: '#0a7a47', fontWeight: 600 }}>$545.20</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['A', 'B', 'C'].map(g => (
                <button
                  key={g}
                  className={`ghost pressable ${grades['entry-zone'] === g ? 'selected' : ''}`}
                  onClick={() => updateGrade('entry-zone', g)}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    background: grades['entry-zone'] === g ? getGradeColor(g) : 'transparent',
                    color: grades['entry-zone'] === g ? 'white' : getGradeColor(g),
                    border: `1px solid ${getGradeColor(g)}`
                  }}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </WidgetCard>

        </div>
      </section>

      {/* Summary Section */}
      <section style={{ background: '#f8f9fa', padding: '2rem', borderRadius: '12px', marginTop: '2rem' }}>
        <h2 style={{ margin: '0 0 1rem 0', fontSize: '20px', fontWeight: 700 }}>Grading Summary</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', fontSize: '14px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#0a7a47' }}>
              {Object.values(grades).filter(g => g === 'A').length}
            </div>
            <div style={{ color: '#666' }}>Must Ship (A)</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#f39c12' }}>
              {Object.values(grades).filter(g => g === 'B').length}
            </div>
            <div style={{ color: '#666' }}>Nice Later (B)</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#c0392b' }}>
              {Object.values(grades).filter(g => g === 'C').length}
            </div>
            <div style={{ color: '#666' }}>Remove (C)</div>
          </div>
        </div>
        
        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'white', borderRadius: '8px' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>A-Grade Widgets (Must Ship):</div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            {Object.entries(grades)
              .filter(([_, grade]) => grade === 'A')
              .map(([widget, _]) => widget.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()))
              .join(', ')}
          </div>
        </div>
      </section>

    </div>
  )
}
