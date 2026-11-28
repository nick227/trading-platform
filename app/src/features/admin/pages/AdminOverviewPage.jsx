import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchAdminActivity, fetchAdminAuditLogs } from '../../../api/adminClient'
import { Button, Notice } from '../../../components/ui'
import { useAdminShell } from '../AdminLayout'
import { AdminPill, formatDateTime, formatMoney, ScopeBadge } from '../adminShared'

const DAILY_OPERATIONS = [
  { key: 'market_data_ingestion', label: 'Market data received' },
  { key: 'pending_order_execution', label: 'Orders processed' },
  { key: 'ai_research_decision', label: 'AI research completed' },
  { key: 'portfolio_valuation', label: 'Portfolio valuation updated' },
  { key: 'strategy_evidence_publication', label: 'Public strategy evidence updated' },
]

function stagePresentation(stageData) {
  const raw = stageData?.status || 'pending'
  if (raw === 'ok') return { label: 'Complete', tone: 'pos' }
  if (raw === 'failed') return { label: 'Failed', tone: 'neg' }
  if (raw === 'degraded') return { label: 'Needs review', tone: 'warn' }
  if (raw === 'skipped') return { label: 'Skipped', tone: 'neutral' }
  return { label: 'Pending', tone: 'warn' }
}

export default function AdminOverviewPage() {
  const { overview, brokerSummary, feedSummary, shellLoading, refreshShell, showFeedback } = useAdminShell()
  const [recentAudit, setRecentAudit] = useState([])
  const [recentEvents, setRecentEvents] = useState([])
  const [refreshing, setRefreshing] = useState(false)

  const loadRecent = useCallback(async () => {
    try {
      const [auditRes, activityRes] = await Promise.all([
        fetchAdminAuditLogs?.({ limit: 5, offset: 0 }).catch(() => null),
        fetchAdminActivity?.({ limit: 5, offset: 0 }).catch(() => null),
      ])
      setRecentAudit(auditRes?.logs || [])
      setRecentEvents(activityRes?.events || [])
    } catch (err) {
      showFeedback('error', `Unable to load recent activity: ${err.serverMessage || err.message}`)
    }
  }, [showFeedback])

  useEffect(() => {
    loadRecent()
  }, [loadRecent])

  const handleRefresh = async () => {
    setRefreshing(true)
    await Promise.all([refreshShell({ includeHealthChecks: true }), loadRecent()])
    setRefreshing(false)
  }

  const pipeline = overview?.pipeline || {}
  const stages = pipeline?.stages || {}
  const pendingOrdersCount =
    Number(overview?.executions?.queued || 0) + Number(overview?.executions?.pending_fill || 0)

  const attentionItems = useMemo(() => {
    const items = []

    if (overview?.emergencyStop?.active) {
      items.push({
        id: 'emergency-stop',
        title: 'Emergency stop is active',
        detail:
          overview.emergencyStop.reason ||
          'Internal AI showcase bots are paused and new internal paper orders are blocked.',
        scope: 'internal',
        actionLabel: 'Review safety controls',
        to: '/admin/system#emergency-stop',
      })
    }

    const driftedCount = Number(brokerSummary?.fleet?.driftedAccountsCount || 0)
    if (driftedCount > 0) {
      items.push({
        id: 'broker-drift',
        title: `${driftedCount} customer broker ${driftedCount === 1 ? 'account' : 'accounts'} out of sync`,
        detail: 'Recorded TradeLoom positions differ from connected Alpaca account positions.',
        scope: 'customer',
        actionLabel: 'Inspect & reconcile',
        to: '/admin/trading#broker-sync',
      })
    }

    if (feedSummary?.status && feedSummary.status !== 'healthy') {
      items.push({
        id: 'market-feed',
        title: 'Market data needs verification',
        detail: `${feedSummary?.summary?.healthy ?? 0} of ${feedSummary?.summary?.total ?? 10} universe symbols reported healthy bars for ${feedSummary?.session || 'the latest session'}.`,
        scope: 'infra',
        actionLabel: 'Check market feeds',
        to: '/admin/ai#market-feeds',
      })
    }

    const failedStage = DAILY_OPERATIONS.find((op) => stages[op.key]?.status === 'failed')
    if (failedStage) {
      items.push({
        id: 'pipeline-failed',
        title: `Daily operation failed: ${failedStage.label}`,
        detail: stages[failedStage.key]?.error || 'One of today’s internal AI trading stages reported an error.',
        scope: 'internal',
        actionLabel: 'Inspect AI & Data',
        to: '/admin/ai#pipeline',
      })
    }

    const failedOrders = Number(overview?.executions?.failed || 0)
    if (failedOrders > 0) {
      items.push({
        id: 'failed-orders',
        title: `${failedOrders} failed ${failedOrders === 1 ? 'order' : 'orders'} recorded`,
        detail: 'Inspect order failure reasons and affected bots in Trading.',
        scope: 'customer',
        actionLabel: 'Review orders',
        to: '/admin/trading#orders',
      })
    }

    const staleWorkers = Number(overview?.workers?.staleCount || 0)
    if (staleWorkers > 0) {
      items.push({
        id: 'stale-workers',
        title: `${staleWorkers} stale worker ${staleWorkers === 1 ? 'heartbeat' : 'heartbeats'}`,
        detail: 'Worker registration records have stopped reporting recent heartbeats.',
        scope: 'infra',
        actionLabel: 'Manage workers',
        to: '/admin/system#workers',
      })
    }

    return items
  }, [brokerSummary, feedSummary, overview, stages])

  return (
    <>
      <header className="tl-admin-page-head">
        <div>
          <h1>Overview</h1>
          <p className="tl-admin-page-sub">Platform operations and customer activity</p>
        </div>
        <div className="tl-admin-head-actions">
          {overview?.timestamp && (
            <span className="tl-admin-updated">Updated {formatDateTime(overview.timestamp)}</span>
          )}
          <Button
            variant="secondary"
            onClick={handleRefresh}
            disabled={shellLoading || refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {/* 1. Items Requiring Attention */}
      <section className="tl-admin-section" aria-labelledby="attention-heading">
        <div className="tl-admin-section-head">
          <div>
            <h2 className="tl-admin-section-title" id="attention-heading">
              Items requiring attention
            </h2>
            <p className="tl-admin-section-desc">
              Urgent operational alerts across customer accounts, internal trading, and infrastructure.
            </p>
          </div>
        </div>

        {attentionItems.length > 0 ? (
          <ul className="tl-admin-attention-list">
            {attentionItems.map((item) => (
              <li key={item.id} className="tl-admin-attention-item">
                <div className="tl-admin-attention-copy">
                  <div className="tl-admin-attention-title">
                    <span>{item.title}</span>
                    <ScopeBadge scope={item.scope} />
                  </div>
                  <span className="tl-admin-attention-detail">{item.detail}</span>
                </div>
                <Link to={item.to} className="tl-btn tl-btn--secondary tl-btn--sm">
                  {item.actionLabel} →
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Notice tone="info" className="tl-notice--success">
            <span>
              <strong>All monitored systems operating normally.</strong> No broker drift, emergency stops, failed pipeline stages, or stale worker alerts require action right now.
            </span>
          </Notice>
        )}
      </section>

      {/* 2. Operational Snapshot Cards */}
      <section className="tl-admin-section" aria-label="Platform operational summary">
        <div className="tl-admin-kpi-grid">
          <div className="tl-admin-kpi">
            <div className="tl-admin-kpi-top">
              <span className="tl-admin-kpi-label">Customers</span>
              <ScopeBadge scope="customer" label="Customer" />
            </div>
            <div className="tl-admin-kpi-value">{overview?.users?.total ?? '—'}</div>
            <div className="tl-admin-kpi-meta">
              <span>{overview?.users?.activeSubscriptions ?? 0} active plans</span>
              <span>{overview?.users?.byRole?.admin ?? 0} admins · {overview?.users?.byRole?.operator ?? 0} operators</span>
            </div>
          </div>

          <div className="tl-admin-kpi">
            <div className="tl-admin-kpi-top">
              <span className="tl-admin-kpi-label">Running bots</span>
              <ScopeBadge scope="customer" label="Customer & Internal" />
            </div>
            <div className="tl-admin-kpi-value">
              {overview?.bots?.enabled ?? '—'}
              <span className="tl-muted" style={{ fontSize: '15px', fontWeight: 500 }}>
                {' '}/ {overview?.bots?.total ?? '—'}
              </span>
            </div>
            <div className="tl-admin-kpi-meta">
              <span>{overview?.bots?.rule ?? 0} rule-based</span>
              <span>{overview?.bots?.ai ?? 0} AI strategies</span>
              <span>{overview?.bots?.paused ?? 0} paused</span>
            </div>
          </div>

          <div className="tl-admin-kpi">
            <div className="tl-admin-kpi-top">
              <span className="tl-admin-kpi-label">Pending orders</span>
              <ScopeBadge scope="customer" label="Customer & Internal" />
            </div>
            <div className="tl-admin-kpi-value">{pendingOrdersCount}</div>
            <div className="tl-admin-kpi-meta">
              <span>{overview?.executions?.filled ?? 0} filled</span>
              <span>{formatMoney(overview?.executions?.filledNotional ?? 0)} filled volume</span>
            </div>
          </div>

          <div className="tl-admin-kpi">
            <div className="tl-admin-kpi-top">
              <span className="tl-admin-kpi-label">Workers</span>
              <ScopeBadge scope="infra" label="Infrastructure" />
            </div>
            <div className="tl-admin-kpi-value">{overview?.workers?.activeCount ?? 0}</div>
            <div className="tl-admin-kpi-meta">
              <span>
                {(overview?.workers?.activeCount ?? 0) > 0
                  ? `Reporting normally (${overview?.workers?.avgQueueLagMs ?? 0}ms lag)`
                  : 'No active workers reporting'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Today's Trading Operations */}
      <section className="tl-admin-section" aria-labelledby="daily-ops-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="daily-ops-heading">
                Today&apos;s trading operations
              </h2>
              <ScopeBadge scope="internal" />
            </div>
            <p className="tl-admin-section-desc">
              Daily automated schedule for TradeLoom&apos;s internal showcase AI strategy (does not alter customer-configured bots).
            </p>
          </div>
          <Link to="/admin/ai" className="tl-btn tl-btn--secondary tl-btn--sm">
            Open AI &amp; Data →
          </Link>
        </div>

        {pipeline?.isTodayTradingDay === false && (
          <Notice tone="info">
            <span>
              <strong>US equity exchanges closed today (weekend or holiday).</strong> Scheduled ingestion, AI research, and next-open paper fills pause until the next trading session. Last completed session: <strong>{pipeline.expectedCompletedSession || '—'}</strong>.
            </span>
          </Notice>
        )}

        <ul className="tl-admin-ops-list">
          {DAILY_OPERATIONS.map((step) => {
            const sData = stages[step.key]
            const pres = stagePresentation(sData)
            return (
              <li key={step.key} className="tl-admin-ops-item">
                <div className="tl-admin-attention-copy">
                  <span className="tl-admin-cell-primary">{step.label}</span>
                  <span className="tl-admin-cell-sub">
                    {sData?.session ? `Session ${sData.session}` : 'Awaiting scheduled run'}
                  </span>
                </div>
                <AdminPill tone={pres.tone}>{pres.label}</AdminPill>
              </li>
            )
          })}
        </ul>
      </section>

      {/* 4. Recent Administrative & Engine Activity */}
      <section className="tl-admin-section" aria-labelledby="recent-activity-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="recent-activity-heading">
                Recent activity
              </h2>
              <ScopeBadge scope="infra" />
            </div>
            <p className="tl-admin-section-desc">
              Latest administrative actions and automated trading events so you can verify outcomes immediately.
            </p>
          </div>
          <Link to="/admin/system#audit" className="tl-btn tl-btn--secondary tl-btn--sm">
            View audit history →
          </Link>
        </div>

        <div className="tl-admin-cards-2">
          <div className="tl-admin-table-card">
            <div className="tl-admin-toolbar">
              <strong style={{ fontSize: '13.5px' }}>Recent admin actions</strong>
            </div>
            <div className="tl-admin-table-scroll">
              <table className="tl-admin-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAudit.length > 0 ? (
                    recentAudit.map((log) => (
                      <tr key={log.id}>
                        <td className="tl-num tl-nowrap">{formatDateTime(log.createdAt)}</td>
                        <td>
                          <AdminPill tone="accent">{log.action}</AdminPill>
                        </td>
                        <td>{log.admin?.email || log.adminId}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="tl-admin-empty">
                        No administrative actions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="tl-admin-table-card">
            <div className="tl-admin-toolbar">
              <strong style={{ fontSize: '13.5px' }}>Recent engine events</strong>
            </div>
            <div className="tl-admin-table-scroll">
              <table className="tl-admin-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Event</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.length > 0 ? (
                    recentEvents.map((ev) => (
                      <tr key={ev.id}>
                        <td className="tl-num tl-nowrap">{formatDateTime(ev.timestamp)}</td>
                        <td>
                          <span className="tl-admin-code">{ev.type}</span>
                        </td>
                        <td>{ev.detail || '—'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="tl-admin-empty">
                        No operational events recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
