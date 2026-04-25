import { useNavigate, useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { getBotById, updateBot, deleteBot, getBotEvents, getBotRules } from '../api/services/botCatalogService.js'

export default function BotDetails() {
  const navigate = useNavigate()
  const { botId } = useParams()
  const [bot, setBot] = useState(null)
  const [events, setEvents] = useState([])
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const loadBotData = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const [botData, eventsData, rulesData] = await Promise.all([
          getBotById(botId),
          getBotEvents(botId),
          getBotRules(botId)
        ])
        
        setBot(botData)
        setEvents(Array.isArray(eventsData) ? eventsData : [])
        setRules(Array.isArray(rulesData) ? rulesData : [])
      } catch (error) {
        console.error('Failed to load bot data:', error)
        setError('Failed to load bot details. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    
    if (botId) {
      loadBotData()
    }
  }, [botId])

  if (loading) {
    return (
      <div className="l-page">
        <div className="container">
          <div className="centered p-8 text-muted">
            Loading bot details...
          </div>
        </div>
      </div>
    )
  }

  if (!bot) {
    return (
      <div className="l-page">
        <div className="container">
          <div className="centered p-8 text-muted">
            <h2>Bot Not Found</h2>
            <p>The requested bot could not be found.</p>
            <button className="btn btn-sm btn-primary" onClick={() => navigate('/bots')}>
              Back to Bots
            </button>
          </div>
        </div>
      </div>
    )
  }

  const handleSave = async (updatedBot) => {
    try {
      await updateBot(botId, updatedBot)
      setBot(prev => ({ ...prev, ...updatedBot }))
      setEditing(false)
    } catch (error) {
      console.error('Failed to update bot:', error)
      setError('Failed to save bot changes. Please try again.')
    }
  }

  const handleStatusToggle = async () => {
    try {
      const newEnabledState = !bot.enabled
      await updateBot(botId, { enabled: newEnabledState })
      setBot(prev => ({ ...prev, enabled: newEnabledState }))
    } catch (error) {
      console.error('Failed to update bot status:', error)
      setError('Failed to update bot status. Please try again.')
    }
  }

  const handleEmergencyStop = async () => {
    if (window.confirm('EMERGENCY STOP: This will immediately halt all trading activity and prevent any new trades. Historical data will be preserved. Continue?')) {
      try {
        await updateBot(botId, { enabled: false })
        setBot(prev => ({ ...prev, enabled: false }))
      } catch (error) {
        console.error('Failed to emergency stop bot:', error)
        setError('Failed to emergency stop bot. Please try again.')
      }
    }
  }

  const handleArchiveBot = async () => {
    if (window.confirm('Archive this bot? The bot will be stopped and moved to archives. All historical trading data will be preserved and accessible through the history page.')) {
      try {
        await deleteBot(botId)
        navigate('/bots')
      } catch (error) {
        console.error('Failed to archive bot:', error)
        setError('Failed to archive bot. Please try again.')
      }
    }
  }

  const handleDeleteBot = async () => {
    if (window.confirm('Delete this bot? The bot will be permanently removed from your active list, but all historical trading data will be preserved. This action cannot be undone.')) {
      try {
        await deleteBot(botId)
        navigate('/bots')
      } catch (error) {
        console.error('Failed to delete bot:', error)
        setError('Failed to delete bot. Please try again.')
      }
    }
  }

  // Map service layer status to UI display
  const getBotStatus = (bot) => {
    if (bot.deletedAt) return 'archived'
    if (bot.enabled) return 'running'
    return 'paused'
  }

  const status = getBotStatus(bot)
  const badgeClass =
    status === 'running'
      ? 'badge badge-positive'
      : status === 'archived'
        ? 'badge badge-neutral'
        : status === 'stopped'
          ? 'badge badge-negative'
          : 'badge badge-warning'

  const badgeLabel =
    status === 'running'
      ? 'Running'
      : status === 'stopped'
        ? 'Stopped'
        : status === 'archived'
          ? 'Archived'
          : 'Paused'

  return (
    <div className="l-page">
      <div className="container">
        {/* Error Display */}
        {error && (
          <section className="alert alert-error mb-5">
            <div className="alert-title">Error</div>
            <div className="text-sm">{error}</div>
          </section>
        )}

        <header className="mb-6">
          <button
            className="btn btn-xs btn-ghost mb-3"
            onClick={() => navigate('/bots')}
          >
            &larr; Back to Bots
          </button>
          
          <div className="l-grid-2wide">
            <div className="stack-sm">
              <div className="col">
                <div className={badgeClass}>{badgeLabel}</div>
                <h1 className="hero mt-2">
                  {bot.name}
                </h1>
              </div>
              <p className="muted text-md m-0">
                Asset: {bot.asset} · Strategy: {bot.strategy || 'Custom Configuration'}
              </p>
            </div>
            
            <div className="btn-group">
              {status === 'running' && (
                <button
                  className="btn btn-sm btn-ghost text-negative"
                  onClick={handleEmergencyStop}
                >
                  Emergency Stop
                </button>
              )}
              <button
                className={editing ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                onClick={() => setEditing(!editing)}
              >
                {editing ? 'Cancel' : 'Edit'}
              </button>
              <button
                className={bot.enabled ? 'btn btn-sm btn-ghost' : 'btn btn-sm btn-primary'}
                onClick={handleStatusToggle}
                disabled={status === 'archived'}
              >
                {bot.enabled ? 'Pause' : 'Start'}
              </button>
            </div>
          </div>
        </header>

        <div className="l-grid-2wide mb-6">
          {/* Main Content */}
          <section>
            <article className="card card-pad-md mb-6">
              <div className="panel-header">
                <h2 className="panel-title">Configuration</h2>
              </div>
              
              {editing ? (
                <BotEditForm bot={bot} onSave={handleSave} />
              ) : (
                <div className="stack-md">
                  <div className="kv">
                    <div className="kv-key">Bot Name:</div>
                    <div>{bot.name}</div>
                  </div>
                  <div className="kv">
                    <div className="kv-key">Type:</div>
                    <div>{bot.botType || 'rule_based'}</div>
                  </div>
                  <div className="kv">
                    <div className="kv-key">Portfolio:</div>
                    <div>{bot.portfolioId}</div>
                  </div>
                  {bot.templateId && (
                    <div className="kv">
                      <div className="kv-key">Template:</div>
                      <div>{bot.templateId}</div>
                    </div>
                  )}
                  <div className="kv">
                    <div className="kv-key">Tickers:</div>
                    <div>{bot.config?.tickers?.join(', ') || 'None'}</div>
                  </div>
                  <div className="kv">
                    <div className="kv-key">Quantity:</div>
                    <div>{bot.config?.quantity || 'Not set'}</div>
                  </div>
                  <div className="kv">
                    <div className="kv-key">Direction:</div>
                    <div>{bot.config?.direction || 'Not set'}</div>
                  </div>
                  <div className="kv">
                    <div className="kv-key">Position Size:</div>
                    <div>{bot.positionSize || '10%'}</div>
                  </div>
                </div>
              )}
            </article>

            <article className="card card-pad-md">
              <div className="panel-header">
                <h2 className="panel-title">Performance</h2>
                <button 
                  className="btn btn-sm btn-ghost"
                  onClick={() => navigate(`/bots/${botId}/history`)}
                >
                  View Full History &rarr;
                </button>
              </div>
              
              <div className="kpi-grid-4">
                <div className="tile">
                  <div className="tile-value text-positive">+8.2%</div>
                  <div className="tile-label">Total Return</div>
                </div>
                <div className="tile">
                  <div className="tile-value text-primary">24</div>
                  <div className="tile-label">Trades</div>
                </div>
                <div className="tile">
                  <div className="tile-value text-muted">71%</div>
                  <div className="tile-label">Win Rate</div>
                </div>
                <div className="tile">
                  <div className="tile-value text-muted">2.1h</div>
                  <div className="tile-label">Avg Hold</div>
                </div>
              </div>
            </article>
          </section>

          {/* Sidebar */}
          <aside>
            <article className="card card-pad-md mb-6">
              <div className="panel-header">
                <h3 className="panel-title">Quick Actions</h3>
              </div>
              <div className="stack-sm">
                <button
                  className="btn btn-sm btn-ghost btn-block text-left"
                  onClick={() => navigate(`/bots/${botId}/history`)}
                >
                  View Execution History
                </button>
                <button
                  className="btn btn-sm btn-ghost btn-block text-left"
                  onClick={() => navigate('/bots/create', { 
                    state: { 
                      duplicateFrom: bot
                    } 
                  })}
                >
                  Duplicate Bot
                </button>
                <button
                  className="btn btn-sm btn-ghost btn-block text-left"
                  onClick={handleArchiveBot}
                  disabled={bot.status === 'archived'}
                >
                  Archive Bot
                </button>
                <button
                  className="btn btn-sm btn-ghost btn-block text-left text-negative"
                  onClick={handleDeleteBot}
                >
                  Delete Bot
                </button>
              </div>
            </article>

            <article className="card card-inverse card-pad-md">
              <h3 className="m-0 mb-1">Bot Status</h3>
              <div className="text-lg font-700 mb-2">
                {status === 'running' ? 'Active' : 
                 status === 'stopped' ? 'Stopped' : 
                 status === 'archived' ? 'Archived' : 'Paused'}
              </div>
              <p className="text-sm opacity-84 m-0">
                {status === 'running' 
                  ? 'Bot is actively monitoring markets and executing trades.'
                  : status === 'stopped'
                  ? 'Bot has been emergency stopped. No new trades will be executed.'
                  : status === 'archived'
                  ? 'Bot is archived. Historical data preserved but bot is inactive.'
                  : 'Bot is paused and not executing trades.'
                }
              </p>
            </article>
          </aside>
        </div>
      </div>
    </div>
  )
}

// Edit form component
function BotEditForm({ bot, onSave }) {
  const [formData, setFormData] = useState({
    name: bot.name,
    asset: bot.asset,
    strategy: bot.strategy || '',
    riskLevel: bot.riskLevel || 'Medium',
    positionSize: bot.positionSize || '10%'
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="stack-md">
        <div className="field">
          <label className="field-label">Bot Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="field-input"
          />
        </div>
        
        <div className="field">
          <label className="field-label">Asset</label>
          <input
            type="text"
            value={formData.asset}
            onChange={(e) => setFormData({ ...formData, asset: e.target.value })}
            className="field-input"
          />
        </div>
        
        <div className="field">
          <label className="field-label">Strategy</label>
          <input
            type="text"
            value={formData.strategy}
            onChange={(e) => setFormData({ ...formData, strategy: e.target.value })}
            className="field-input"
          />
        </div>
        
        <div className="field">
          <label className="field-label">Risk Level</label>
          <select
            value={formData.riskLevel}
            onChange={(e) => setFormData({ ...formData, riskLevel: e.target.value })}
            className="field-select"
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
        </div>
        
        <div className="field">
          <label className="field-label">Position Size</label>
          <input
            type="text"
            value={formData.positionSize}
            onChange={(e) => setFormData({ ...formData, positionSize: e.target.value })}
            className="field-input"
          />
        </div>
        
        <div className="wrap mt-3">
          <button type="submit" className="btn btn-sm btn-primary">
            Save Changes
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => window.location.reload()}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  )
}
