import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { STRATEGY_BASED_TEMPLATES } from '../constants/tradingStrategies.js'
import TickerSelector from '../components/TickerSelector.jsx'
import BankrollDisplay from '../components/BankrollDisplay.jsx'

const aggressionToMinConfidence = (aggression) => {
  const clamped = Math.min(1, Math.max(0.3, aggression))
  return Math.min(0.9, Math.max(0.3, 1.1 - clamped))
}

export default function StrategyBasedBotSetup() {
  const navigate = useNavigate()
  const now = new Date()
  const dateTime = now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  
  const [config, setConfig] = useState({
    name: `Strategy-Based Bot ${dateTime}`,
    tickers: [{ symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust' }],
    maxSpendPerTrade: 1000,
    aggression: 0.7,
    strategy: null,
    reinvestProfits: true,
    stopOnLoss: 500,
  })

  
  const minConfidence = useMemo(() => aggressionToMinConfidence(config.aggression), [config.aggression])

  const handleNext = () => {
    if (!config.name) {
      alert('Please enter a bot name')
      return
    }

    if (config.tickers.length === 0) {
      alert('Please select at least one trading ticker')
      return
    }

    if (!config.strategy) {
      alert('Please select a trading strategy')
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

    const botForConfirmation = {
      name: config.name,
      type: 'STRATEGY_BASED',
      strategyId: config.strategy.id,
      templateId: null,
      portfolioId: 'prt_test_demo',
      asset: tickers.join(', '),
      strategy: config.strategy.name,
      riskLevel: 'Medium',
      config: {
        tickers,
        quantity: 10,
        direction: 'buy',
        minConfidence,
        aggression: config.aggression,
        maxSpendPerTrade: config.maxSpendPerTrade,
        reinvestProfits: config.reinvestProfits,
        stopOnLoss: config.stopOnLoss,
      },
    }

    navigate('/bots/confirm', {
      state: {
        bot: botForConfirmation,
      },
    })
  }

  const handleBack = useCallback(() => {
    navigate('/bots/create')
  }, [navigate])

  const handleStrategySelect = useCallback((strategy) => {
    setConfig((prev) => ({
      ...prev,
      strategy,
    }))
  }, [])

  return (
    <div className="l-page">
      <div className="container">
        <header className="mb-6">
          <button className="btn btn-xs btn-ghost mb-3" type="button" onClick={handleBack}>
            ← Back
          </button>
          <h1 className="hero mb-2">Strategy-Based Bot Setup</h1>
          <p className="muted text-md">Configure your AI-powered trading bot that uses alpha engine predictions</p>
        </header>

        <section className="mb-6">
          <article className="card card-pad-md">
            <div className="panel-header">
              <h2 className="panel-title">About Strategy-Based Bots</h2>
            </div>
            <div className="stack-md">
              <p>
                These bots use our AI to analyze market data and make trading predictions. The AI looks at price
                patterns, volume, news sentiment, and more to find opportunities you might miss.
              </p>

              <div>
                <div className="text-sm font-600 mb-2">When this bot trades</div>
                <ul className="list text-sm">
                  <li>Buys NVDA when AI detects unusual options flow + positive news</li>
                  <li>Sells TSLA when sentiment shifts bearish + technical breakdown</li>
                  <li>Shorts meme stocks when AI predicts bubble burst pattern</li>
                  <li>Goes long on biotech when FDA approval probability spikes</li>
                </ul>
              </div>
            </div>
          </article>
        </section>

        <section className="mb-6">
          <article className="card card-pad-md">
            <div className="panel-header">
              <h2 className="panel-title">Choose Strategy</h2>
            </div>

            <div className="stack-md">
              {STRATEGY_BASED_TEMPLATES.map((strategy) => {
                const selected = config.strategy?.id === strategy.id
                const meta = [strategy.category === 'alpha_engine' ? 'Alpha Engine' : strategy.category, strategy.metadata?.cadence]
                  .filter(Boolean)
                  .join(' · ')

                return (
                  <button
                    key={strategy.id}
                    type="button"
                    className={`card card-pad-sm card-outline text-left ${selected ? 'card-selected' : ''}`}
                    onClick={() => handleStrategySelect(strategy)}
                  >
                    <div className="l-row">
                      <div className="stack-sm flex-1">
                        <div className="text-md font-700">{strategy.name}</div>
                        <div className="muted text-sm">
                          {strategy.description || 'A proven trading strategy designed for automated execution.'}
                        </div>
                        <div className="wrap mt-2">
                          {meta && <span className="badge badge-soft">{meta}</span>}
                          {strategy.metadata?.edge && <span className="badge badge-positive">{strategy.metadata.edge}</span>}
                        </div>
                      </div>
                      <div className={`badge ${selected ? 'badge-positive' : 'badge-neutral'}`}>
                        {selected ? 'Selected' : 'Pick'}
                      </div>
                    </div>
                  </button>
                )
              })}
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
                <label className="field-label">Bot Name</label>
                <input
                  type="text"
                  className="field-input"
                  value={config.name}
                  onChange={(e) => setConfig({ ...config, name: e.target.value })}
                  placeholder="My Strategy Bot"
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

              <div className="field">
                <label className="field-label">Aggression Scale</label>
                <div className="l-row">
                  <input
                    className="range"
                    type="range"
                    min="0.3"
                    max="1.0"
                    step="0.1"
                    value={config.aggression}
                    onChange={(e) => setConfig({ ...config, aggression: parseFloat(e.target.value) })}
                  />
                  <div className="pill pill-accent">{Math.round(config.aggression * 100)}%</div>
                </div>
                <div className="field-help">
                  {config.aggression < 0.5
                    ? 'Conservative — fewer, higher confidence trades'
                    : config.aggression < 0.8
                      ? 'Balanced — moderate trade frequency'
                      : 'Aggressive — more trades with lower confidence'}
                </div>
                <div className="field-help">Maps to min confidence threshold: {minConfidence.toFixed(2)}</div>
              </div>

              <div className="field">
                <label className="field-label">Profit Management</label>
                <div className="stack-sm">
                  <label className="switch" aria-label="Reinvest profits">
                    <input
                      type="checkbox"
                      checked={config.reinvestProfits}
                      onChange={(e) => setConfig({ ...config, reinvestProfits: e.target.checked })}
                    />
                    <span className="switch-track" />
                    <span className="switch-label">Reinvest Profits</span>
                  </label>
                  <div className="field-help">Bot uses profits to fund new trades instead of returning to bankroll</div>
                </div>
              </div>

              <div className="field">
                <label className="field-label">Stop Loss Threshold</label>
                <input
                  type="number"
                  className="field-input"
                  value={config.stopOnLoss}
                  onChange={(e) => setConfig({ ...config, stopOnLoss: parseInt(e.target.value, 10) || 0 })}
                  min="0"
                  step="100"
                />
                <div className="field-help">Stop trading if cumulative losses exceed this amount ($0 = disabled)</div>
              </div>
            </div>
          </article>
        </section>

        <section className="mb-6">
          <article className="card card-pad-md">
            <div className="panel-header">
              <h2 className="panel-title">Risk Management</h2>
            </div>

            <div className="stack-md">
              <p>Strategy-based bots include built-in risk management, but you can add additional safeguards:</p>

              <BankrollDisplay />

              <div className="stack-sm">
                <div className="subcard">
                  <div className="text-sm font-600 mb-1">Max Daily Loss</div>
                  <div className="text-xs muted mb-2">Stop trading if daily losses exceed amount</div>
                  <input type="number" className="field-input field-sm" placeholder="1000" />
                </div>

                <div className="subcard">
                  <div className="text-sm font-600 mb-1">Position Size Limit</div>
                  <div className="text-xs muted mb-2">Limit maximum position size</div>
                  <input type="number" className="field-input field-sm" placeholder="10000" />
                </div>

                <div className="subcard">
                  <div className="text-sm font-600 mb-1">Cooldown Period</div>
                  <div className="text-xs muted mb-2">Wait period between trades</div>
                  <select className="field-select field-sm">
                    <option value="0">No cooldown</option>
                    <option value="300">5 minutes</option>
                    <option value="900">15 minutes</option>
                    <option value="3600">1 hour</option>
                    <option value="86400">1 day</option>
                  </select>
                </div>
              </div>
            </div>
          </article>
        </section>

        <div className="l-row">
          <button className="btn btn-sm btn-ghost" type="button" onClick={handleBack}>
            Back
          </button>
          <button className="btn btn-sm btn-primary" type="button" onClick={handleNext} disabled={!config.name || !config.strategy}>
            Continue to Confirmation
          </button>
        </div>
      </div>
    </div>
  )
}

