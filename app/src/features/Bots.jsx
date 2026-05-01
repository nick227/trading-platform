import { useNavigate } from 'react-router-dom'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { getBotCatalog, getBots, deleteBot, updateBot } from '../api/services/botCatalogService.js'
import strategiesService from '../api/services/strategiesService.js'
import { useAuth } from '../app/AuthProvider.jsx'
import VirtualList from '../components/VirtualList.jsx'
import '../styles/virtual-list.css'

export default function Bots() {
  const navigate = useNavigate()
  const { brokerStatus } = useAuth()
  const brokerConnected = Boolean(brokerStatus?.connected)
  const [catalog, setCatalog] = useState({ ruleBased: [], strategyBased: [] })
  const [bots, setBots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  const [filter, setFilter] = useState('all')

  const [platformStrategies, setPlatformStrategies] = useState([])
  const [platformLoading, setPlatformLoading] = useState(true)
  const [platformSort, setPlatformSort] = useState({ sort: 'totalPnl', order: 'desc' })

  // Calculate bot counts
  const runningCount = bots.filter((bot) => bot.enabled).length
  const stoppedCount = bots.filter((bot) => !bot.enabled && !bot.deletedAt).length
  const archivedCount = bots.filter((bot) => bot.deletedAt).length
  const pausedCount = bots.filter((bot) => !bot.enabled).length

  // Filter bots based on selected filter
  const filteredBots = filter === 'all'
    ? bots
    : filter === 'archived'
      ? bots.filter(bot => bot.deletedAt)
      : filter === 'running'
        ? bots.filter(bot => bot.enabled)
        : filter === 'stopped' || filter === 'paused'
          ? bots.filter(bot => !bot.enabled && !bot.deletedAt)
          : bots

  // Re-fetch platform strategies whenever sort changes
  useEffect(() => {
    setPlatformLoading(true)
    const loadPlatform = async () => {
      try {
        const data = await strategiesService.getPlatformStrategies(platformSort)
        setPlatformStrategies(Array.isArray(data) ? data : [])
      } catch {
        setPlatformStrategies([])
      } finally {
        setPlatformLoading(false)
      }
    }
    loadPlatform()
  }, [platformSort])

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        setError(null)

        const [catalogData, botsData] = await Promise.all([
          getBotCatalog(),
          getBots()
        ])

        setCatalog(catalogData)
        setBots(Array.isArray(botsData) ? botsData : [])
      } catch (error) {
        console.error('Failed to load data:', error)
        setError('Failed to load bots. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  // Check for success message from navigation
  useEffect(() => {
    if (window.history.state?.success) {
      setSuccessMessage(`Bot "${window.history.state.botName}" created successfully!`)
      // Clear the state after showing message
      setTimeout(() => setSuccessMessage(null), 5000)
      // Reload bots to show the new bot
      const loadBots = async () => {
        try {
          const botsData = await getBots()
          setBots(Array.isArray(botsData) ? botsData : [])
        } catch (error) {
          console.error('Failed to reload bots:', error)
        }
      }
      loadBots()
    }
  }, [])

  // Handle bot status toggle
  const handleStatusToggle = async (bot) => {
    try {
      await updateBot(bot.id, { enabled: !bot.enabled })
      // Refresh bots list
      const botsData = await getBots()
      setBots(Array.isArray(botsData) ? botsData : [])
    } catch (error) {
      console.error('Failed to update bot status:', error)
      setError('Failed to update bot status. Please try again.')
    }
  }

  // Handle bot deletion
  const handleDeleteBot = async (bot) => {
    if (window.confirm(`Delete bot "${bot.name}"? This will soft delete the bot but preserve all historical data.`)) {
      try {
        await deleteBot(bot.id)
        // Refresh bots list
        const botsData = await getBots()
        setBots(Array.isArray(botsData) ? botsData : [])
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

  return (
    <div className="l-page">
      <div className="container">
        <header className="stack-sm mb-6">
          {!brokerConnected && (
            <section className="alert alert-warn mb-5">
              <div className="alert-title">Broker Required</div>
              <div className="text-sm">Connect broker in Profile → Broker to start strategies and enable bots.</div>
            </section>
          )}

          {/* Error Display */}
          {error && (
            <section className="alert alert-error mb-5">
              <div className="alert-title">Error</div>
              <div className="text-sm">{error}</div>
            </section>
          )}

          {/* Filter Controls */}
          <div className="wrap">
            <button
              className={filter === 'all' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
              onClick={() => setFilter('all')}
            >
              {bots.length} Bots
            </button>
            <button
              className={filter === 'running' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
              onClick={() => setFilter('running')}
            >
              {runningCount} Running
            </button>
            <button
              className={filter === 'paused' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
              onClick={() => setFilter('paused')}
            >
              {pausedCount} Paused
            </button>
            <button
              className={filter === 'stopped' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
              onClick={() => setFilter('stopped')}
            >
              {stoppedCount} Stopped
            </button>
            <button
              className={filter === 'archived' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
              onClick={() => setFilter('archived')}
            >
              {archivedCount} Archived
            </button>
          </div>
        </header>

        {/* Quick Actions */}
        <section className="section">
          <div className="panel-header">
            <h2 className="panel-title">Quick Actions</h2>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => navigate('/templates')}
            >
              Browse Templates
            </button>
          </div>

          <div className="l-grid-auto-200">
            <article className="card card-pad-sm text-center">
              <div className="text-xl mb-2">Create Bot</div>
              <div className="muted text-sm mb-3">
                Start with a template or custom configuration
              </div>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => navigate('/bots/create')}
              >
                Create New Bot
              </button>
            </article>

            <article className="card card-pad-sm text-center">
              <div className="text-xl mb-2">View History</div>
              <div className="muted text-sm mb-3">
                Access complete trading records for all bots
              </div>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  // Navigate to history of first available bot
                  const firstBot = bots[0]
                  if (firstBot) navigate(`/bots/${firstBot.id}/history`)
                }}
                disabled={!bots.length}
              >
                View Bot History
              </button>
            </article>
          </div>
        </section>

        <section className="mb-6">
          <article className="card card-pad-md">
            <div className="panel-header">
              <h2 className="panel-title">
                {filter === 'all' ? 'My Bots' : `${filter.charAt(0).toUpperCase() + filter.slice(1)} Bots`}
                <span className="text-sm text-muted"> ({filteredBots.length})</span>
              </h2>
            </div>

            {loading ? (
              <div className="centered p-8 text-muted">
                <div className="text-lg mb-2">Loading bots...</div>
              </div>
            ) : filteredBots.length === 0 ? (
              <div className="centered p-8 text-muted">
                <div className="text-lg mb-2">No bots found</div>
                <div>No bots match the selected filter.</div>
              </div>
            ) : (
              <VirtualList
                items={filteredBots}
                itemHeight={120}
                containerHeight={Math.min(600, filteredBots.length * 120)}
                renderItem={(bot, index) => {
                  const status = getBotStatus(bot)
                  const badgeClass =
                    status === 'running'
                      ? 'badge badge-positive'
                      : status === 'archived'
                        ? 'badge badge-neutral'
                        : 'badge badge-warning'

                  const badgeLabel =
                    status === 'running'
                      ? 'Running'
                      : status === 'archived'
                        ? 'Archived'
                        : 'Paused'
                  return (
                    <div className="virtual-list-item">
                      <div className="row">
                        <div className="stack-sm flex-1">
                          <div className="hstack">
                            <h3 className="m-0 text-lg font-600">{bot.name}</h3>
                            <span className={badgeClass}>{badgeLabel}</span>
                          </div>
                          <div className="meta-row">
                            <span>Type: {bot.botType || 'rule_based'}</span>
                            <span>Portfolio: {bot.portfolioId}</span>
                            {bot.templateId && <span>Template: {bot.templateId}</span>}
                          </div>
                          <div className="text-sm text-muted">
                            {bot.config?.tickers?.join(', ') || 'No tickers'} | {bot.strategy?.name || bot.strategyId || 'No strategy'}
                          </div>
                        </div>
                        <div className="stack-sm">
                          <button
                            className="btn btn-xs btn-primary"
                            onClick={() => navigate(`/bots/${bot.id}`)}
                          >
                            View Details
                          </button>
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() => handleStatusToggle(bot)}
                          >
                            {status === 'running' ? 'Pause' : 'Start'}
                          </button>
                          <button
                            className="btn btn-xs btn-ghost text-negative"
                            onClick={() => handleDeleteBot(bot)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                }}
              />
            )}
          </article>
        </section>

        {/* Platform Bots */}
        <section className="mb-6">
          <article className="card card-pad-md">
            <div className="panel-header">
              <div className="stack-sm">
                <h2 className="panel-title m-0">Platform Bots</h2>
                <p className="muted text-sm m-0">All active strategies running site-wide. Aggregate P&amp;L only — no per-user data.</p>
              </div>
            </div>

            {platformLoading ? (
              <div className="centered p-8 text-muted">
                <div className="text-lg mb-2">Loading platform bots…</div>
              </div>
            ) : platformStrategies.length === 0 ? (
              <div className="centered p-8 text-muted">
                <div className="text-lg mb-2">No platform strategies found</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Strategy</th>
                      <th className="text-center">Status</th>
                      {[
                        { label: 'Subscribers', key: 'subscriberCount' },
                        { label: 'P&L',         key: 'totalPnl' },
                        { label: 'Avg P&L / Sub', key: 'avgPnlPerSubscriber' },
                        { label: 'Win Rate',    key: 'winRate' },
                        { label: 'Trades',      key: 'tradeCount' },
                      ].map(({ label, key }) => (
                        <th
                          key={key}
                          className="text-right"
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => setPlatformSort(s =>
                            s.sort === key
                              ? { sort: key, order: s.order === 'desc' ? 'asc' : 'desc' }
                              : { sort: key, order: 'desc' }
                          )}
                        >
                          {label}{' '}
                          {platformSort.sort === key ? (platformSort.order === 'desc' ? '↓' : '↑') : '↕'}
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {platformStrategies.map(s => {
                      const pnl = s.totalPnl
                      const avg = s.avgPnlPerSubscriber
                      const statusBadge = s.status === 'running' ? 'badge badge-positive' : 'badge badge-neutral'
                      return (
                        <tr key={s.id}>
                          <td>
                            <div className="font-600">{s.name}</div>
                            <div className="text-xs text-muted">{s.description}</div>
                          </td>
                          <td className="text-center">
                            <span className={statusBadge}>
                              {s.status === 'running' ? 'Running' : 'Stopped'}
                            </span>
                          </td>
                          <td className="text-right">{s.subscriberCount}</td>
                          <td className={`text-right font-600 ${pnl >= 0 ? 'text-positive' : 'text-negative'}`}>
                            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                          </td>
                          <td className={`text-right font-600 ${avg >= 0 ? 'text-positive' : 'text-negative'}`}>
                            {avg >= 0 ? '+' : ''}${avg.toFixed(2)}
                          </td>
                          <td className="text-right">{s.winRate.toFixed(0)}%</td>
                          <td className="text-right">{s.tradeCount}</td>
                          <td className="text-right">
                            <button
                              className="btn btn-xs btn-ghost"
                              onClick={() => navigate(`/strategies/${s.id}/history`)}
                            >
                              View History
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </section>

        {/* Success Message */}
        {successMessage && (
          <section className="alert alert-success mb-5">
            <div className="alert-title">Success!</div>
            <div className="text-sm">{successMessage}</div>
          </section>
        )}
      </div>
    </div>
  )
}
