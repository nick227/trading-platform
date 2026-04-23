import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import BotTemplateSelector from '../components/BotTemplateSelector.jsx'
import TickerSelector from '../components/TickerSelector.jsx'

const normalizeTickers = (tickers) =>
  (Array.isArray(tickers) ? tickers : [])
    .map((t) => {
      if (typeof t === 'string') {
        const symbol = t.trim().toUpperCase()
        return symbol ? { symbol, name: symbol } : null
      }
      const symbol = t?.symbol?.trim?.().toUpperCase?.() ?? ''
      return symbol ? { symbol, name: t?.name ?? symbol } : null
    })
    .filter(Boolean)

export default function BotCreate() {
  const navigate = useNavigate()
  const location = useLocation()

  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [botName, setBotName] = useState('')
  const [botConfig, setBotConfig] = useState({
    tickers: [],
    quantity: 10,
    direction: 'buy',
    minConfidence: 0.7,
  })
  const [error, setError] = useState(null)

  useEffect(() => {
    const incomingTemplate = location.state?.defaultTemplate ?? null
    const incomingConfig = location.state?.defaultConfig ?? null

    if (incomingTemplate) {
      setSelectedTemplate(incomingTemplate)
      setBotName(`${incomingTemplate.name} - ${new Date().toLocaleDateString()}`)
    }

    if (incomingConfig?.tickers) {
      setBotConfig((prev) => ({
        ...prev,
        ...incomingConfig,
        tickers: normalizeTickers(incomingConfig.tickers),
      }))
    }
  }, [location.state])

  const handleTemplateSelect = (template) => {
    setSelectedTemplate(template)
    setBotName(`${template.name} - ${new Date().toLocaleDateString()}`)

    const defaults = template?.config?.defaultBotConfig ?? null
    if (defaults) {
      setBotConfig((prev) => ({
        ...prev,
        ...defaults,
        tickers: prev.tickers.length ? prev.tickers : normalizeTickers(defaults.tickers),
      }))
    }
  }

  const handleCreateBot = () => {
    setError(null)

    if (!selectedTemplate || !botName) {
      setError('Please select a template and enter a bot name')
      return
    }

    if (!botConfig.tickers?.length) {
      setError('Please add at least one ticker')
      return
    }

    const tickers = Array.from(
      new Set(
        botConfig.tickers
          .map((t) => (typeof t === 'string' ? t : t?.symbol))
          .map((t) => (t ? t.trim().toUpperCase() : ''))
          .filter(Boolean)
      )
    )

    const botForConfirmation = {
      name: botName,
      type: selectedTemplate.type,
      templateId: selectedTemplate.type === 'RULE_BASED' ? selectedTemplate.id : null,
      strategyId: selectedTemplate.type === 'STRATEGY_BASED' ? selectedTemplate.id : null,
      portfolioId: 'prt_test_demo',
      asset: tickers.join(', '),
      strategy: selectedTemplate.name,
      riskLevel: 'Medium',
      config: {
        tickers,
        quantity: botConfig.quantity,
        direction: botConfig.direction,
        ...(selectedTemplate.type === 'STRATEGY_BASED' && { minConfidence: botConfig.minConfidence }),
      },
    }

    navigate('/bots/confirm', {
      state: {
        bot: botForConfirmation,
      },
    })
  }

  return (
    <div className="l-page">
      <div className="container">
        <header className="stack-sm">
          <button className="btn btn-xs btn-ghost mb-2" type="button" onClick={() => navigate('/bots')}>
            &larr; Back to Bots
          </button>
          <h1 className="hero m-0">Create New Bot</h1>
          <p className="muted text-md m-0">Choose a guided setup or start from a template in the catalog.</p>
        </header>

        {error && (
          <section className="alert alert-error">
            <div className="alert-title">Error</div>
            <div className="text-sm">{error}</div>
          </section>
        )}

        <section className="card card-pad-md">
          <div className="panel-header">
            <h2 className="panel-title">Guided Setup</h2>
          </div>

          <div className="l-grid-2">
            <button
              className="card card-pad-sm card-outline text-left pressable"
              type="button"
              onClick={() => navigate('/bots/create/rule-based')}
            >
              <div className="stack-sm">
                <div className="text-md font-700">Rule-Based Bot</div>
                <div className="muted text-sm">Configure rules.</div>
              </div>
            </button>

            <button
              className="card card-pad-sm card-outline text-left pressable"
              type="button"
              onClick={() => navigate('/bots/create/strategy-based')}
            >
              <div className="stack-sm">
                <div className="text-md font-700">Strategy-Based Bot</div>
                <div className="muted text-sm">Deploy a strategy.</div>
              </div>
            </button>
          </div>
        </section>

        <section className="card card-pad-md">
          <div className="panel-header">
            <h2 className="panel-title">Start from Catalog</h2>
            <button className="btn btn-xs btn-ghost" type="button" onClick={() => navigate('/templates')}>
              Browse templates
            </button>
          </div>

          <BotTemplateSelector onSelect={handleTemplateSelect} selectedTemplate={selectedTemplate} />
        </section>

        {selectedTemplate && (
          <section className="card card-pad-md">
            <div className="panel-header">
              <h2 className="panel-title">Configuration</h2>
              <span
                className={
                  selectedTemplate.type === 'RULE_BASED'
                    ? 'badge badge-positive badge-xs'
                    : 'badge badge-soft badge-xs'
                }
              >
                {selectedTemplate.type === 'RULE_BASED' ? 'Rules' : 'Strategy'}
              </span>
            </div>

            <div className="stack-lg">
              <div className="field">
                <label className="field-label">Bot Name</label>
                <input
                  type="text"
                  className="field-input"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  placeholder="My Trading Bot"
                />
              </div>

              <div className="field">
                <label className="field-label">Trading Tickers</label>
                <TickerSelector
                  selectedTickers={botConfig.tickers}
                  onChange={(tickers) => setBotConfig((prev) => ({ ...prev, tickers }))}
                  maxTickers={5}
                />
              </div>

              <div className="l-grid-2">
                <div className="field">
                  <label className="field-label">Quantity</label>
                  <input
                    type="number"
                    className="field-input"
                    min="1"
                    value={botConfig.quantity}
                    onChange={(e) =>
                      setBotConfig((prev) => ({
                        ...prev,
                        quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label className="field-label">Direction</label>
                  <select
                    className="field-select"
                    value={botConfig.direction}
                    onChange={(e) => setBotConfig((prev) => ({ ...prev, direction: e.target.value }))}
                  >
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </div>
              </div>

              {selectedTemplate.type === 'STRATEGY_BASED' && (
                <div className="field">
                  <label className="field-label">Min Confidence Threshold</label>
                  <input
                    type="number"
                    className="field-input"
                    min="0"
                    max="1"
                    step="0.05"
                    value={botConfig.minConfidence}
                    onChange={(e) =>
                      setBotConfig((prev) => ({
                        ...prev,
                        minConfidence: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)),
                      }))
                    }
                  />
                  <div className="field-help">Only execute trades when prediction confidence clears this threshold.</div>
                </div>
              )}
            </div>
          </section>
        )}

        {selectedTemplate && (
          <div className="l-row">
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => navigate('/bots')}>
              Cancel
            </button>
            <button
              className="btn btn-sm btn-primary"
              type="button"
              onClick={handleCreateBot}
              disabled={!selectedTemplate || !botName || botConfig.tickers.length === 0}
            >
              Continue to Confirmation
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
