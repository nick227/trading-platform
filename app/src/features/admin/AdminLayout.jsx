import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../app/AuthProvider'
import {
  fetchAdminBrokerFleetStatus,
  fetchAdminMarketDataDiagnostics,
  fetchAdminOverview,
} from '../../api/adminClient'
import { Button, Notice } from '../../components/ui'
import { AdminConfirmDialog, formatDateTime } from './adminShared'

const AdminShellContext = createContext(null)

export function useAdminShell() {
  const ctx = useContext(AdminShellContext)
  if (!ctx) {
    throw new Error('useAdminShell must be used inside AdminLayout')
  }
  return ctx
}

const WORKSPACES = [
  { to: '/admin', label: 'Overview', end: true, key: 'overview' },
  { to: '/admin/users', label: 'Users', end: false, key: 'users' },
  { to: '/admin/trading', label: 'Trading', end: false, key: 'trading' },
  { to: '/admin/ai', label: 'AI & Data', end: false, key: 'ai' },
  { to: '/admin/system', label: 'System', end: false, key: 'system' },
]

export default function AdminLayout() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isOperator = user?.role === 'operator'

  const [overview, setOverview] = useState(null)
  const [brokerSummary, setBrokerSummary] = useState(null)
  const [feedSummary, setFeedSummary] = useState(null)
  const [shellLoading, setShellLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [actionDialog, setActionDialog] = useState(null)
  const [actionDialogInput, setActionDialogInput] = useState('')

  const showFeedback = useCallback((type, message) => {
    setFeedback({ type, message })
    if (type !== 'error') {
      setTimeout(() => {
        setFeedback((curr) => (curr?.message === message ? null : curr))
      }, 6000)
    }
  }, [])

  const refreshShell = useCallback(async ({ includeHealthChecks = false } = {}) => {
    try {
      const overviewRes = await fetchAdminOverview()
      setOverview(overviewRes)
      if (includeHealthChecks) {
        const [brokerRes, feedRes] = await Promise.all([
          fetchAdminBrokerFleetStatus?.().catch(() => null),
          fetchAdminMarketDataDiagnostics?.().catch(() => null),
        ])
        if (brokerRes) setBrokerSummary(brokerRes?.data ?? brokerRes)
        if (feedRes) setFeedSummary(feedRes?.data ?? feedRes)
      }
    } catch (err) {
      showFeedback('error', `Unable to load platform overview: ${err.serverMessage || err.message}`)
    } finally {
      setShellLoading(false)
    }
  }, [showFeedback])

  useEffect(() => {
    refreshShell({ includeHealthChecks: true })
    const timer = setInterval(() => {
      refreshShell({ includeHealthChecks: false })
    }, 30000)
    return () => clearInterval(timer)
  }, [refreshShell])

  const openConfirmDialog = useCallback((config, defaultInput = '') => {
    setActionDialogInput(defaultInput)
    setActionDialog(config)
  }, [])

  const closeConfirmDialog = useCallback(() => {
    setActionDialog(null)
    setActionDialogInput('')
  }, [])

  const emergencyStop = overview?.emergencyStop || { active: false }
  const stopActive = Boolean(emergencyStop.active)

  // Compute attention badges per workspace
  const navCounts = useMemo(() => {
    const drifted = Number(brokerSummary?.fleet?.driftedAccountsCount || 0)
    const staleWorkers = Number(overview?.workers?.staleCount || 0)
    const failedStages = Object.values(overview?.pipeline?.stages || {}).filter(
      (s) => s?.status === 'failed'
    ).length
    const degradedFeed = feedSummary?.status && feedSummary.status !== 'healthy' ? 1 : 0
    return {
      overview: (stopActive ? 1 : 0) + (drifted > 0 ? 1 : 0) + (staleWorkers > 0 ? 1 : 0) + (failedStages + degradedFeed > 0 ? 1 : 0),
      users: 0,
      trading: drifted,
      ai: failedStages + degradedFeed,
      system: (stopActive ? 1 : 0) + (staleWorkers > 0 ? 1 : 0),
    }
  }, [brokerSummary, feedSummary, overview, stopActive])

  const contextValue = useMemo(
    () => ({
      user,
      isAdmin,
      isOperator,
      overview,
      brokerSummary,
      setBrokerSummary,
      feedSummary,
      setFeedSummary,
      shellLoading,
      refreshShell,
      actionLoading,
      setActionLoading,
      showFeedback,
      openConfirmDialog,
      closeConfirmDialog,
    }),
    [
      user,
      isAdmin,
      isOperator,
      overview,
      brokerSummary,
      feedSummary,
      shellLoading,
      refreshShell,
      actionLoading,
      showFeedback,
      openConfirmDialog,
      closeConfirmDialog,
    ]
  )

  return (
    <AdminShellContext.Provider value={contextValue}>
      <div className="tl-admin-shell" data-testid="admin-shell">
        <aside className="tl-admin-rail" aria-label="Administration sections">
          <div className="tl-admin-rail-brand">
            <span className="tl-admin-rail-eyebrow">Admin Workspace</span>
            <span className="tl-admin-rail-role">
              Role: <strong>{isAdmin ? 'Administrator' : 'Operator (Read-only)'}</strong>
            </span>
          </div>

          <nav className="tl-admin-nav" aria-label="Admin workspaces">
            {WORKSPACES.map((ws) => {
              const count = navCounts[ws.key] || 0
              const isDangerBadge = ws.key === 'system' && stopActive
              return (
                <NavLink
                  key={ws.to}
                  to={ws.to}
                  end={ws.end}
                  className={({ isActive }) =>
                    `tl-admin-nav-link ${isActive ? 'is-active' : ''}`.trim()
                  }
                >
                  <span>{ws.label}</span>
                  {count > 0 && (
                    <span
                      className={`tl-admin-nav-count ${isDangerBadge ? 'tl-admin-nav-count--danger' : ''}`.trim()}
                      aria-label={`${count} items requiring attention`}
                    >
                      {count}
                    </span>
                  )}
                </NavLink>
              )
            })}
          </nav>

          {/* Persistent Safety Indicator with direct link to /admin/system */}
          <div
            className={`tl-admin-safety-box ${stopActive ? 'tl-admin-safety-box--active' : ''}`.trim()}
            data-testid="admin-safety-indicator"
          >
            <span className="tl-admin-safety-label">Trading Safety</span>
            <div className="tl-admin-safety-state">
              <span
                className={`tl-admin-safety-dot ${stopActive ? 'tl-admin-safety-dot--danger' : ''}`.trim()}
                aria-hidden="true"
              />
              <span>{stopActive ? 'Emergency Stop Active' : 'Operating Normally'}</span>
            </div>
            <Link to="/admin/system#emergency-stop" className="tl-admin-safety-link">
              {stopActive ? 'Review emergency stop →' : 'Safety controls →'}
            </Link>
          </div>
        </aside>

        <main className="tl-admin-main">
          {/* Workspace-Wide Active Emergency Stop Banner */}
          {stopActive && (
            <div className="tl-admin-stop-banner" role="alert" data-testid="admin-emergency-banner">
              <div>
                <h2>Emergency Stop Active — Internal AI Trading Halted</h2>
                <p>
                  Activated {emergencyStop.activatedAt ? formatDateTime(emergencyStop.activatedAt) : 'recently'}
                  {emergencyStop.reason ? ` · Reason: "${emergencyStop.reason}"` : ''}. Affects{' '}
                  <strong>TradeLoom Internal Trading (usr_platform_canonical)</strong>: internal showcase bots are paused and new internal paper order submissions are refused until cleared.
                </p>
              </div>
              <Link to="/admin/system#emergency-stop" className="tl-btn tl-btn--secondary tl-btn--sm">
                Manage in System →
              </Link>
            </div>
          )}

          {/* Explicit Read-Only Explanation for Support Operators */}
          {isOperator && (
            <Notice tone="info">
              <span>
                <strong>Read-only operator view:</strong> You can inspect platform health, customer accounts, bots, orders, and logs. State-changing controls require an Administrator account.
              </span>
            </Notice>
          )}

          {/* Post-Action Outcome Feedback Banner */}
          {feedback && (
            <Notice
              tone={feedback.type === 'error' ? 'error' : 'info'}
              className={`tl-admin-feedback ${feedback.type === 'success' ? 'tl-notice--success' : ''}`.trim()}
            >
              <span>{feedback.message}</span>
              <Button variant="quiet" size="sm" onClick={() => setFeedback(null)}>
                Dismiss
              </Button>
            </Notice>
          )}

          <Outlet />
        </main>

        <AdminConfirmDialog
          dialog={actionDialog}
          inputValue={actionDialogInput}
          onInputChange={setActionDialogInput}
          onCancel={closeConfirmDialog}
          busy={actionLoading}
        />
      </div>
    </AdminShellContext.Provider>
  )
}
