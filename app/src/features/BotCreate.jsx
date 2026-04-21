import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getBotCatalog, createBotFromTemplate, createStrategyBot } from '../api/services/botCatalogService.js'
import BotTemplateSelector from '../components/BotTemplateSelector.jsx'

export default function BotCreate() {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState({ ruleBased: [], strategyBased: [] })
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [selectedType, setSelectedType] = useState('rule-based')
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [botName, setBotName] = useState('')
  const [botConfig, setBotConfig] = useState({
    tickers: [],
    quantity: 10,
    direction: 'buy',
    minConfidence: 0.7
  })
  const [minConfidenceInput, setMinConfidenceInput] = useState("0.7")
  const [quantityInput, setQuantityInput] = useState("10")
  const [error, setError] = useState(null)

  // Load catalog on mount
  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const data = await getBotCatalog()
        setCatalog(data)
      } catch (err) {
        setError('Failed to load bot catalog')
      } finally {
        setLoading(false)
      }
    }
    loadCatalog()
  }, [])

  // Get initial config from URL state or location
  useEffect(() => {
    const state = window.history.state
    if (state?.defaultConfig) {
      setBotConfig(prev => ({
        ...prev,
        ...state.defaultConfig
      }))
    }
  }, [])

  const handleTemplateSelect = (template) => {
    setSelectedTemplate(template)
    setBotName(`${template.name} - ${new Date().toLocaleDateString()}`)
    
    // Use template default config
    if (template.config?.defaultBotConfig) {
      setBotConfig(prev => ({
        ...prev,
        ...template.config.defaultBotConfig,
        // Preserve any tickers from URL state
        tickers: window.history.state?.defaultConfig?.tickers || template.config.defaultBotConfig.tickers
      }))
    }
  }

  const handleStrategySelect = (strategy) => {
    setSelectedTemplate(strategy)
    setBotName(`${strategy.name} - ${new Date().toLocaleDateString()}`)
    
    // Default strategy config with confidence threshold
    setBotConfig(prev => ({
      ...prev,
      tickers: window.history.state?.defaultConfig?.tickers || ['SPY'],
      quantity: 10,
      direction: 'buy',
      minConfidence: 0.7
    }))
  }

  const handleQuantityChange = (e) => {
  const raw = e.target.value
  setQuantityInput(raw)

  const val = parseInt(raw, 10)
  if (Number.isFinite(val)) {
    setBotConfig(prev => ({
      ...prev,
      quantity: Math.max(1, val)
    }))
  }
}

const handleQuantityBlur = () => {
  setQuantityInput(botConfig.quantity.toString())
}

const handleConfidenceChange = (e) => {
  const raw = e.target.value
  setMinConfidenceInput(raw)

  const val = parseFloat(raw)
  if (Number.isFinite(val)) {
    setBotConfig(prev => ({
      ...prev,
      minConfidence: Math.min(1, Math.max(0, val))
    }))
  }
}

const handleConfidenceBlur = () => {
  setMinConfidenceInput(botConfig.minConfidence.toString())
}

const handleCreateBot = async () => {
    if (creating) return // Prevent double submit
    
    setError(null) // Clear previous errors
    
    if (!selectedTemplate || !botName) {
      setError('Please select a template and enter a bot name')
      return
    }

    if (!botConfig.tickers.length) {
      setError('Please add at least one ticker')
      return
    }

    setCreating(true)

    try {
      // Single normalization point
      const tickers = Array.from(
        new Set(
          botConfig.tickers
            .map(t => t.trim().toUpperCase())
            .filter(Boolean)
        )
      )

      const payload = {
        type: selectedTemplate.type,
        templateId: selectedTemplate.type === 'RULE_BASED' ? selectedTemplate.id : null,
        strategyId: selectedTemplate.type === 'STRATEGY_BASED' ? selectedTemplate.id : null,
        portfolioId: 'prt_stub_demo',
        name: botName,
        config: {
          tickers,
          quantity: botConfig.quantity,
          direction: botConfig.direction,
          ...(selectedTemplate.type === 'STRATEGY_BASED' && {
            minConfidence: botConfig.minConfidence
          })
        }
      }

      let bot
      if (selectedTemplate.type === 'RULE_BASED') {
        bot = await createBotFromTemplate(payload.templateId, {
          portfolioId: payload.portfolioId,
          name: payload.name,
          botConfig: payload.config
        })
      } else {
        bot = await createStrategyBot(payload.strategyId, {
          portfolioId: payload.portfolioId,
          name: payload.name,
          botConfig: payload.config
        })
      }

      // Navigate to bots page with success
      navigate('/bots', { 
        state: { 
          success: true,
          botName: bot.name,
          botId: bot.id
        }
      })
    } catch (err) {
      setError(err.message || 'Failed to create bot')
    } finally {
      setCreating(false)
    }
  }

  const handleAddTicker = () => {
    const ticker = window.prompt('Enter ticker symbol (e.g., AAPL):')
    if (ticker && /^[A-Z]{1,5}$/.test(ticker.toUpperCase())) {
      setBotConfig(prev => ({
        ...prev,
        tickers: [...prev.tickers, ticker.toUpperCase()]
      }))
    }
  }

  const handleRemoveTicker = (index) => {
    setBotConfig(prev => ({
      ...prev,
      tickers: prev.tickers.filter((_, i) => i !== index)
    }))
  }

  if (loading) {
    return (
      <div className="page container" style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div>Loading bot catalog...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page container" style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 className="hero" style={{ marginBottom: '0.5rem' }}>Create New Bot</h1>
        <div className="muted">Choose a template or strategy to create your automated trading bot</div>
      </header>

      {error && (
        <article style={{ 
          background: '#fef2f2', 
          border: '1px solid #fecaca', 
          borderRadius: 8, 
          padding: '1rem', 
          marginBottom: '1.5rem',
          color: '#dc2626'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Error</div>
          <div style={{ fontSize: '14px' }}>{error}</div>
        </article>
      )}

      {/* Bot Type Selection */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Bot Type</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <button
            className={`pressable ${selectedType === 'rule-based' ? 'primary' : 'ghost'}`}
            onClick={() => setSelectedType('rule-based')}
            style={{ padding: '1rem', textAlign: 'left' }}
          >
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Rule-Based Bot</div>
            <div style={{ fontSize: '14px', opacity: 0.8 }}>
              Uses configurable rules for entry and risk management
            </div>
          </button>
          <button
            className={`pressable ${selectedType === 'strategy-based' ? 'primary' : 'ghost'}`}
            onClick={() => setSelectedType('strategy-based')}
            style={{ padding: '1rem', textAlign: 'left' }}
          >
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Strategy-Based Bot</div>
            <div style={{ fontSize: '14px', opacity: 0.8 }}>
              Uses alpha-engine predictions for trading signals
            </div>
          </button>
        </div>
      </section>

      {/* Template Selection */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Choose Template or Strategy</h2>
        <BotTemplateSelector
          onSelect={handleTemplateSelect}
          ticker={botConfig.tickers?.[0] ?? null}
          selectedTemplate={selectedTemplate}
        />
      </section>

      {/* Bot Configuration */}
      {selectedTemplate && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Bot Configuration</h2>
          
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                Bot Name
              </label>
              <input
                type="text"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '0.75rem', 
                  border: '1px solid #d1d5db', 
                  borderRadius: 6,
                  fontSize: '16px'
                }}
                placeholder="Enter bot name"
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                Tickers
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                {botConfig.tickers.map((ticker, index) => (
                  <span
                    key={index}
                    style={{
                      background: '#f3f4f6',
                      padding: '0.25rem 0.5rem',
                      borderRadius: 4,
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}
                  >
                    {ticker}
                    <button
                      onClick={() => handleRemoveTicker(index)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#666',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '16px'
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  className="ghost pressable"
                  onClick={handleAddTicker}
                  style={{ fontSize: '14px', padding: '0.25rem 0.5rem' }}
                >
                  + Add Ticker
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                  Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  value={quantityInput}
                  onChange={handleQuantityChange}
onBlur={handleQuantityBlur}
                  style={{ 
                    width: '100%', 
                    padding: '0.75rem', 
                    border: '1px solid #d1d5db', 
                    borderRadius: 6,
                    fontSize: '16px'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                  Direction
                </label>
                <select
                  value={botConfig.direction}
                  onChange={(e) => setBotConfig(prev => ({ ...prev, direction: e.target.value }))}
                  style={{ 
                    width: '100%', 
                    padding: '0.75rem', 
                    border: '1px solid #d1d5db', 
                    borderRadius: 6,
                    fontSize: '16px'
                  }}
                >
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </div>
            </div>

            {selectedType === 'strategy-based' && (
              <div style={{ marginTop: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                  Min Confidence Threshold
                </label>
                <input
                  type="number"
                  min="0.1"
                  max="1.0"
                  step="0.1"
                  value={minConfidenceInput}
                  onChange={handleConfidenceChange}
onBlur={handleConfidenceBlur}
                  style={{ 
                    width: '100%', 
                    padding: '0.75rem', 
                    border: '1px solid #d1d5db', 
                    borderRadius: 6,
                    fontSize: '16px'
                  }}
                />
                <div style={{ fontSize: '13px', color: '#666', marginTop: '0.25rem' }}>
                  Only execute trades when prediction confidence is above this threshold
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Create Button */}
      {selectedTemplate && (
        <section>
          <button
            className="primary pressable"
            onClick={handleCreateBot}
            disabled={!selectedTemplate || !botName || botConfig.tickers.length === 0 || creating}
            style={{ 
              padding: '1rem 2rem',
              fontSize: '16px',
              fontWeight: 600,
              opacity: (!selectedTemplate || !botName || botConfig.tickers.length === 0 || creating) ? 0.5 : 1
            }}
          >
            {creating ? 'Creating Bot...' : 'Create Bot'}
          </button>
        </section>
      )}
    </div>
  )
}
