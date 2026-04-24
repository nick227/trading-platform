import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getBots, updateBot } from '../../api/services/botCatalogService'

export default function BotsTab() {
  const [bots, setBots] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null) // { type: 'success'|'error', message }
  const [toggling, setToggling] = useState(null) // botId being toggled

  useEffect(() => {
    loadBots()
  }, [])

  const loadBots = async () => {
    setLoading(true)
    setStatus(null)
    try {
      const response = await getBots()
      setBots(response.data || [])
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Failed to load bots.' })
    } finally {
      setLoading(false)
    }
  }

  const handleToggleBot = async (botId, currentEnabled) => {
    setToggling(botId)
    setStatus(null)
    try {
      await updateBot(botId, { enabled: !currentEnabled })
      setBots(bots.map(bot =>
        bot.id === botId ? { ...bot, enabled: !currentEnabled } : bot
      ))
      setStatus({
        type: 'success',
        message: `Bot ${!currentEnabled ? 'enabled' : 'disabled'}.`
      })
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Failed to update bot.' })
    } finally {
      setToggling(null)
    }
  }

  return (
    <div className="profile-pane">
      <div className="card profile-card">
        <div className="profile-card-header">
          <h3 className="profile-card-title">Trading Bots</h3>
          <button
            className="btn btn-xs btn-ghost"
            onClick={loadBots}
            disabled={loading}
            title="Refresh"
          >
            {loading ? '...' : '↻'}
          </button>
        </div>

        {loading ? (
          <p className="muted">Loading bots...</p>
        ) : bots.length === 0 ? (
          <div className="text-center py-4">
            <p className="muted mb-2">No bots configured.</p>
            <Link to="/bots/create" className="btn btn-sm btn-primary">
              Create Bot
            </Link>
          </div>
        ) : (
          <div className="list">
            {bots.map((bot) => (
              <div key={bot.id} className="row">
                <div>
                  <strong>{bot.name}</strong>
                  <div className="muted text-xs">
                    {bot.strategyId && `Strategy: ${bot.strategyId}`}
                  </div>
                </div>
                <span className={`chip ${bot.enabled ? 'chip-live' : ''}`}>
                  {bot.enabled ? 'Active' : 'Paused'}
                </span>
                <button
                  className="btn btn-xs btn-ghost"
                  onClick={() => handleToggleBot(bot.id, bot.enabled)}
                  disabled={toggling === bot.id}
                >
                  {toggling === bot.id ? '...' : bot.enabled ? 'Pause' : 'Start'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {status && (
        <p className={`profile-status mt-3 ${status.type === 'error' ? 'text-negative' : 'text-positive'}`} role="status">
          {status.message}
        </p>
      )}
    </div>
  )
}
