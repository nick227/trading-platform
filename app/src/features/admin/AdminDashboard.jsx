import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../app/AuthProvider'
import {
  fetchAdminOverview,
  fetchAdminActivity,
  fetchAdminUsers,
  updateAdminUserRole,
  setAdminEmergencyStop,
  runAdminMarketOpen,
  runAdminAiResearch,
  runAdminEvidenceSync,
  cleanupAdminWorkers
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
  const [users, setUsers] = useState([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [userSearch, setUserSearch] = useState('')

  const showFeedback = (type, message) => {
    setFeedback({ type, message })
    setTimeout(() => setFeedback(null), 6000)
  }

  const loadOverview = useCallback(async () => {
    try {
      const data = await fetchAdminOverview()
      setOverview(data)
    } catch (err) {
      showFeedback('error', `Failed to load admin overview: ${err.serverMessage || err.message}`)
    }
  }, [])

  const loadActivity = useCallback(async () => {
    try {
      const data = await fetchAdminActivity({ limit: 50, offset: 0 })
      setActivity(data?.events || [])
      setActivityTotal(data?.total || 0)
    } catch (err) {
      showFeedback('error', `Failed to load activity stream: ${err.serverMessage || err.message}`)
    }
  }, [])

  const loadUsers = useCallback(async (searchQuery = '') => {
    try {
      const data = await fetchAdminUsers({ limit: 50, offset: 0, search: searchQuery })
      setUsers(data?.users || [])
      setUsersTotal(data?.total || 0)
    } catch (err) {
      showFeedback('error', `Failed to load users: ${err.serverMessage || err.message}`)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([
      loadOverview(),
      loadActivity(),
      loadUsers(userSearch)
    ])
    setLoading(false)
  }, [loadOverview, loadActivity, loadUsers, userSearch])

  useEffect(() => {
    refreshAll()
    const timer = setInterval(() => {
      loadOverview()
    }, 15000) // Poll overview every 15s
    return () => clearInterval(timer)
  }, [refreshAll, loadOverview])

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

  const handleToggleEmergencyStop = async () => {
    const isCurrentlyActive = Boolean(overview?.emergencyStop?.active)
    const promptMsg = isCurrentlyActive
      ? 'Clear platform emergency stop and allow automated bot trading?'
      : 'ACTIVATE EMERGENCY STOP? This will immediately pause platform bots and cancel active executions.'

    if (!window.confirm(promptMsg)) return

    setActionLoading(true)
    try {
      const res = await setAdminEmergencyStop({
        active: !isCurrentlyActive,
        reason: isCurrentlyActive ? 'Admin cleared stop' : 'Admin activated stop via dashboard'
      })
      showFeedback('success', `Emergency stop ${!isCurrentlyActive ? 'ACTIVATED' : 'CLEARED'}.`)
      await refreshAll()
    } catch (err) {
      showFeedback('error', `Emergency stop toggle failed: ${err.serverMessage || err.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  const handleRoleChange = async (targetUserId, newRole) => {
    try {
      await updateAdminUserRole(targetUserId, newRole)
      showFeedback('success', `Updated user role to '${newRole}'.`)
      await loadUsers(userSearch)
      await loadOverview()
    } catch (err) {
      showFeedback('error', `Failed to update role: ${err.serverMessage || err.message}`)
    }
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
          className={`tl-admin-tab ${activeTab === 'pipeline' ? 'active' : ''}`}
          onClick={() => setActiveTab('pipeline')}
        >
          AI Pipeline Monitor
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

      {/* TAB 2: PIPELINE MONITOR */}
      {activeTab === 'pipeline' && (
        <div>
          <div className="tl-pipeline-widget">
            <h3 style={{ margin: '0 0 1rem 0' }}>Autonomous Pipeline Stage Health</h3>
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
          </div>
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
                loadUsers(e.target.value)
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
                  <th>Subscription</th>
                  <th>Bots</th>
                  <th>Created</th>
                  {isAdmin && <th>Manage Role</th>}
                </tr>
              </thead>
              <tbody>
                {users.length > 0 ? (
                  users.map(u => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{u.fullName || '—'}</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{u.email}</div>
                      </td>
                      <td>
                        <span className={`tl-admin-badge ${
                          u.role === 'admin' ? 'tl-badge-purple' : u.role === 'operator' ? 'tl-badge-blue' : 'tl-badge-green'
                        }`}>
                          {u.role || 'user'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8rem' }}>{u.subscription?.plan || 'BASIC'} ({u.subscription?.status || 'INACTIVE'})</span>
                      </td>
                      <td>{u.botCount ?? 0}</td>
                      <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                      {isAdmin && (
                        <td>
                          {u.id === 'usr_platform_canonical' ? (
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>System Protected</span>
                          ) : u.id === user?.id ? (
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Current Account</span>
                          ) : (
                            <select
                              className="tl-admin-select"
                              value={u.role || 'user'}
                              onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            >
                              <option value="user">User</option>
                              <option value="operator">Operator</option>
                              <option value="admin">Admin</option>
                            </select>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                      No user accounts found matching query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
        </div>
      )}
    </div>
  )
}
