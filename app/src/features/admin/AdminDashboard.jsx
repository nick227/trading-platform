import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../app/AuthProvider'
import {
  fetchAdminOverview,
  fetchAdminActivity,
  fetchAdminUsers,
  fetchAdminAuditLogs,
  fetchAdminBots,
  fetchAdminBotDetail,
  toggleAdminBot,
  fetchAdminExecutions,
  cancelAdminExecution,
  updateAdminUserRole,
  updateAdminUserStatus,
  fetchAdminUserDrilldown,
  setAdminEmergencyStop,
  runAdminMarketOpen,
  runAdminAiResearch,
  runAdminEvidenceSync,
  cleanupAdminWorkers,
  fetchAdminAiCycles,
  fetchAdminAiCycleDetail,
  fetchAdminAiDecisions,
  fetchAdminMarketDataDiagnostics,
  revalidateAdminMarketFeed
} from '../../api/adminClient'
import '../../styles/admin.css'

export default function AdminDashboard() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState('overview') // 'overview' | 'pipeline' | 'activity' | 'users' | 'controls'
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [feedback, setFeedback] = useState(null) // { type: 'success' | 'error', message: string }

  // Data states
  const [overview, setOverview] = useState(null)
  const [activity, setActivity] = useState([])
  const [activityTotal, setActivityTotal] = useState(0)
  const [activityPage, setActivityPage] = useState(0)
  const [users, setUsers] = useState([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [userSearch, setUserSearch] = useState('')
  const [userPage, setUserPage] = useState(0)
  const [auditLogs, setAuditLogs] = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(0)

  // Bot Fleet states
  const [bots, setBots] = useState([])
  const [botsTotal, setBotsTotal] = useState(0)
  const [botSearch, setBotSearch] = useState('')
  const [botStatusFilter, setBotStatusFilter] = useState('')
  const [botTypeFilter, setBotTypeFilter] = useState('')
  const [botPage, setBotPage] = useState(0)
  const [selectedBotDetail, setSelectedBotDetail] = useState(null)
  const [botDetailLoading, setBotDetailLoading] = useState(false)

  // Execution Blotter states
  const [executions, setExecutions] = useState([])
  const [executionsTotal, setExecutionsTotal] = useState(0)
  const [executionStatusFilter, setExecutionStatusFilter] = useState('')
  const [executionTickerFilter, setExecutionTickerFilter] = useState('')
  const [blotterPage, setBlotterPage] = useState(0)

  // User Support Drilldown states
  const [selectedUserDrilldown, setSelectedUserDrilldown] = useState(null)
  const [userDrilldownLoading, setUserDrilldownLoading] = useState(false)

  // AI Research & Decisions states
  const [aiCycles, setAiCycles] = useState([])
  const [aiCyclesTotal, setAiCyclesTotal] = useState(0)
  const [aiCyclesMetrics, setAiCyclesMetrics] = useState(null)
  const [aiCyclePage, setAiCyclePage] = useState(0)
  const [selectedAiCycleDetail, setSelectedAiCycleDetail] = useState(null)
  const [aiCycleDetailLoading, setAiCycleDetailLoading] = useState(false)
  const [aiDecisions, setAiDecisions] = useState([])
  const [aiDecisionsTotal, setAiDecisionsTotal] = useState(0)
  const [aiSymbolSearch, setAiSymbolSearch] = useState('')
  const [aiActionFilter, setAiActionFilter] = useState('')
  const [aiDecisionsPage, setAiDecisionsPage] = useState(0)

  // Market Data Diagnostics states
  const [marketDataDiagnostics, setMarketDataDiagnostics] = useState(null)
  const [revalidatingFeed, setRevalidatingFeed] = useState(false)

  // In-app Action Confirmation Dialog states (replacing window.prompt and window.confirm)
  const [actionDialog, setActionDialog] = useState(null)
  const [actionDialogInput, setActionDialogInput] = useState('')

  const showFeedback = (type, message) => {
    setFeedback({ type, message })
    // Automatically dismiss success notices after 6s, but keep errors persistent until operator dismisses
    if (type !== 'error') {
      setTimeout(() => setFeedback(null), 6000)
    }
  }

  const loadOverview = useCallback(async () => {
    try {
      const data = await fetchAdminOverview()
      setOverview(data)
    } catch (err) {
      showFeedback('error', `Failed to load admin overview: ${err.serverMessage || err.message}`)
    }
  }, [])

  const loadActivity = useCallback(async (page = 0) => {
    try {
      const data = await fetchAdminActivity({ limit: 20, offset: page * 20 })
      setActivity(data?.events || [])
      setActivityTotal(data?.total || 0)
      setActivityPage(page)
    } catch (err) {
      showFeedback('error', `Failed to load activity stream: ${err.serverMessage || err.message}`)
    }
  }, [])

  const loadUsers = useCallback(async (searchQuery = '', page = 0) => {
    try {
      const data = await fetchAdminUsers({ limit: 20, offset: page * 20, search: searchQuery })
      setUsers(data?.users || [])
      setUsersTotal(data?.total || 0)
      setUserPage(page)
    } catch (err) {
      showFeedback('error', `Failed to load users: ${err.serverMessage || err.message}`)
    }
  }, [])

  const loadAuditLogs = useCallback(async (page = 0) => {
    try {
      const data = await fetchAdminAuditLogs({ limit: 20, offset: page * 20 })
      setAuditLogs(data?.logs || [])
      setAuditTotal(data?.total || 0)
      setAuditPage(page)
    } catch (err) {
      showFeedback('error', `Failed to load audit trail: ${err.serverMessage || err.message}`)
    }
  }, [])

  const loadBots = useCallback(async (searchQuery = '', status = '', bType = '', page = 0) => {
    try {
      const data = await fetchAdminBots({
        limit: 20,
        offset: page * 20,
        search: searchQuery,
        status: status || null,
        botType: bType || null
      })
      setBots(data?.bots || [])
      setBotsTotal(data?.total || 0)
      setBotPage(page)
    } catch (err) {
      showFeedback('error', `Failed to load bot fleet: ${err.serverMessage || err.message}`)
    }
  }, [])

  const loadExecutions = useCallback(async (status = '', ticker = '', page = 0) => {
    try {
      const data = await fetchAdminExecutions({
        limit: 20,
        offset: page * 20,
        status: status || null,
        ticker: ticker || null
      })
      setExecutions(data?.executions || [])
      setExecutionsTotal(data?.total || 0)
      setBlotterPage(page)
    } catch (err) {
      showFeedback('error', `Failed to load order blotter: ${err.serverMessage || err.message}`)
    }
  }, [])

  const loadAiCycles = useCallback(async (page = 0) => {
    try {
      const data = await fetchAdminAiCycles({ limit: 20, offset: page * 20 })
      setAiCycles(data?.cycles || [])
      setAiCyclesTotal(data?.total || 0)
      setAiCyclesMetrics(data?.metrics || null)
      setAiCyclePage(page)
    } catch (err) {
      showFeedback('error', `Failed to load AI cycles: ${err.serverMessage || err.message}`)
    }
  }, [])

  const loadAiDecisions = useCallback(async (sym = '', act = '', page = 0) => {
    try {
      const data = await fetchAdminAiDecisions({
        symbol: sym || null,
        action: act || null,
        limit: 20,
        offset: page * 20
      })
      setAiDecisions(data?.decisions || [])
      setAiDecisionsTotal(data?.total || 0)
      setAiDecisionsPage(page)
    } catch (err) {
      showFeedback('error', `Failed to load AI decisions: ${err.serverMessage || err.message}`)
    }
  }, [])

  const handleInspectAiCycle = async (cycleId) => {
    setAiCycleDetailLoading(true)
    try {
      const data = await fetchAdminAiCycleDetail(cycleId)
      setSelectedAiCycleDetail(data)
    } catch (err) {
      showFeedback('error', `Failed to fetch AI cycle detail: ${err.serverMessage || err.message}`)
    } finally {
      setAiCycleDetailLoading(false)
    }
  }

  const loadMarketDataDiagnostics = useCallback(async (session = null) => {
    try {
      const data = await fetchAdminMarketDataDiagnostics({ session })
      setMarketDataDiagnostics(data)
    } catch (err) {
      showFeedback('error', `Failed to load market data diagnostics: ${err.serverMessage || err.message}`)
    }
  }, [])

  const handleRevalidateMarketFeed = async (session = null) => {
    setRevalidatingFeed(true)
    try {
      const res = await revalidateAdminMarketFeed({ session })
      setMarketDataDiagnostics(res)
      showFeedback('success', `Market data feed re-validated. Status: ${res?.status?.toUpperCase()} (${res?.summary?.healthy || 0}/${res?.summary?.total || 10} symbols healthy).`)
      await loadAuditLogs(auditPage)
    } catch (err) {
      showFeedback('error', `Market feed re-validation failed: ${err.serverMessage || err.message}`)
    } finally {
      setRevalidatingFeed(false)
    }
  }

  const refreshAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([
      loadOverview(),
      loadActivity(activityPage),
      loadUsers(userSearch, userPage),
      loadAuditLogs(auditPage),
      loadBots(botSearch, botStatusFilter, botTypeFilter, botPage),
      loadExecutions(executionStatusFilter, executionTickerFilter, blotterPage),
      loadAiCycles(aiCyclePage),
      loadAiDecisions(aiSymbolSearch, aiActionFilter, aiDecisionsPage),
      loadMarketDataDiagnostics()
    ])
    setLoading(false)
  }, [loadOverview, loadActivity, loadUsers, loadAuditLogs, loadBots, loadExecutions, loadAiCycles, loadAiDecisions, loadMarketDataDiagnostics, userSearch, userPage, botSearch, botStatusFilter, botTypeFilter, botPage, executionStatusFilter, executionTickerFilter, blotterPage, activityPage, auditPage, aiCyclePage, aiSymbolSearch, aiActionFilter, aiDecisionsPage])

  useEffect(() => {
    refreshAll()
    const timer = setInterval(() => {
      loadOverview()
      if (activeTab === 'blotter') {
        loadExecutions(executionStatusFilter, executionTickerFilter, blotterPage)
      } else if (activeTab === 'bots') {
        loadBots(botSearch, botStatusFilter, botTypeFilter, botPage)
      } else if (activeTab === 'users') {
        loadUsers(userSearch, userPage)
      } else if (activeTab === 'activity') {
        loadActivity(activityPage)
      } else if (activeTab === 'audit') {
        loadAuditLogs(auditPage)
      } else if (activeTab === 'ai_research') {
        loadAiCycles(aiCyclePage)
        loadAiDecisions(aiSymbolSearch, aiActionFilter, aiDecisionsPage)
      } else if (activeTab === 'pipeline') {
        loadMarketDataDiagnostics()
      }
    }, 15000) // Poll active tab dataset & overview every 15s
    return () => clearInterval(timer)
  }, [
    refreshAll,
    loadOverview,
    activeTab,
    loadExecutions,
    executionStatusFilter,
    executionTickerFilter,
    blotterPage,
    loadBots,
    botSearch,
    botStatusFilter,
    botTypeFilter,
    botPage,
    loadUsers,
    userSearch,
    userPage,
    loadActivity,
    activityPage,
    loadAuditLogs,
    auditPage,
    loadAiCycles,
    aiCyclePage,
    loadAiDecisions,
    aiSymbolSearch,
    aiActionFilter,
    aiDecisionsPage,
    loadMarketDataDiagnostics
  ])

  // Global ESC key listener to dismiss open inspection modals & action dialogs
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (!actionLoading) {
          setActionDialog(null)
        }
        setSelectedBotDetail(null)
        setSelectedUserDrilldown(null)
        setSelectedAiCycleDetail(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [actionLoading])

  // Operational Control Handlers
  const handleMarketOpen = async () => {
    setActionLoading(true)
    try {
      const res = await runAdminMarketOpen()
      showFeedback('success', 'Market open execution processed successfully.')
      await refreshAll()
    } catch (err) {
      showFeedback('error', `Market open failed: ${err.serverMessage || err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleAiResearch = async () => {
    setActionLoading(true)
    try {
      const res = await runAdminAiResearch()
      showFeedback('success', 'Autonomous AI research cycle initiated.')
      await refreshAll()
    } catch (err) {
      showFeedback('error', `AI research failed: ${err.serverMessage || err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleEvidenceSync = async () => {
    setActionLoading(true)
    try {
      const res = await runAdminEvidenceSync()
      showFeedback('success', 'Strategy evidence publication synchronized.')
      await refreshAll()
    } catch (err) {
      showFeedback('error', `Evidence sync failed: ${err.serverMessage || err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleCleanupWorkers = async () => {
    setActionLoading(true)
    try {
      const res = await cleanupAdminWorkers(10)
      showFeedback('success', `Pruned stale workers. Deleted: ${res?.result?.deleted ?? 0}`)
      await refreshAll()
    } catch (err) {
      showFeedback('error', `Worker cleanup failed: ${err.serverMessage || err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleToggleEmergencyStop = () => {
    const isCurrentlyActive = Boolean(overview?.emergencyStop?.active)
    setActionDialog({
      title: isCurrentlyActive ? 'Clear Platform Emergency Stop' : '🚨 Trigger Platform Emergency Stop',
      message: isCurrentlyActive
        ? 'Are you sure you want to clear the platform emergency stop and allow automated bot trading to resume?'
        : 'CRITICAL ACTION: This will immediately pause all platform bots and cancel active paper executions across all users.',
      confirmLabel: isCurrentlyActive ? 'Clear Stop & Resume' : 'ACTIVATE EMERGENCY STOP',
      confirmVariant: isCurrentlyActive ? 'primary' : 'danger',
      onConfirm: async () => {
        setActionLoading(true)
        try {
          await setAdminEmergencyStop({
            active: !isCurrentlyActive,
            reason: isCurrentlyActive ? 'Admin cleared stop' : 'Admin activated stop via dashboard'
          })
          showFeedback('success', `Emergency stop ${!isCurrentlyActive ? 'ACTIVATED' : 'CLEARED'}.`)
          await refreshAll()
        } catch (err) {
          showFeedback('error', `Emergency stop toggle failed: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
          setActionDialog(null)
        }
      }
    })
  }

  const handleRoleChange = async (targetUserId, newRole) => {
    try {
      await updateAdminUserRole(targetUserId, newRole)
      showFeedback('success', `Updated user role to '${newRole}'.`)
      await loadUsers(userSearch)
      await loadOverview()
      await loadAuditLogs()
    } catch (err) {
      showFeedback('error', `Failed to update role: ${err.serverMessage || err.message}`)
    }
  }

  const handleToggleUserStatus = (targetUserId, currentStatus, userEmail) => {
    const newStatus = currentStatus === 'suspended' ? 'active' : 'suspended'
    setActionDialog({
      title: newStatus === 'suspended' ? `Suspend Account: ${userEmail}` : `Reactivate Account: ${userEmail}`,
      message: newStatus === 'suspended'
        ? `Are you sure you want to SUSPEND ${userEmail}? The user will be immediately rejected with 403 Forbidden on all sessions and unable to place trades.`
        : `Reactivate account for ${userEmail} and restore platform access?`,
      confirmLabel: newStatus === 'suspended' ? 'Suspend Account' : 'Reactivate Account',
      confirmVariant: newStatus === 'suspended' ? 'danger' : 'primary',
      onConfirm: async () => {
        setActionLoading(true)
        try {
          await updateAdminUserStatus(targetUserId, newStatus)
          showFeedback('success', `Account status for ${userEmail} changed to '${newStatus}'.`)
          await loadUsers(userSearch)
          await loadOverview()
          await loadAuditLogs()
        } catch (err) {
          showFeedback('error', `Failed to update account status: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
          setActionDialog(null)
        }
      }
    })
  }

  const handleInspectUser = async (targetUserId) => {
    setUserDrilldownLoading(true)
    try {
      const res = await fetchAdminUserDrilldown(targetUserId)
      setSelectedUserDrilldown(res?.data || res)
    } catch (err) {
      showFeedback('error', `Failed to load user details: ${err.serverMessage || err.message}`)
    } finally {
      setUserDrilldownLoading(false)
    }
  }

  const handleToggleBot = (botId, currentEnabled, botName) => {
    const name = botName || botId
    setActionDialog({
      title: currentEnabled ? `Pause Bot: ${name}` : `Resume Bot: ${name}`,
      message: currentEnabled
        ? `Are you sure you want to PAUSE '${name}' (${botId})? Automated trade evaluations and order generations will be halted.`
        : `Resume automated trading operations for '${name}' (${botId})?`,
      confirmLabel: currentEnabled ? 'Pause Bot' : 'Resume Bot',
      confirmVariant: currentEnabled ? 'danger' : 'primary',
      onConfirm: async () => {
        setActionLoading(true)
        try {
          await toggleAdminBot(botId)
          showFeedback('success', `Bot successfully ${currentEnabled ? 'paused' : 'resumed'}.`)
          await loadBots(botSearch, botStatusFilter, botTypeFilter)
          await loadOverview()
          await loadAuditLogs()
        } catch (err) {
          showFeedback('error', `Failed to toggle bot: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
          setActionDialog(null)
        }
      }
    })
  }

  const handleInspectBot = async (botId) => {
    setBotDetailLoading(true)
    try {
      const res = await fetchAdminBotDetail(botId)
      setSelectedBotDetail(res?.data || res)
    } catch (err) {
      showFeedback('error', `Failed to fetch bot details: ${err.serverMessage || err.message}`)
    } finally {
      setBotDetailLoading(false)
    }
  }

  const handleCancelExecution = (executionId, ticker) => {
    setActionDialogInput('Admin manual cancellation from blotter')
    setActionDialog({
      title: `Cancel Order: ${ticker} (${executionId})`,
      message: `Provide a reason for administrative cancellation of pending order ${executionId}:`,
      showInput: true,
      inputPlaceholder: 'Reason for cancellation...',
      confirmLabel: 'Confirm Order Cancellation',
      confirmVariant: 'danger',
      onConfirm: async (reason) => {
        setActionLoading(true)
        try {
          await cancelAdminExecution(executionId, reason || 'Admin cancelled from blotter')
          showFeedback('success', `Execution ${executionId} cancelled successfully.`)
          await loadExecutions(executionStatusFilter, executionTickerFilter)
          await loadOverview()
          await loadAuditLogs()
        } catch (err) {
          showFeedback('error', `Failed to cancel execution: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
          setActionDialog(null)
        }
      }
    })
  }

  const pipeline = overview?.pipeline || {}
  const stages = pipeline?.stages || {}
  const metrics = overview || {}

  return (
    <div className="tl-admin-container">
      {/* Dashboard Top Header */}
      <header className="tl-admin-header">
        <div className="tl-admin-title-area">
          <h1>
            Platform Administration
            {overview?.emergencyStop?.active ? (
              <span className="tl-admin-badge tl-badge-red">Emergency Stop Active</span>
            ) : (
              <span className="tl-admin-badge tl-badge-green">Engine Operational</span>
            )}
            <span className="tl-admin-badge tl-badge-purple">Simulated Broker</span>
          </h1>
          <p className="tl-admin-subtitle">
            Autonomous AI Paper Trading Telemetry, Fleet Oversight, and Operational Controls
          </p>
        </div>
        <div className="tl-admin-header-actions">
          <button
            className="tl-btn-secondary"
            onClick={refreshAll}
            disabled={loading || actionLoading}
          >
            {loading ? 'Refreshing...' : '↻ Refresh Telemetry'}
          </button>
          {isAdmin && (
            <button
              className={overview?.emergencyStop?.active ? 'tl-btn-primary' : 'tl-btn-danger'}
              onClick={handleToggleEmergencyStop}
              disabled={actionLoading}
            >
              {overview?.emergencyStop?.active ? 'Clear Emergency Stop' : '🚨 Trigger Emergency Stop'}
            </button>
          )}
        </div>
      </header>

      {/* Global Feedback Banner */}
      {feedback && (
        <div className={`tl-feedback-banner ${feedback.type === 'error' ? 'tl-feedback-error' : 'tl-feedback-success'}`}>
          <span>{feedback.message}</span>
          <button
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1.1rem' }}
            onClick={() => setFeedback(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="tl-admin-tabs">
        <button
          className={`tl-admin-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Bird's Eye Overview
        </button>
        <button
          className={`tl-admin-tab ${activeTab === 'bots' ? 'active' : ''}`}
          onClick={() => setActiveTab('bots')}
        >
          Bot Fleet ({botsTotal})
        </button>
        <button
          className={`tl-admin-tab ${activeTab === 'blotter' ? 'active' : ''}`}
          onClick={() => setActiveTab('blotter')}
        >
          Order Blotter ({executionsTotal})
        </button>
        <button
          className={`tl-admin-tab ${activeTab === 'pipeline' ? 'active' : ''}`}
          onClick={() => setActiveTab('pipeline')}
        >
          AI Pipeline Monitor
        </button>
        <button
          className={`tl-admin-tab ${activeTab === 'ai_research' ? 'active' : ''}`}
          onClick={() => setActiveTab('ai_research')}
        >
          AI Research & Decisions ({aiCyclesTotal})
        </button>
        <button
          className={`tl-admin-tab ${activeTab === 'controls' ? 'active' : ''}`}
          onClick={() => setActiveTab('controls')}
        >
          Operational Controls
        </button>
        <button
          className={`tl-admin-tab ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          User Accounts & Roles ({usersTotal})
        </button>
        <button
          className={`tl-admin-tab ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          Audit Trail ({auditTotal})
        </button>
        <button
          className={`tl-admin-tab ${activeTab === 'activity' ? 'active' : ''}`}
          onClick={() => setActiveTab('activity')}
        >
          Live Activity Stream ({activityTotal})
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div>
          {/* Key Metrics Grid */}
          <div className="tl-admin-grid">
            <div className="tl-admin-card">
              <div className="tl-admin-card-header">
                <span>User Population</span>
                <span className="tl-admin-badge tl-badge-blue">Accounts</span>
              </div>
              <div className="tl-admin-card-value">{metrics?.users?.total ?? '—'}</div>
              <div className="tl-admin-card-meta">
                <span>Active subs: <strong>{metrics?.users?.activeSubscriptions ?? 0}</strong></span>
                <span>Admins: <strong>{metrics?.users?.byRole?.admin ?? 0}</strong></span>
                <span>Operators: <strong>{metrics?.users?.byRole?.operator ?? 0}</strong></span>
              </div>
            </div>

            <div className="tl-admin-card">
              <div className="tl-admin-card-header">
                <span>Bot Fleet</span>
                <span className="tl-admin-badge tl-badge-green">Running</span>
              </div>
              <div className="tl-admin-card-value">{metrics?.bots?.enabled ?? '—'} <span style={{ fontSize: '1rem', color: '#64748b' }}>/ {metrics?.bots?.total ?? '—'}</span></div>
              <div className="tl-admin-card-meta">
                <span>AI Bots: <strong>{metrics?.bots?.ai ?? 0}</strong></span>
                <span>Rule Bots: <strong>{metrics?.bots?.rule ?? 0}</strong></span>
                <span>Paused: <strong>{metrics?.bots?.paused ?? 0}</strong></span>
              </div>
            </div>

            <div className="tl-admin-card">
              <div className="tl-admin-card-header">
                <span>Execution Queue</span>
                <span className="tl-admin-badge tl-badge-purple">Fills</span>
              </div>
              <div className="tl-admin-card-value">${Number(metrics?.executions?.filledNotional ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="tl-admin-card-meta">
                <span>Filled: <strong>{metrics?.executions?.filled ?? 0}</strong></span>
                <span>Queued: <strong>{metrics?.executions?.queued ?? 0}</strong></span>
                <span>Pending Fill: <strong>{metrics?.executions?.pending_fill ?? 0}</strong></span>
              </div>
            </div>

            <div className="tl-admin-card">
              <div className="tl-admin-card-header">
                <span>Worker Status</span>
                <span className="tl-admin-badge tl-badge-blue">Infrastructure</span>
              </div>
              <div className="tl-admin-card-value">{metrics?.workers?.activeCount ?? 0} <span style={{ fontSize: '1rem', color: '#64748b' }}>active</span></div>
              <div className="tl-admin-card-meta">
                <span>Avg queue lag: <strong>{metrics?.workers?.avgQueueLagMs ?? 0}ms</strong></span>
                <span>Stale workers: <strong>{metrics?.workers?.staleCount ?? 0}</strong></span>
              </div>
            </div>
          </div>

          {/* Quick Autonomous Status Preview */}
          <div className="tl-pipeline-widget">
            <div className="tl-pipeline-header">
              <div>
                <h3 style={{ margin: '0 0 0.25rem 0' }}>Autonomous AI Strategy Lifecycle</h3>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  Target: <code>tmpl_ai_catalyst_momentum</code> | Bot: <code>bot_canonical_ai_catalyst_momentum</code>
                </span>
              </div>
              <button
                className="tl-btn-secondary"
                onClick={() => setActiveTab('pipeline')}
                style={{ fontSize: '0.8rem' }}
              >
                Inspect Pipeline Details →
              </button>
            </div>

            {pipeline?.isTodayTradingDay === false && (
              <div style={{
                background: 'rgba(59, 130, 246, 0.12)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                borderRadius: '8px',
                padding: '0.85rem 1.25rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.85rem'
              }}>
                <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>🏛️</span>
                <div>
                  <div style={{ fontWeight: 600, color: '#93c5fd', fontSize: '0.9rem' }}>
                    US Exchanges Closed Today (Market Holiday / Weekend)
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                    Scheduled daily ingestion, AI research, and fills are paused. Last completed session evaluated: <strong>{pipeline.expectedCompletedSession || '—'}</strong>. Next-open orders remain staged for the next trading session.
                  </div>
                </div>
              </div>
            )}

            <div className="tl-pipeline-stages">
              {[
                { key: 'market_data_ingestion', title: '1. Ingestion' },
                { key: 'pending_order_execution', title: '2. Open Fills' },
                { key: 'ai_research_decision', title: '3. AI Research' },
                { key: 'portfolio_valuation', title: '4. Valuation' },
                { key: 'strategy_evidence_publication', title: '5. Evidence' }
              ].map(st => {
                const sData = stages[st.key]
                const status = sData?.status || 'pending'
                const badgeClass = status === 'ok' ? 'tl-badge-green' : status === 'failed' ? 'tl-badge-red' : 'tl-badge-amber'
                return (
                  <div key={st.key} className="tl-pipeline-stage-card">
                    <div className="tl-pipeline-stage-title">{st.title}</div>
                    <div className="tl-pipeline-stage-status">
                      <span className={`tl-admin-badge ${badgeClass}`}>{status}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {sData?.session ? `Session: ${sData.session}` : 'Awaiting cycle'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Infrastructure Worker Fleet Table */}
          <div className="tl-admin-table-wrapper">
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Active Worker Fleet & Heartbeats</h3>
              {isAdmin && (
                <button
                  className="tl-btn-secondary"
                  onClick={handleCleanupWorkers}
                  disabled={actionLoading}
                  style={{ fontSize: '0.8rem' }}
                >
                  Prune Stale Workers
                </button>
              )}
            </div>
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Worker ID / Host</th>
                  <th>Status</th>
                  <th>Queue Lag</th>
                  <th>Started At</th>
                  <th>Last Heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {metrics?.workers?.list && metrics.workers.list.length > 0 ? (
                  metrics.workers.list.map(w => (
                    <tr key={w.id}>
                      <td><code>{w.id}</code></td>
                      <td>
                        {w.isActive ? (
                          <span className="tl-admin-badge tl-badge-green">Active</span>
                        ) : (
                          <span className="tl-admin-badge tl-badge-amber">Stale</span>
                        )}
                      </td>
                      <td>{w.queueLagMs != null ? `${w.queueLagMs} ms` : '—'}</td>
                      <td>{new Date(w.startedAt).toLocaleString()}</td>
                      <td>{new Date(w.lastSeen).toLocaleString()}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                      No registered worker nodes currently active.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: BOT FLEET */}
      {activeTab === 'bots' && (
        <div>
          {/* Filter Bar */}
          <div className="tl-admin-toolbar" style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search by bot name or ID..."
              className="tl-admin-input"
              style={{ flex: '1 1 200px' }}
              value={botSearch}
              onChange={(e) => setBotSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') loadBots(botSearch, botStatusFilter, botTypeFilter, 0)
              }}
            />
            <select
              className="tl-admin-select"
              value={botStatusFilter}
              onChange={(e) => {
                setBotStatusFilter(e.target.value)
                loadBots(botSearch, e.target.value, botTypeFilter, 0)
              }}
            >
              <option value="">All Statuses</option>
              <option value="active">Active / Running</option>
              <option value="paused">Paused</option>
            </select>
            <select
              className="tl-admin-select"
              value={botTypeFilter}
              onChange={(e) => {
                setBotTypeFilter(e.target.value)
                loadBots(botSearch, botStatusFilter, e.target.value, 0)
              }}
            >
              <option value="">All Types</option>
              <option value="ai">AI Strategies</option>
              <option value="rule">Rule Engine</option>
            </select>
            <button
              className="tl-btn-secondary"
              onClick={() => loadBots(botSearch, botStatusFilter, botTypeFilter, 0)}
            >
              Search
            </button>
          </div>

          {/* Bot Fleet Table */}
          <div className="tl-admin-table-wrapper">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Bot / Template</th>
                  <th>Type</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Portfolio Equity</th>
                  <th>Filled Trades</th>
                  <th>Last Event</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bots.length > 0 ? (
                  bots.map(b => {
                    const isAi = b.botType?.includes('ai') || b.templateId?.startsWith('tmpl_ai_')
                    return (
                      <tr key={b.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{b.name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            <code>{b.id}</code> {b.templateId ? `· ${b.templateId}` : ''}
                          </div>
                        </td>
                        <td>
                          <span className={`tl-admin-badge ${isAi ? 'tl-badge-purple' : 'tl-badge-blue'}`}>
                            {isAi ? 'AI Strategy' : 'Rule Engine'}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{b.user?.fullName || '—'}</div>
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{b.user?.email || b.userId}</div>
                        </td>
                        <td>
                          <span className={`tl-admin-badge ${b.enabled ? 'tl-badge-green' : 'tl-badge-red'}`}>
                            {b.enabled ? 'Running' : 'Paused'}
                          </span>
                        </td>
                        <td>
                          {b.portfolio ? (
                            <div>
                              <div style={{ fontWeight: 600 }}>
                                ${Number(b.portfolio.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                Cash: ${Number(b.portfolio.cashBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                            </div>
                          ) : '—'}
                        </td>
                        <td style={{ fontWeight: 600 }}>{b.filledExecutionsCount ?? 0}</td>
                        <td>
                          {b.lastEvent ? (
                            <div>
                              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#cbd5e1' }}>
                                {b.lastEvent.type}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                {new Date(b.lastEvent.createdAt).toLocaleString()}
                              </div>
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>No recent events</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              className="tl-btn-secondary"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                              onClick={() => handleInspectBot(b.id)}
                              disabled={botDetailLoading}
                            >
                              Inspect
                            </button>
                            {isAdmin && (
                              <button
                                className={b.enabled ? 'tl-btn-danger' : 'tl-btn-primary'}
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                onClick={() => handleToggleBot(b.id, b.enabled, b.name)}
                                disabled={actionLoading}
                              >
                                {b.enabled ? 'Pause' : 'Resume'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                      No bots found matching criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="tl-admin-pagination">
              <span className="tl-admin-pagination-info">
                Showing {botsTotal > 0 ? botPage * 20 + 1 : 0}–{Math.min((botPage + 1) * 20, botsTotal)} of {botsTotal} bots
              </span>
              <div className="tl-admin-pagination-actions">
                <button
                  className="tl-admin-pagination-btn"
                  disabled={botPage === 0}
                  onClick={() => loadBots(botSearch, botStatusFilter, botTypeFilter, botPage - 1)}
                >
                  ◀ Previous
                </button>
                <button
                  className="tl-admin-pagination-btn"
                  disabled={(botPage + 1) * 20 >= botsTotal}
                  onClick={() => loadBots(botSearch, botStatusFilter, botTypeFilter, botPage + 1)}
                >
                  Next ▶
                </button>
              </div>
            </div>
          </div>

          {/* Bot Inspection Modal / Drawer */}
          {selectedBotDetail && (
            <div
              className="tl-modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Bot Inspector"
              onClick={(e) => {
                if (e.target === e.currentTarget) setSelectedBotDetail(null)
              }}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.75)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '1.5rem'
              }}
            >
              <div style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                width: '100%',
                maxWidth: '850px',
                maxHeight: '90vh',
                overflowY: 'auto',
                padding: '1.5rem',
                color: '#f8fafc'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #334155', paddingBottom: '0.75rem' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                      Bot Inspector: {selectedBotDetail.bot?.name}
                    </h2>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      ID: <code>{selectedBotDetail.bot?.id}</code> | Owner: {selectedBotDetail.user?.email}
                    </span>
                  </div>
                  <button
                    className="tl-btn-secondary"
                    onClick={() => setSelectedBotDetail(null)}
                    style={{ fontSize: '1rem', padding: '0.25rem 0.6rem' }}
                  >
                    ✕
                  </button>
                </div>

                {/* Bot Quick Summary */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Status</div>
                    <div style={{ fontWeight: 600, color: selectedBotDetail.bot?.enabled ? '#4ade80' : '#f87171' }}>
                      {selectedBotDetail.bot?.enabled ? 'Running' : 'Paused'}
                    </div>
                  </div>
                  <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Portfolio Total Value</div>
                    <div style={{ fontWeight: 600 }}>
                      ${Number(selectedBotDetail.portfolio?.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Available Cash</div>
                    <div style={{ fontWeight: 600 }}>
                      ${Number(selectedBotDetail.portfolio?.cashBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Template</div>
                    <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>
                      {selectedBotDetail.bot?.templateId || 'Custom'}
                    </div>
                  </div>
                </div>

                {/* Configuration JSON */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#cbd5e1' }}>Configuration Snapshot</h4>
                  <pre style={{
                    background: '#0f172a',
                    padding: '0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    maxHeight: '160px',
                    overflowY: 'auto'
                  }}>
                    {JSON.stringify(selectedBotDetail.bot?.config, null, 2)}
                  </pre>
                </div>

                {/* Recent Executions */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#cbd5e1' }}>Recent Executions</h4>
                  {selectedBotDetail.recentExecutions?.length > 0 ? (
                    <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                      <table className="tl-admin-table" style={{ fontSize: '0.75rem' }}>
                        <thead>
                          <tr>
                            <th>Ticker</th>
                            <th>Direction</th>
                            <th>Qty</th>
                            <th>Status</th>
                            <th>Filled Price</th>
                            <th>Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedBotDetail.recentExecutions.map(e => (
                            <tr key={e.id}>
                              <td style={{ fontWeight: 600 }}>{e.ticker}</td>
                              <td><span className={`tl-admin-badge ${e.direction === 'buy' ? 'tl-badge-green' : 'tl-badge-red'}`}>{e.direction}</span></td>
                              <td>{e.quantity}</td>
                              <td><span className="tl-admin-badge tl-badge-blue">{e.status}</span></td>
                              <td>{e.filledPrice ? `$${Number(e.filledPrice).toFixed(2)}` : '—'}</td>
                              <td>{new Date(e.createdAt).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>No executions recorded for this bot.</p>
                  )}
                </div>

                {/* Recent Bot Events */}
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#cbd5e1' }}>Recent Event Stream</h4>
                  {selectedBotDetail.recentEvents?.length > 0 ? (
                    <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                      <table className="tl-admin-table" style={{ fontSize: '0.75rem' }}>
                        <thead>
                          <tr>
                            <th>Timestamp</th>
                            <th>Event Type</th>
                            <th>Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedBotDetail.recentEvents.map(ev => (
                            <tr key={ev.id}>
                              <td style={{ whiteSpace: 'nowrap', color: '#94a3b8' }}>{new Date(ev.createdAt).toLocaleString()}</td>
                              <td><code>{ev.type}</code></td>
                              <td>{ev.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>No recent events recorded.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PIPELINE MONITOR */}
      {activeTab === 'pipeline' && (
        <div>
          <div className="tl-pipeline-widget">
            <h3 style={{ margin: '0 0 1rem 0' }}>Autonomous Pipeline Stage Health</h3>

            {pipeline?.isTodayTradingDay === false && (
              <div style={{
                background: 'rgba(59, 130, 246, 0.12)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                borderRadius: '8px',
                padding: '0.85rem 1.25rem',
                marginBottom: '1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.85rem'
              }}>
                <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>🏛️</span>
                <div>
                  <div style={{ fontWeight: 600, color: '#93c5fd', fontSize: '0.95rem' }}>
                    US Equity Exchanges Closed Today (Exchange Holiday / Weekend)
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                    The market calendar has detected that today is an official exchange holiday or weekend. Autonomous lifecycle jobs will not advance until the next regular market open session.
                  </div>
                </div>
              </div>
            )}

            <div className="tl-pipeline-stages" style={{ marginBottom: '1.5rem' }}>
              {[
                { key: 'market_data_ingestion', title: '1. Market Data Ingestion' },
                { key: 'pending_order_execution', title: '2. Next-Open Execution' },
                { key: 'ai_research_decision', title: '3. GPT-4o-mini Research' },
                { key: 'portfolio_valuation', title: '4. Portfolio Accounting' },
                { key: 'strategy_evidence_publication', title: '5. Public Evidence' }
              ].map(st => {
                const sData = stages[st.key]
                const status = sData?.status || 'pending'
                const badgeClass = status === 'ok' ? 'tl-badge-green' : status === 'failed' ? 'tl-badge-red' : 'tl-badge-amber'
                return (
                  <div key={st.key} className="tl-pipeline-stage-card">
                    <div className="tl-pipeline-stage-title">{st.title}</div>
                    <div className="tl-pipeline-stage-status">
                      <span className={`tl-admin-badge ${badgeClass}`}>{status}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                      {sData?.session ? `Session: ${sData.session}` : 'Pending'}
                    </div>
                    {sData?.details && (
                      <div style={{ fontSize: '0.75rem', color: '#64748b', wordBreak: 'break-word' }}>
                        {typeof sData.details === 'object' ? JSON.stringify(sData.details) : String(sData.details)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Pipeline Balances & Accounting */}
            {pipeline?.accounting && (
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '8px',
                padding: '1.25rem'
              }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem' }}>
                  Canonical Paper Portfolio Accounting (FIFO)
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Cash Balance</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                      ${Number(pipeline.accounting.cash || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Holdings Value</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                      ${Number(pipeline.accounting.holdingsValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Total Equity</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#38bdf8' }}>
                      ${Number(pipeline.accounting.totalEquity || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Unrealized P&L</span>
                    <div style={{
                      fontSize: '1.2rem',
                      fontWeight: 'bold',
                      color: Number(pipeline.accounting.unrealizedPnl || 0) >= 0 ? '#34d399' : '#f87171'
                    }}>
                      ${Number(pipeline.accounting.unrealizedPnl || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Universe Ticker Feed Diagnostics Matrix */}
            <div className="tl-admin-table-wrapper" style={{ marginTop: '1.5rem' }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1rem' }}>
                    10-Symbol Universe Market Data Feed Diagnostics
                    {marketDataDiagnostics?.status && (
                      <span className={`tl-admin-badge ${marketDataDiagnostics.status === 'healthy' ? 'tl-badge-green' : 'tl-badge-amber'}`} style={{ marginLeft: '0.5rem' }}>
                        {marketDataDiagnostics.status === 'healthy' ? 'Feed Healthy (10/10)' : `Feed Degraded (${marketDataDiagnostics.summary?.healthy || 0}/10)`}
                      </span>
                    )}
                  </h4>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    Target Session: <strong>{marketDataDiagnostics?.session || 'Current Expected'}</strong> · Source: <code>alpha-engine</code> (Point-in-Time Adjusted Bars)
                  </span>
                </div>
                {isAdmin && (
                  <button
                    className="tl-btn-secondary"
                    style={{ fontSize: '0.8rem' }}
                    onClick={() => handleRevalidateMarketFeed(marketDataDiagnostics?.session)}
                    disabled={revalidatingFeed || actionLoading}
                  >
                    {revalidatingFeed ? 'Re-validating Feeds...' : '↻ Re-validate Universe Feeds'}
                  </button>
                )}
              </div>
              <table className="tl-admin-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Feed Health</th>
                    <th>Latest Bar Session</th>
                    <th>Open / Close Price</th>
                    <th>High / Low Range</th>
                    <th>Volume</th>
                    <th>Historical Bars</th>
                    <th>Diagnostics / Anomalies</th>
                  </tr>
                </thead>
                <tbody>
                  {marketDataDiagnostics?.symbols?.length > 0 ? (
                    marketDataDiagnostics.symbols.map(s => {
                      const statusBadge = s.status === 'healthy' ? 'tl-badge-green' : s.status === 'stale' ? 'tl-badge-amber' : 'tl-badge-red'
                      return (
                        <tr key={s.symbol}>
                          <td><strong>{s.symbol}</strong></td>
                          <td>
                            <span className={`tl-admin-badge ${statusBadge}`}>
                              {s.status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                            {s.session || '—'}
                          </td>
                          <td>
                            <div>Close: {s.close != null ? `$${s.close.toFixed(2)}` : '—'}</div>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                              Open: {s.open != null ? `$${s.open.toFixed(2)}` : '—'}
                            </div>
                          </td>
                          <td style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                            {s.high != null && s.low != null ? `$${s.low.toFixed(2)} – $${s.high.toFixed(2)}` : '—'}
                          </td>
                          <td style={{ fontWeight: 500, fontSize: '0.8rem' }}>
                            {s.volume != null ? Number(s.volume).toLocaleString() : '—'}
                          </td>
                          <td>
                            <span style={{ color: s.barsCount >= 20 ? '#4ade80' : '#f87171', fontWeight: 600, fontSize: '0.8rem' }}>
                              {s.barsCount} bars
                            </span>
                          </td>
                          <td>
                            {s.reason ? (
                              <span style={{ fontSize: '0.75rem', color: '#f87171' }}>{s.reason}</span>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: '#4ade80' }}>Sound · Zero Leakage</span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                        Loading universe market data feed telemetry...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: AI RESEARCH & DECISIONS EXPLAINABILITY INSPECTOR */}
      {activeTab === 'ai_research' && (
        <div>
          {/* AI Metrics Grid */}
          <div className="tl-ai-metrics-grid">
            <div className="tl-ai-metric-card">
              <div className="tl-ai-metric-label">Autonomous AI Model</div>
              <div className="tl-ai-metric-value" style={{ fontSize: '1.1rem', color: '#c084fc' }}>
                {aiCyclesMetrics?.latestModel || 'gpt-4o-mini-2024-07-18'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                Provider: OpenAI Structured Outputs
              </div>
            </div>
            <div className="tl-ai-metric-card">
              <div className="tl-ai-metric-label">Completed Research Cycles</div>
              <div className="tl-ai-metric-value" style={{ color: '#38bdf8' }}>
                {aiCyclesTotal}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                Daily 10-Symbol Point-in-Time Runs
              </div>
            </div>
            <div className="tl-ai-metric-card">
              <div className="tl-ai-metric-label">Total Token Spend ($)</div>
              <div className="tl-ai-metric-value" style={{ color: '#4ade80' }}>
                ${Number(aiCyclesMetrics?.totalCostUsd || 0).toFixed(5)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                {Number(aiCyclesMetrics?.totalTokens || 0).toLocaleString()} Total Tokens
              </div>
            </div>
          </div>

          {/* Research Cycles Table */}
          <div className="tl-admin-table-wrapper" style={{ marginBottom: '2rem' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Autonomous AI Research Cycles</h3>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  Daily point-in-time LLM market regime analysis and multi-symbol evaluations
                </span>
              </div>
              <button
                className="tl-btn-secondary"
                style={{ fontSize: '0.8rem' }}
                onClick={() => loadAiCycles(aiCyclePage)}
              >
                ↻ Refresh Cycles
              </button>
            </div>
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Observation Session</th>
                  <th>Execution Session</th>
                  <th>Observation Mode</th>
                  <th>Macro Regime Summary</th>
                  <th>Symbol Decisions</th>
                  <th>Model / Cost</th>
                  <th>Explainability Actions</th>
                </tr>
              </thead>
              <tbody>
                {aiCycles.length > 0 ? (
                  aiCycles.map(c => (
                    <tr key={c.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                        {c.session || '—'}
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          {new Date(c.createdAt).toLocaleTimeString()}
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <code>{c.intendedSession || 'Next Open'}</code>
                      </td>
                      <td>
                        <span className={`tl-admin-badge ${c.isReplay ? 'tl-badge-amber' : 'tl-badge-green'}`}>
                          {c.isReplay ? 'Replay' : 'Forward Live'}
                        </span>
                      </td>
                      <td>
                        <div style={{ maxWidth: '300px', fontSize: '0.8rem', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.marketSummary || '—'}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <span className="tl-admin-badge tl-badge-green">{c.decisionCounts?.buy ?? 0} BUY</span>
                          <span className="tl-admin-badge tl-badge-amber">{c.decisionCounts?.hold ?? 0} HOLD</span>
                          <span className="tl-admin-badge tl-badge-red">{c.decisionCounts?.sell ?? 0} SELL</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>{c.model}</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          ${Number(c.estimatedCostUsd || 0).toFixed(5)} ({c.usage?.total_tokens || 0} tok)
                        </div>
                      </td>
                      <td>
                        <button
                          className="tl-btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => handleInspectAiCycle(c.id)}
                          disabled={aiCycleDetailLoading}
                        >
                          Inspect Decisions & Theses
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                      No AI research cycles recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="tl-admin-pagination">
              <span className="tl-admin-pagination-info">
                Showing {aiCyclesTotal > 0 ? aiCyclePage * 20 + 1 : 0}–{Math.min((aiCyclePage + 1) * 20, aiCyclesTotal)} of {aiCyclesTotal} research cycles
              </span>
              <div className="tl-admin-pagination-actions">
                <button
                  className="tl-admin-pagination-btn"
                  disabled={aiCyclePage === 0}
                  onClick={() => loadAiCycles(aiCyclePage - 1)}
                >
                  ◀ Previous
                </button>
                <button
                  className="tl-admin-pagination-btn"
                  disabled={(aiCyclePage + 1) * 20 >= aiCyclesTotal}
                  onClick={() => loadAiCycles(aiCyclePage + 1)}
                >
                  Next ▶
                </button>
              </div>
            </div>
          </div>

          {/* Symbol-Level Decisions Search & Explorer */}
          <div className="tl-admin-table-wrapper">
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>Historical Symbol Decisions & Explainability</h3>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Filter by ticker (e.g. AAPL)..."
                  className="tl-admin-input"
                  style={{ flex: '1 1 180px' }}
                  value={aiSymbolSearch}
                  onChange={(e) => setAiSymbolSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') loadAiDecisions(aiSymbolSearch, aiActionFilter, 0)
                  }}
                />
                <select
                  className="tl-admin-select"
                  value={aiActionFilter}
                  onChange={(e) => {
                    setAiActionFilter(e.target.value)
                    loadAiDecisions(aiSymbolSearch, e.target.value, 0)
                  }}
                >
                  <option value="">All Actions</option>
                  <option value="BUY">BUY Only</option>
                  <option value="HOLD">HOLD Only</option>
                  <option value="SELL">SELL Only</option>
                </select>
                <button
                  className="tl-btn-secondary"
                  onClick={() => loadAiDecisions(aiSymbolSearch, aiActionFilter, 0)}
                >
                  Search Decisions
                </button>
              </div>
            </div>
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Symbol</th>
                  <th>Action</th>
                  <th>Confidence</th>
                  <th>Exit Rules (SL / TP / Time)</th>
                  <th>Model Thesis & Analytical Chain of Thought</th>
                </tr>
              </thead>
              <tbody>
                {aiDecisions.length > 0 ? (
                  aiDecisions.map((d, idx) => {
                    const actionClass = d.action === 'BUY' ? 'tl-badge-green' : d.action === 'SELL' ? 'tl-badge-red' : 'tl-badge-amber'
                    return (
                      <tr key={`${d.cycleId}-${d.symbol}-${idx}`}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem', color: '#94a3b8' }}>
                          {d.session}
                        </td>
                        <td>
                          <strong>{d.symbol}</strong>
                        </td>
                        <td>
                          <span className={`tl-admin-badge ${actionClass}`}>
                            {d.action}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{Math.round((d.confidence || 0) * 100)}%</span>
                        </td>
                        <td style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          {d.exitRule?.stopLossPct ? (
                            <div>SL: -{d.exitRule.stopLossPct}% · TP: +{d.exitRule.takeProfitPct}% · {d.exitRule.timeStopDays}d</div>
                          ) : '—'}
                        </td>
                        <td style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: '1.4' }}>
                          {d.thesis}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                      No symbol decisions found matching filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="tl-admin-pagination">
              <span className="tl-admin-pagination-info">
                Showing {aiDecisionsTotal > 0 ? aiDecisionsPage * 20 + 1 : 0}–{Math.min((aiDecisionsPage + 1) * 20, aiDecisionsTotal)} of {aiDecisionsTotal} decisions
              </span>
              <div className="tl-admin-pagination-actions">
                <button
                  className="tl-admin-pagination-btn"
                  disabled={aiDecisionsPage === 0}
                  onClick={() => loadAiDecisions(aiSymbolSearch, aiActionFilter, aiDecisionsPage - 1)}
                >
                  ◀ Previous
                </button>
                <button
                  className="tl-admin-pagination-btn"
                  disabled={(aiDecisionsPage + 1) * 20 >= aiDecisionsTotal}
                  onClick={() => loadAiDecisions(aiSymbolSearch, aiActionFilter, aiDecisionsPage + 1)}
                >
                  Next ▶
                </button>
              </div>
            </div>
          </div>

          {/* CYCLE EXPLAINABILITY MODAL */}
          {selectedAiCycleDetail && (
            <div
              className="tl-modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="AI Decision Explainability Inspector"
              onClick={(e) => {
                if (e.target === e.currentTarget) setSelectedAiCycleDetail(null)
              }}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.75)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '1.5rem'
              }}
            >
              <div style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                width: '100%',
                maxWidth: '900px',
                maxHeight: '90vh',
                overflowY: 'auto',
                padding: '1.5rem',
                color: '#f8fafc'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #334155', paddingBottom: '0.75rem' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                      AI Research Cycle Explainability: {selectedAiCycleDetail.session}
                    </h2>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      Model: <code>{selectedAiCycleDetail.model}</code> · Provider: {selectedAiCycleDetail.provider} · Mode: {selectedAiCycleDetail.isReplay ? 'Replay' : 'Forward Live'}
                    </span>
                  </div>
                  <button
                    className="tl-btn-secondary"
                    onClick={() => setSelectedAiCycleDetail(null)}
                    style={{ fontSize: '1rem', padding: '0.25rem 0.6rem' }}
                  >
                    ✕
                  </button>
                </div>

                {/* Macro Market Summary */}
                <div style={{
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: '6px',
                  padding: '1rem',
                  marginBottom: '1.25rem'
                }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#93c5fd', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                    Macro Regime & Market Summary
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#e2e8f0', lineHeight: '1.5' }}>
                    {selectedAiCycleDetail.marketSummary || 'No summary recorded.'}
                  </div>
                </div>

                {/* Symbol Evaluations Detail */}
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem' }}>
                  Universe Symbol Evaluations ({selectedAiCycleDetail.symbolEvaluations?.length || 0})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {selectedAiCycleDetail.symbolEvaluations?.map(ev => {
                    const actionClass = ev.action === 'BUY' ? 'tl-badge-green' : ev.action === 'SELL' ? 'tl-badge-red' : 'tl-badge-amber'
                    return (
                      <div
                        key={ev.symbol}
                        style={{
                          background: '#0f172a',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '6px',
                          padding: '1rem'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{ev.symbol}</span>
                            <span className={`tl-admin-badge ${actionClass}`}>{ev.action}</span>
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                              Confidence: <strong>{Math.round((ev.confidence || 0) * 100)}%</strong>
                            </span>
                          </div>
                          {ev.exitRule?.stopLossPct && (
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                              Stop Loss: -{ev.exitRule.stopLossPct}% · Take Profit: +{ev.exitRule.takeProfitPct}% · Max Days: {ev.exitRule.timeStopDays}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: '1.5', marginBottom: '0.5rem' }}>
                          <strong>Thesis:</strong> {ev.thesis}
                        </div>
                        {ev.evidence && (
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', background: 'rgba(255,255,255,0.03)', padding: '0.4rem 0.6rem', borderRadius: '4px' }}>
                            {ev.evidence.trend && <span>Trend: <code>{ev.evidence.trend}</code> </span>}
                            {ev.evidence.volumeMultiple && <span>· Volume: <code>{ev.evidence.volumeMultiple}x</code> </span>}
                            {ev.evidence.catalyst && <span>· Catalyst: {ev.evidence.catalyst}</span>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: OPERATIONAL CONTROLS */}
      {activeTab === 'controls' && (
        <div className="tl-controls-grid">
          <div className="tl-control-panel">
            <h3>Next-Market-Open Paper Execution</h3>
            <p>
              Scans for queued AI decisions (e.g. BUY AAPL 5 shares) and executes them against the genuine market-open price bar.
            </p>
            <div className="tl-control-actions">
              <button
                className="tl-btn-primary"
                onClick={handleMarketOpen}
                disabled={actionLoading || !isAdmin}
              >
                {actionLoading ? 'Processing...' : '▶ Run Market Open Paper Fills'}
              </button>
            </div>
          </div>

          <div className="tl-control-panel">
            <h3>Daily AI Research Cycle</h3>
            <p>
              Queries Alpha Engine for verified point-in-time market data across the 10-symbol universe and runs GPT-4o-mini structured analysis.
            </p>
            <div className="tl-control-actions">
              <button
                className="tl-btn-primary"
                onClick={handleAiResearch}
                disabled={actionLoading || !isAdmin}
              >
                {actionLoading ? 'Processing...' : '⚡ Trigger AI Research Cycle'}
              </button>
            </div>
          </div>

          <div className="tl-control-panel">
            <h3>Strategy Evidence Publication</h3>
            <p>
              Reconciles forward equity, fills, and decisions into standardized public strategy evidence for consumer transparency.
            </p>
            <div className="tl-control-actions">
              <button
                className="tl-btn-secondary"
                onClick={handleEvidenceSync}
                disabled={actionLoading || !isAdmin}
              >
                {actionLoading ? 'Processing...' : '↻ Synchronize Evidence'}
              </button>
            </div>
          </div>

          <div className="tl-control-panel">
            <h3>Universe Market Feed Re-validation</h3>
            <p>
              Re-executes zero-lookahead ingestion diagnostics and bar sanity validation across all 10 universe tickers for the target session.
            </p>
            <div className="tl-control-actions">
              <button
                className="tl-btn-secondary"
                onClick={() => handleRevalidateMarketFeed(marketDataDiagnostics?.session)}
                disabled={revalidatingFeed || actionLoading || !isAdmin}
              >
                {revalidatingFeed ? 'Re-validating Feeds...' : '↻ Re-validate Universe Market Feeds'}
              </button>
            </div>
          </div>

          <div className="tl-control-panel">
            <h3>Worker Health Maintenance</h3>
            <p>
              Prunes dead worker heartbeat registrations that have not checked in within the last 10 minutes.
            </p>
            <div className="tl-control-actions">
              <button
                className="tl-btn-secondary"
                onClick={handleCleanupWorkers}
                disabled={actionLoading || !isAdmin}
              >
                {actionLoading ? 'Processing...' : '🧹 Prune Dead Workers'}
              </button>
            </div>
          </div>

          <div className="tl-control-panel" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
            <h3 style={{ color: '#f87171' }}>Platform Emergency Kill Switch</h3>
            <p>
              Immediately pauses all platform paper bots and requests cancellation of any active orders in flight.
            </p>
            <div className="tl-control-actions">
              <button
                className={overview?.emergencyStop?.active ? 'tl-btn-primary' : 'tl-btn-danger'}
                onClick={handleToggleEmergencyStop}
                disabled={actionLoading || !isAdmin}
              >
                {overview?.emergencyStop?.active ? 'Clear Emergency Stop' : '🚨 Trigger Emergency Stop'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: USERS & ROLES */}
      {activeTab === 'users' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem' }}>
            <input
              type="text"
              placeholder="Search users by email or name..."
              value={userSearch}
              onChange={(e) => {
                setUserSearch(e.target.value)
                loadUsers(e.target.value, 0)
              }}
              style={{
                background: '#0f172a',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#f1f5f9',
                padding: '0.6rem 1rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                width: '320px'
              }}
            />
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              Total users: <strong>{usersTotal}</strong>
            </span>
          </div>

          <div className="tl-admin-table-wrapper">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Subscription</th>
                  <th>Created</th>
                  <th>Actions & Support</th>
                </tr>
              </thead>
              <tbody>
                {users.length > 0 ? (
                  users.map(u => {
                    const isSuspended = u.status === 'suspended'
                    const isProtected = u.id === 'usr_platform_canonical'
                    const isSelf = u.id === user?.id
                    return (
                      <tr key={u.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{u.fullName || '—'}</div>
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{u.email}</div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b' }}><code>{u.id}</code></div>
                        </td>
                        <td>
                          <span className={`tl-admin-badge ${
                            u.role === 'admin' ? 'tl-badge-purple' : u.role === 'operator' ? 'tl-badge-blue' : 'tl-badge-green'
                          }`}>
                            {u.role || 'user'}
                          </span>
                        </td>
                        <td>
                          <span className={`tl-admin-badge ${isSuspended ? 'tl-badge-red' : 'tl-badge-green'}`}>
                            {isSuspended ? 'Suspended' : 'Active'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.8rem' }}>{u.subscription?.plan || 'BASIC'} ({u.subscription?.status || 'INACTIVE'})</span>
                        </td>
                        <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                              className="tl-btn-secondary"
                              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                              onClick={() => handleInspectUser(u.id)}
                              disabled={userDrilldownLoading}
                            >
                              Support Details
                            </button>
                            {isAdmin && !isProtected && !isSelf && (
                              <>
                                <button
                                  className={isSuspended ? 'tl-btn-primary' : 'tl-btn-danger'}
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                  onClick={() => handleToggleUserStatus(u.id, u.status || 'active', u.email)}
                                  disabled={actionLoading}
                                >
                                  {isSuspended ? 'Reactivate' : 'Suspend'}
                                </button>
                                <select
                                  className="tl-admin-select"
                                  style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem' }}
                                  value={u.role || 'user'}
                                  onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                >
                                  <option value="user">User</option>
                                  <option value="operator">Operator</option>
                                  <option value="admin">Admin</option>
                                </select>
                              </>
                            )}
                            {isProtected && (
                              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>System Protected</span>
                            )}
                            {isSelf && (
                              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Current User</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                      No user accounts found matching query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="tl-admin-pagination">
              <span className="tl-admin-pagination-info">
                Showing {usersTotal > 0 ? userPage * 20 + 1 : 0}–{Math.min((userPage + 1) * 20, usersTotal)} of {usersTotal} users
              </span>
              <div className="tl-admin-pagination-actions">
                <button
                  className="tl-admin-pagination-btn"
                  disabled={userPage === 0}
                  onClick={() => loadUsers(userSearch, userPage - 1)}
                >
                  ◀ Previous
                </button>
                <button
                  className="tl-admin-pagination-btn"
                  disabled={(userPage + 1) * 20 >= usersTotal}
                  onClick={() => loadUsers(userSearch, userPage + 1)}
                >
                  Next ▶
                </button>
              </div>
            </div>
          </div>

          {/* User Support Drilldown Modal */}
          {selectedUserDrilldown && (
            <div
              className="tl-modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Customer Support Drilldown"
              onClick={(e) => {
                if (e.target === e.currentTarget) setSelectedUserDrilldown(null)
              }}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.75)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '1.5rem'
              }}
            >
              <div style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                width: '100%',
                maxWidth: '850px',
                maxHeight: '90vh',
                overflowY: 'auto',
                padding: '1.5rem',
                color: '#f8fafc'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #334155', paddingBottom: '0.75rem' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                      Customer Support: {selectedUserDrilldown.user?.fullName || selectedUserDrilldown.user?.email}
                    </h2>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      ID: <code>{selectedUserDrilldown.user?.id}</code> | Role: {selectedUserDrilldown.user?.role}
                    </span>
                  </div>
                  <button
                    className="tl-btn-secondary"
                    onClick={() => setSelectedUserDrilldown(null)}
                    style={{ fontSize: '1rem', padding: '0.25rem 0.6rem' }}
                  >
                    ✕
                  </button>
                </div>

                {/* Quick Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Account Status</div>
                    <div style={{ fontWeight: 600, color: selectedUserDrilldown.user?.status === 'suspended' ? '#f87171' : '#4ade80' }}>
                      {selectedUserDrilldown.user?.status === 'suspended' ? 'Suspended' : 'Active'}
                    </div>
                  </div>
                  <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Subscription Tier</div>
                    <div style={{ fontWeight: 600 }}>
                      {selectedUserDrilldown.user?.subscription?.plan || 'Free'} ({selectedUserDrilldown.user?.subscription?.status || 'Active'})
                    </div>
                  </div>
                  <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Portfolios</div>
                    <div style={{ fontWeight: 600 }}>
                      {selectedUserDrilldown.portfolios?.length || 0}
                    </div>
                  </div>
                  <div style={{ background: '#0f172a', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Trading Bots</div>
                    <div style={{ fontWeight: 600 }}>
                      {selectedUserDrilldown.bots?.length || 0}
                    </div>
                  </div>
                </div>

                {/* Portfolios List */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#cbd5e1' }}>User Portfolios</h4>
                  {selectedUserDrilldown.portfolios?.length > 0 ? (
                    <table className="tl-admin-table" style={{ fontSize: '0.75rem' }}>
                      <thead>
                        <tr>
                          <th>Portfolio ID</th>
                          <th>Name</th>
                          <th>Cash Balance</th>
                          <th>Total Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUserDrilldown.portfolios.map(p => (
                          <tr key={p.id}>
                            <td><code>{p.id}</code></td>
                            <td>{p.name}</td>
                            <td>${Number(p.cashBalance || 0).toFixed(2)}</td>
                            <td>${Number(p.totalValue || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>No portfolios found.</p>
                  )}
                </div>

                {/* Bots List */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#cbd5e1' }}>User Trading Bots</h4>
                  {selectedUserDrilldown.bots?.length > 0 ? (
                    <table className="tl-admin-table" style={{ fontSize: '0.75rem' }}>
                      <thead>
                        <tr>
                          <th>Bot Name</th>
                          <th>Type</th>
                          <th>Template</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUserDrilldown.bots.map(b => (
                          <tr key={b.id}>
                            <td style={{ fontWeight: 600 }}>{b.name}</td>
                            <td>{b.botType}</td>
                            <td>{b.templateId || '—'}</td>
                            <td>
                              <span className={`tl-admin-badge ${b.enabled ? 'tl-badge-green' : 'tl-badge-red'}`}>
                                {b.enabled ? 'Running' : 'Paused'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>No bots configured.</p>
                  )}
                </div>

                {/* Recent Executions */}
                <div>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#cbd5e1' }}>Recent Trades & Orders</h4>
                  {selectedUserDrilldown.recentExecutions?.length > 0 ? (
                    <table className="tl-admin-table" style={{ fontSize: '0.75rem' }}>
                      <thead>
                        <tr>
                          <th>Ticker</th>
                          <th>Side</th>
                          <th>Qty</th>
                          <th>Status</th>
                          <th>Filled Price</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUserDrilldown.recentExecutions.map(e => (
                          <tr key={e.id}>
                            <td style={{ fontWeight: 600 }}>{e.ticker}</td>
                            <td>{e.direction?.toUpperCase()}</td>
                            <td>{e.quantity}</td>
                            <td><span className="tl-admin-badge tl-badge-blue">{e.status}</span></td>
                            <td>{e.filledPrice ? `$${Number(e.filledPrice).toFixed(2)}` : '—'}</td>
                            <td>{new Date(e.createdAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>No recent executions.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: ACTIVITY STREAM */}
      {activeTab === 'activity' && (
        <div className="tl-admin-table-wrapper">
          <table className="tl-admin-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Source</th>
                <th>Type</th>
                <th>Details</th>
                <th>Reference ID</th>
              </tr>
            </thead>
            <tbody>
              {activity.length > 0 ? (
                activity.map(item => (
                  <tr key={item.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem', color: '#94a3b8' }}>
                      {new Date(item.timestamp).toLocaleString()}
                    </td>
                    <td>
                      <span className={`tl-admin-badge ${item.source === 'bot_event' ? 'tl-badge-blue' : 'tl-badge-purple'}`}>
                        {item.source}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}><code>{item.type}</code></td>
                    <td>{item.detail || '—'}</td>
                    <td><code style={{ fontSize: '0.75rem' }}>{item.refId || '—'}</code></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                    No recorded operational events yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="tl-admin-pagination">
            <span className="tl-admin-pagination-info">
              Showing {activityTotal > 0 ? activityPage * 20 + 1 : 0}–{Math.min((activityPage + 1) * 20, activityTotal)} of {activityTotal} events
            </span>
            <div className="tl-admin-pagination-actions">
              <button
                className="tl-admin-pagination-btn"
                disabled={activityPage === 0}
                onClick={() => loadActivity(activityPage - 1)}
              >
                ◀ Previous
              </button>
              <button
                className="tl-admin-pagination-btn"
                disabled={(activityPage + 1) * 20 >= activityTotal}
                onClick={() => loadActivity(activityPage + 1)}
              >
                Next ▶
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB: ORDER BLOTTER */}
      {activeTab === 'blotter' && (
        <div>
          {/* Blotter Filter Toolbar */}
          <div className="tl-admin-toolbar" style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Filter by ticker (e.g. AAPL)..."
              className="tl-admin-input"
              style={{ flex: '1 1 180px' }}
              value={executionTickerFilter}
              onChange={(e) => setExecutionTickerFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') loadExecutions(executionStatusFilter, executionTickerFilter, 0)
              }}
            />
            <select
              className="tl-admin-select"
              value={executionStatusFilter}
              onChange={(e) => {
                setExecutionStatusFilter(e.target.value)
                loadExecutions(e.target.value, executionTickerFilter, 0)
              }}
            >
              <option value="">All Statuses</option>
              <option value="pending_fill">Pending Fill</option>
              <option value="queued">Queued</option>
              <option value="filled">Filled</option>
              <option value="cancelled">Cancelled</option>
              <option value="failed">Failed</option>
              <option value="refused">Refused / Rejected</option>
            </select>
            <button
              className="tl-btn-secondary"
              onClick={() => loadExecutions(executionStatusFilter, executionTickerFilter, 0)}
            >
              Filter Blotter
            </button>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', width: '100%', marginTop: '0.25rem' }}>
              💡 <strong>Intent Price</strong> represents the model target at decision time (prior close reference); <strong>Fill Price</strong> is the actual executed exchange price at session open.
            </div>
          </div>

          {/* Blotter Table */}
          <div className="tl-admin-table-wrapper">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Execution ID</th>
                  <th>Ticker / Side</th>
                  <th>Quantity</th>
                  <th>Intent Price vs Fill Price</th>
                  <th>Status</th>
                  <th>Bot / User</th>
                  <th>Diagnostics / Reason</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {executions.length > 0 ? (
                  executions.map(ex => {
                    const isCancellable = ['queued', 'pending_fill', 'processing'].includes(ex.status)
                    const statusClass = ex.status === 'filled' ? 'tl-badge-green' : ex.status === 'cancelled' || ex.status === 'failed' || ex.status === 'refused' ? 'tl-badge-red' : 'tl-badge-amber'
                    return (
                      <tr key={ex.id}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem', color: '#94a3b8' }}>
                          {new Date(ex.createdAt).toLocaleString()}
                        </td>
                        <td>
                          <code style={{ fontSize: '0.75rem' }}>{ex.id}</code>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, marginRight: '0.5rem' }}>{ex.ticker}</span>
                          <span className={`tl-admin-badge ${ex.direction === 'buy' ? 'tl-badge-green' : 'tl-badge-red'}`}>
                            {ex.direction?.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{ex.quantity}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>Intent: {ex.price ? `$${Number(ex.price).toFixed(2)}` : 'Market'}</div>
                          {ex.filledPrice ? (
                            <div style={{ fontSize: '0.75rem', color: '#4ade80', marginTop: '2px' }}>
                              Fill: ${Number(ex.filledPrice).toFixed(2)}
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
                              Fill: Pending Open
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`tl-admin-badge ${statusClass}`}>
                            {ex.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: '0.8rem' }}>{ex.bot?.name || ex.botId || 'Manual'}</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{ex.user?.email || ex.userId}</div>
                        </td>
                        <td>
                          {ex.diagnostics ? (
                            <span style={{ fontSize: '0.75rem', color: '#f87171' }}>{ex.diagnostics}</span>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>—</span>
                          )}
                        </td>
                        <td>
                          {isCancellable && isAdmin && (
                            <button
                              className="tl-btn-danger"
                              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                              onClick={() => handleCancelExecution(ex.id, ex.ticker)}
                              disabled={actionLoading}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan="9" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                      No executions found matching filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="tl-admin-pagination">
              <span className="tl-admin-pagination-info">
                Showing {executionsTotal > 0 ? blotterPage * 20 + 1 : 0}–{Math.min((blotterPage + 1) * 20, executionsTotal)} of {executionsTotal} orders
              </span>
              <div className="tl-admin-pagination-actions">
                <button
                  className="tl-admin-pagination-btn"
                  disabled={blotterPage === 0}
                  onClick={() => loadExecutions(executionStatusFilter, executionTickerFilter, blotterPage - 1)}
                >
                  ◀ Previous
                </button>
                <button
                  className="tl-admin-pagination-btn"
                  disabled={(blotterPage + 1) * 20 >= executionsTotal}
                  onClick={() => loadExecutions(executionStatusFilter, executionTickerFilter, blotterPage + 1)}
                >
                  Next ▶
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: AUDIT TRAIL */}
      {activeTab === 'audit' && (
        <div className="tl-admin-table-wrapper">
          <table className="tl-admin-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Admin Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Payload / Parameters</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length > 0 ? (
                auditLogs.map(log => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem', color: '#94a3b8' }}>
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{log.admin?.fullName || log.admin?.email || log.adminId}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{log.admin?.email}</div>
                    </td>
                    <td>
                      <span className="tl-admin-badge tl-badge-purple">
                        {log.action}
                      </span>
                    </td>
                    <td>
                      <div><code>{log.targetType}</code></div>
                      {log.targetId && (
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          <code>{log.targetId}</code>
                        </div>
                      )}
                    </td>
                    <td>
                      {log.payload ? (
                        <pre style={{
                          margin: 0,
                          fontSize: '0.75rem',
                          maxWidth: '320px',
                          overflowX: 'auto',
                          background: '#0f172a',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          color: '#e2e8f0'
                        }}>
                          {JSON.stringify(log.payload, null, 1)}
                        </pre>
                      ) : '—'}
                    </td>
                    <td>
                      <code style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{log.ipAddress || 'internal'}</code>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                    No administrative mutations recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="tl-admin-pagination">
            <span className="tl-admin-pagination-info">
              Showing {auditTotal > 0 ? auditPage * 20 + 1 : 0}–{Math.min((auditPage + 1) * 20, auditTotal)} of {auditTotal} mutations
            </span>
            <div className="tl-admin-pagination-actions">
              <button
                className="tl-admin-pagination-btn"
                disabled={auditPage === 0}
                onClick={() => loadAuditLogs(auditPage - 1)}
              >
                ◀ Previous
              </button>
              <button
                className="tl-admin-pagination-btn"
                disabled={(auditPage + 1) * 20 >= auditTotal}
                onClick={() => loadAuditLogs(auditPage + 1)}
              >
                Next ▶
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IN-APP ACTION CONFIRMATION MODAL */}
      {actionDialog && (
        <div
          className="tl-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={actionDialog.title}
          onClick={(e) => {
            if (e.target === e.currentTarget && !actionLoading) setActionDialog(null)
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '1.5rem'
          }}
        >
          <div style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '520px',
            padding: '1.5rem',
            color: '#f8fafc',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
          }}>
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.15rem' }}>{actionDialog.title}</h3>
            <p style={{ fontSize: '0.875rem', color: '#cbd5e1', lineHeight: '1.5', margin: '0 0 1rem 0' }}>
              {actionDialog.message}
            </p>
            {actionDialog.showInput && (
              <div style={{ marginBottom: '1.25rem' }}>
                <textarea
                  className="tl-admin-input"
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '0.5rem',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box'
                  }}
                  value={actionDialogInput}
                  onChange={(e) => setActionDialogInput(e.target.value)}
                  placeholder={actionDialog.inputPlaceholder}
                />
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                className="tl-btn-secondary"
                onClick={() => setActionDialog(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                className={actionDialog.confirmVariant === 'danger' ? 'tl-btn-danger' : 'tl-btn-primary'}
                onClick={() => actionDialog.onConfirm(actionDialogInput)}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : actionDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
