import { useNavigate } from 'react-router-dom'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { getBotCatalog, getBots, deleteBot, updateBot } from '../api/services/botCatalogService.js'
import VirtualList from '../components/VirtualList.jsx'
import '../styles/virtual-list.css'

export default function Bots() {
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState({ ruleBased: [], strategyBased: [] })
  const [bots, setBots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)
  
  const [filter, setFilter] = useState('all')
  
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
          <h1 className="hero mb-2">Bots</h1>
          <p className="muted measure-md text-md mb-4">
            Manage your automated trading bots and view performance history
          </p>
          
          {/* Error Display */}
        {error && (
          <section className="alert alert-error mb-5">
            <div className="alert-title">Error</div>
            <div className="text-sm">{error}</div>
          </section>
        )}

          {/* Status Summary */}
          <div className="row text-sm mb-4">
            <span className="text-positive font-600">{runningCount} running</span>
            <span className="text-muted">{pausedCount} paused</span>
            <span className="text-negative font-600">{stoppedCount} stopped</span>
            <span className="text-muted">{archivedCount} archived</span>
            <span className="text-muted">· Total: {bots.length}</span>
          </div>
          
          {/* Filter Controls */}
          <div className="wrap">
            <button
              className={filter === 'all' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
              onClick={() => setFilter('all')}
            >
              All Bots
            </button>
            <button
              className={filter === 'running' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
              onClick={() => setFilter('running')}
            >
              Running
            </button>
            <button
              className={filter === 'paused' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
              onClick={() => setFilter('paused')}
            >
              Paused
            </button>
            <button
              className={filter === 'stopped' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
              onClick={() => setFilter('stopped')}
            >
              Stopped
            </button>
            <button
              className={filter === 'archived' ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
              onClick={() => setFilter('archived')}
            >
              Archived
            </button>
          </div>
        </header>

        <section className="mb-6">
          <article className="card card-pad-md">
            <div className="panel-header">
              <h2 className="panel-title">
                {filter === 'all' ? 'All Bots' : `${filter.charAt(0).toUpperCase() + filter.slice(1)} Bots`}
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
                      <div className="l-row">
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
                            {bot.asset} | {bot.strategy}
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

        {/* Success Message */}
        {successMessage && (
          <section className="alert alert-success mb-5">
            <div className="alert-title">Success!</div>
            <div className="text-sm">{successMessage}</div>
          </section>
        )}

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
      </div>
    </div>
  )
}
