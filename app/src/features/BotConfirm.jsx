import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useApp } from '../app/AppProvider'
import { createBotFromTemplate, createStrategyBot, updateBot } from '../api/services/botCatalogService.js'

export default function BotConfirm() {
  const navigate = useNavigate()
  const location = useLocation()
  const { state } = useApp()

  const bot = state.bots.find((item) => item.id === state.selectedBotId) || location.state?.bot

  const [acknowledged, setAcknowledged] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState(null)

  if (!bot) {
    return (
      <div className="l-page">
        <div className="container">
          <div className="panel-empty">
            <h2 className="m-0 mb-2">Bot Not Found</h2>
            <p className="muted m-0 mb-3">The requested bot could not be found.</p>
            <button className="btn btn-sm btn-primary" type="button" onClick={() => navigate('/bots')}>
              Back to Bots
            </button>
          </div>
        </div>
      </div>
    )
  }

  const handleExecute = async () => {
    if (executing) return
    setExecuting(true)
    setError(null)

    try {
      const serviceConfig = {
        ...(bot.config || {}),
        tickers: bot.config?.tickers || ['SPY'],
        quantity: bot.config?.quantity || 10,
        direction: bot.config?.direction || 'buy',
        ...(bot.type === 'STRATEGY_BASED' && { minConfidence: bot.config?.minConfidence ?? 0.7 }),
      }

      if (bot.id) {
        await updateBot(bot.id, { enabled: true, config: serviceConfig })
        navigate('/bots')
        return
      }

      let createdBot
      if (bot.type === 'RULE_BASED') {
        createdBot = await createBotFromTemplate(bot.templateId, {
          portfolioId: bot.portfolioId,
          name: bot.name,
          botConfig: serviceConfig,
        })
      } else {
        createdBot = await createStrategyBot(bot.strategyId, {
          portfolioId: bot.portfolioId,
          name: bot.name,
          botConfig: serviceConfig,
        })
      }

      navigate('/bots', {
        state: {
          success: true,
          botName: createdBot.name,
          botId: createdBot.id,
        },
      })
    } catch (err) {
      setError(err.message || 'Failed to execute bot')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="l-page">
      <div className="container l-stack-lg">
        <header className="stack-sm">
          <button className="btn btn-xs btn-ghost" type="button" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h1 className="hero m-0">Bot Confirmation</h1>
          <p className="muted text-md m-0">Review your configuration and acknowledge automated execution.</p>
        </header>

        <section className="card card-pad-md">
          <div className="panel-header">
            <h2 className="panel-title">Bot Summary</h2>
            <span className={bot.type === 'RULE_BASED' ? 'badge badge-positive' : 'badge badge-soft'}>
              {bot.type === 'RULE_BASED' ? 'Rules-Based' : 'Strategy-Based'}
            </span>
          </div>

          <div className="l-grid-2">
            <div className="stack-sm text-sm">
              <div className="kv">
                <span className="kv-key">Name</span>
                <span className="font-600">{bot.name}</span>
              </div>
              <div className="kv">
                <span className="kv-key">Strategy</span>
                <span>{bot.strategy || 'Custom configuration'}</span>
              </div>
              <div className="kv">
                <span className="kv-key">Assets</span>
                <span className="font-600">{bot.asset}</span>
              </div>
              <div className="kv">
                <span className="kv-key">Risk level</span>
                <span>{bot.riskLevel || 'Medium'}</span>
              </div>
            </div>

            <div className="subcard">
              <div className="text-xs muted mb-2">Execution</div>
              <div className="text-sm">
                Trades will execute automatically when market conditions meet your strategy or rules.
              </div>
              <div className="text-xs muted mt-3">
                You can pause or stop the bot anytime from the bot details page.
              </div>
            </div>
          </div>
        </section>

        <section className="alert alert-warn">
          <div className="alert-title">Important: automated trading</div>
          <div className="text-sm mb-3">
            This bot will automatically execute trades on your behalf. Use limits and monitoring to control risk
            exposure.
          </div>
          <ul className="list text-sm m-0">
            <li>Trades execute automatically when strategy criteria are met</li>
            <li>You can pause or stop the bot at any time</li>
            <li>All activity is recorded in execution history</li>
          </ul>
        </section>

        <section className="card card-pad-md">
          <label className="hstack" htmlFor="ack">
            <input
              id="ack"
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span className="font-600">I understand and acknowledge automated execution.</span>
          </label>
          <div className="muted text-sm mt-3">
            You can manage the bot from the Bots page after it starts.
          </div>
        </section>

        {error && (
          <section className="alert alert-error">
            <div className="alert-title">Error</div>
            <div className="text-sm">{error}</div>
          </section>
        )}

        <div className="l-row">
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => navigate(-1)} disabled={executing}>
            Back
          </button>
          <button
            className="btn btn-sm btn-primary"
            type="button"
            onClick={handleExecute}
            disabled={!acknowledged || executing}
          >
            {executing ? 'Executing…' : 'Execute Bot'}
          </button>
        </div>
      </div>
    </div>
  )
}
