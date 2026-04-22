import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RULE_BASED_TEMPLATES } from '../constants/tradingStrategies.js'
import TickerSelector from '../components/TickerSelector.jsx'
import BankrollDisplay from '../components/BankrollDisplay.jsx'

export default function RuleBasedBotSetup() {
  const navigate = useNavigate()
  const now = new Date()
  const dateTime = now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const [selectedTemplateId, setSelectedTemplateId] = useState(RULE_BASED_TEMPLATES[0]?.id || '')

  const [config, setConfig] = useState({
    name: `Rule-Based Bot ${dateTime}`,
    tickers: [{ symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust' }],
    maxSpendPerTrade: 1000,
    rules: [],
  })

  
  const handleNext = () => {
    if (!config.name) {
      alert('Please enter a bot name')
      return
    }

    if (!selectedTemplateId) {
      alert('Please select a rule template')
      return
    }

    if (config.tickers.length === 0) {
      alert('Please select at least one trading ticker')
      return
    }

    // Optimized single-pass ticker transformation
    const tickers = []
    const seen = new Set()
    for (const ticker of config.tickers) {
      const symbol = ticker?.symbol?.trim?.()?.toUpperCase?.()
      if (symbol && !seen.has(symbol)) {
        seen.add(symbol)
        tickers.push(symbol)
      }
    }

    const selectedTemplate = useMemo(() => 
    RULE_BASED_TEMPLATES.find((t) => t.id === selectedTemplateId),
    [selectedTemplateId]
  )

    const botForConfirmation = {
      name: config.name,
      type: 'RULE_BASED',
      templateId: selectedTemplateId,
      portfolioId: 'prt_test_demo',
      asset: tickers.join(', '),
      strategy: selectedTemplate?.name || 'Rule-based template',
      riskLevel: 'Medium',
      config: {
        tickers,
        quantity: 10,
        direction: 'buy',
        maxSpendPerTrade: config.maxSpendPerTrade,
        rules: config.rules,
      },
    }

    navigate('/bots/confirm', {
      state: {
        bot: botForConfirmation,
      },
    })
  }

  const handleBack = () => {
    navigate('/bots/create')
  }

  return (
    <div className="l-page">
      <div className="container">
        <header className="mb-6">
          <button className="btn btn-xs btn-ghost mb-3" type="button" onClick={handleBack}>
            ← Back
          </button>
          <h1 className="hero mb-2">Rule-Based Bot Setup</h1>
          <p className="muted text-md">Configure your automated trading bot with custom rules and risk management</p>
        </header>

        <section className="mb-6">
          <article className="card card-pad-md">
            <div className="panel-header">
              <h2 className="panel-title">About Rule-Based Bots</h2>
            </div>
            <div className="stack-md">
              <p>
                Rule-based bots trade when specific conditions you set are met. No guessing, no emotions — just automatic
                execution of your strategy exactly as you define it.
              </p>

              <div>
                <div className="text-sm font-600 mb-2">When this bot trades</div>
                <ul className="list text-sm">
                  <li>Buys SPY when it crosses above its 50-day moving average</li>
                  <li>Sells AAPL if RSI drops below 30 (oversold signal)</li>
                  <li>Shorts TSLA when price breaks below support with high volume</li>
                  <li>Covers shorts when stock rallies 5% from entry point</li>
                </ul>
              </div>
            </div>
          </article>
        </section>

        <section className="mb-6">
          <article className="card card-pad-md">
            <div className="panel-header">
              <h2 className="panel-title">Bot Configuration</h2>
            </div>

            <div className="stack-lg">
              <div className="field">
                <label className="field-label">Rule Template</label>
                <select
                  className="field-select"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                >
                  {RULE_BASED_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <div className="field-help">
                  {RULE_BASED_TEMPLATES.find(t => t.id === selectedTemplateId)?.description}
                </div>
              </div>

              <div className="field">
                <label className="field-label">Bot Name</label>
                <input
                  type="text"
                  className="field-input"
                  value={config.name}
                  onChange={(e) => setConfig({ ...config, name: e.target.value })}
                  placeholder="My Trading Bot"
                />
              </div>

              <div className="field">
                <label className="field-label">Trading Tickers</label>
                <TickerSelector
                  selectedTickers={config.tickers}
                  onChange={(tickers) => setConfig({ ...config, tickers })}
                  maxTickers={5}
                />
              </div>

              <div className="field">
                <label className="field-label">Max Spend Per Trade</label>
                <input
                  type="number"
                  className="field-input"
                  value={config.maxSpendPerTrade}
                  onChange={(e) => setConfig({ ...config, maxSpendPerTrade: parseInt(e.target.value, 10) || 100 })}
                  min="100"
                  step="100"
                />
                <div className="field-help">Maximum amount bot can spend on each trade</div>
              </div>
            </div>
          </article>
        </section>

        <section className="mb-6">
          <article className="card card-pad-md">
            <div className="panel-header">
              <h2 className="panel-title">Trading Rules</h2>
            </div>

            <div className="stack-md">
              <p>Configure the rules that will trigger your bot&apos;s trading actions:</p>

              <div className="stack-sm">
                <div className="subcard">
                  <div className="l-row">
                    <div className="stack-sm flex-1">
                      <div className="text-sm font-600">Market hours</div>
                      <div className="text-xs muted">Only trade during regular market hours (9:30 AM – 4:00 PM ET)</div>
                    </div>
                    <label className="switch" aria-label="Market hours rule">
                      <input type="checkbox" defaultChecked />
                      <span className="switch-track" />
                    </label>
                  </div>
                </div>

                <div className="subcard">
                  <div className="l-row">
                    <div className="stack-sm flex-1">
                      <div className="text-sm font-600">Price threshold</div>
                      <div className="text-xs muted">Execute trades when price moves above/below specified levels</div>
                    </div>
                    <label className="switch" aria-label="Price threshold rule">
                      <input type="checkbox" defaultChecked />
                      <span className="switch-track" />
                    </label>
                  </div>
                </div>

                <div className="subcard">
                  <div className="l-row">
                    <div className="stack-sm flex-1">
                      <div className="text-sm font-600">Position limits</div>
                      <div className="text-xs muted">Limit maximum position size to manage risk</div>
                    </div>
                    <label className="switch" aria-label="Position limit rule">
                      <input type="checkbox" defaultChecked />
                      <span className="switch-track" />
                    </label>
                  </div>
                </div>

                <div className="subcard">
                  <div className="l-row">
                    <div className="stack-sm flex-1">
                      <div className="text-sm font-600">Daily loss limit</div>
                      <div className="text-xs muted">Stop trading if daily losses exceed a threshold</div>
                    </div>
                    <label className="switch" aria-label="Daily loss limit rule">
                      <input type="checkbox" />
                      <span className="switch-track" />
                    </label>
                  </div>
                </div>
              </div>

              <button className="btn btn-sm btn-ghost" type="button">
                + Add Custom Rule
              </button>
            </div>
          </article>
        </section>

        <section className="mb-6">
          <article className="card card-pad-md">
            <div className="panel-header">
              <h2 className="panel-title">Risk Management</h2>
            </div>

            <div className="stack-md">
              <BankrollDisplay />

              <div className="l-grid-2">
                <div className="field">
                  <label className="field-label">Max Daily Loss</label>
                  <input type="number" className="field-input field-sm" placeholder="1000" />
                  <div className="field-help">Stop trading if losses exceed this amount</div>
                </div>

                <div className="field">
                  <label className="field-label">Max Position Size</label>
                  <input type="number" className="field-input field-sm" placeholder="10000" />
                  <div className="field-help">Maximum value per position</div>
                </div>
              </div>

              <div className="field">
                <label className="field-label">Stop Loss Percentage</label>
                <input type="number" className="field-input field-sm" placeholder="5" step="0.1" />
                <div className="field-help">Automatic sell if price drops by this %</div>
              </div>

              <div className="field">
                <label className="field-label">Cooldown Period</label>
                <select className="field-select field-sm">
                  <option value="0">No cooldown</option>
                  <option value="300">5 minutes</option>
                  <option value="900">15 minutes</option>
                  <option value="3600">1 hour</option>
                  <option value="86400">1 day</option>
                </select>
                <div className="field-help">Wait period between trades to prevent overtrading</div>
              </div>
            </div>
          </article>
        </section>

        <div className="l-row">
          <button className="btn btn-sm btn-ghost" type="button" onClick={handleBack}>
            Back
          </button>
          <button className="btn btn-sm btn-primary" type="button" onClick={handleNext} disabled={!config.name}>
            Continue to Confirmation
          </button>
        </div>
      </div>
    </div>
  )
}

