import { useCallback, useEffect, useState } from 'react'
import {
  cleanupAdminWorkers,
  compactAdminEvidence,
  fetchAdminActivity,
  fetchAdminAuditLogs,
  fetchAdminEvidenceStorage,
  setAdminEmergencyStop,
} from '../../../api/adminClient'
import { Button, Disclosure, Select } from '../../../components/ui'
import { useAdminShell } from '../AdminLayout'
import { AdminPagination, AdminPill, formatDateTime, ScopeBadge } from '../adminShared'

export default function AdminSystemPage() {
  const {
    overview,
    isAdmin,
    actionLoading,
    setActionLoading,
    showFeedback,
    openConfirmDialog,
    closeConfirmDialog,
    refreshShell,
  } = useAdminShell()

  const [evidenceStorage, setEvidenceStorage] = useState(null)

  const [auditLogs, setAuditLogs] = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(0)

  const [activity, setActivity] = useState([])
  const [activityTotal, setActivityTotal] = useState(0)
  const [activityCategory, setActivityCategory] = useState('')
  const [activityPage, setActivityPage] = useState(0)

  const [loading, setLoading] = useState(true)

  const loadStorage = useCallback(async () => {
    try {
      const res = await fetchAdminEvidenceStorage()
      setEvidenceStorage(res?.data ?? res)
    } catch {
      // optional
    }
  }, [])

  const loadAudit = useCallback(
    async (page = 0) => {
      try {
        const data = await fetchAdminAuditLogs({ limit: 20, offset: page * 20 })
        setAuditLogs(data?.logs || [])
        setAuditTotal(data?.total || 0)
        setAuditPage(page)
      } catch (err) {
        showFeedback('error', `Failed to load audit history: ${err.serverMessage || err.message}`)
      }
    },
    [showFeedback]
  )

  const loadEvents = useCallback(
    async (category = '', page = 0) => {
      try {
        const data = await fetchAdminActivity({
          limit: 20,
          offset: page * 20,
          category: category || null,
        })
        setActivity(data?.events || [])
        setActivityTotal(data?.total || 0)
        setActivityPage(page)
      } catch (err) {
        showFeedback('error', `Failed to load system events: ${err.serverMessage || err.message}`)
      }
    },
    [showFeedback]
  )

  const refreshSystem = useCallback(async () => {
    setLoading(true)
    await Promise.all([
      refreshShell(),
      loadStorage(),
      loadAudit(auditPage),
      loadEvents(activityCategory, activityPage),
    ])
    setLoading(false)
  }, [refreshShell, loadStorage, loadAudit, loadEvents, auditPage, activityCategory, activityPage])

  useEffect(() => {
    refreshSystem()
  }, [refreshSystem])

  const emergencyStop = overview?.emergencyStop || { active: false }
  const stopActive = Boolean(emergencyStop.active)

  const handleEmergencyStop = () => {
    openConfirmDialog(
      {
        title: stopActive ? 'Clear Internal Trading Emergency Stop' : 'Activate Internal Trading Emergency Stop',
        message: stopActive
          ? 'Clear the emergency stop on TradeLoom’s internal trading account (usr_platform_canonical)? New automated internal paper orders will be permitted again, but any bots paused during the stop remain paused until explicitly resumed in Trading.'
          : 'Immediately pause all enabled bots owned by TradeLoom’s internal trading account (usr_platform_canonical), request cancellation of active internal paper orders, and block new internal worker submissions. Note: customer-owned bots are managed per customer account under Trading or Users.',
        scope: 'internal',
        scopeLabel: 'TradeLoom Internal Trading (usr_platform_canonical)',
        consequence: stopActive
          ? 'Removes order block; paused bots stay paused (0 auto-resumed).'
          : 'Pauses internal showcase bots and cancels active internal orders.',
        showInput: true,
        inputLabel: stopActive ? 'Clearance note (recorded in audit log)' : 'Activation reason (required for audit log)',
        inputPlaceholder: stopActive
          ? 'Reason for clearing emergency stop…'
          : 'Reason for activating emergency stop…',
        confirmLabel: stopActive ? 'Clear Emergency Stop' : 'Activate Emergency Stop',
        confirmVariant: stopActive ? 'primary' : 'danger',
        onConfirm: async (reasonText) => {
          setActionLoading(true)
          try {
            await setAdminEmergencyStop({
              active: !stopActive,
              reason:
                reasonText?.trim() ||
                (stopActive ? 'Admin cleared stop via System workspace' : 'Admin activated stop via System workspace'),
            })
            showFeedback(
              'success',
              stopActive
                ? 'Emergency stop cleared. Paused bots remain paused until resumed.'
                : 'Emergency stop activated for TradeLoom Internal Trading.'
            )
            await Promise.all([refreshShell(), loadAudit(0)])
            closeConfirmDialog()
          } catch (err) {
            showFeedback('error', `Emergency stop update failed: ${err.serverMessage || err.message}`)
          } finally {
            setActionLoading(false)
          }
        },
      },
      stopActive ? 'Issue resolved — clearing internal trading stop' : 'Operator activated emergency stop'
    )
  }

  const handlePruneWorkers = () => {
    openConfirmDialog({
      title: 'Prune Stale Worker Heartbeats',
      message:
        'Delete WorkerStatus heartbeat records that have not checked in within the last 10 minutes. Live running worker processes are not affected.',
      scope: 'infra',
      scopeLabel: 'System Infrastructure (WorkerStatus table)',
      consequence: 'Removes stale heartbeat rows from worker counts.',
      confirmLabel: 'Prune Stale Workers',
      confirmVariant: 'primary',
      onConfirm: async () => {
        setActionLoading(true)
        try {
          const res = await cleanupAdminWorkers(10)
          const deleted = res?.data?.deleted ?? res?.result?.deleted ?? res?.deleted ?? 0
          showFeedback('success', `Pruned stale worker records. Removed: ${deleted}.`)
          await Promise.all([refreshShell(), loadAudit(0)])
          closeConfirmDialog()
        } catch (err) {
          showFeedback('error', `Worker cleanup failed: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const handleCompactEvidence = () => {
    openConfirmDialog({
      title: 'Compact Superseded Strategy Evidence',
      message:
        'Prunes bulky historical equity-curve arrays from older superseded StrategyEvidence snapshots while preserving latest curves and all scalar return, drawdown, and trade counts.',
      scope: 'infra',
      scopeLabel: 'System Infrastructure (StrategyEvidence storage)',
      consequence: 'Reduces JSON storage size in database; preserves scalar audit metrics.',
      confirmLabel: 'Compact Historical Curves',
      confirmVariant: 'primary',
      onConfirm: async () => {
        setActionLoading(true)
        try {
          const res = await compactAdminEvidence()
          const count = res?.data?.compactedRows ?? res?.result?.compactedRows ?? res?.compactedRows ?? 0
          showFeedback('success', `Compacted historical strategy evidence (${count} rows updated).`)
          await Promise.all([loadStorage(), loadAudit(0)])
          closeConfirmDialog()
        } catch (err) {
          showFeedback('error', `Evidence compaction failed: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const workersList = overview?.workers?.list || []

  return (
    <>
      <header className="tl-admin-page-head">
        <div>
          <h1>System</h1>
          <p className="tl-admin-page-sub">
            Emergency safety controls, worker infrastructure, storage maintenance, and audit history
          </p>
        </div>
        <div className="tl-admin-head-actions">
          <Button variant="secondary" onClick={refreshSystem} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {/* 1. Prominent Emergency Stop Controls */}
      <section className="tl-admin-section" id="emergency-stop" aria-labelledby="safety-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="safety-heading">
                Emergency trading controls
              </h2>
              <ScopeBadge scope="internal" />
              <AdminPill tone={stopActive ? 'neg' : 'pos'}>
                {stopActive ? 'Emergency Stop Active' : 'Normal Operation'}
              </AdminPill>
            </div>
            <p className="tl-admin-section-desc">
              Explicitly authorized halt switch for TradeLoom&apos;s internal trading account (<code className="tl-admin-code">usr_platform_canonical</code>).
            </p>
          </div>
        </div>

        <div className={`tl-admin-action-card ${!stopActive ? 'tl-admin-action-card--danger' : ''}`.trim()}>
          <div>
            <h3>
              {stopActive
                ? 'Internal Trading Emergency Stop is Currently Active'
                : 'Internal Trading Emergency Stop'}
            </h3>
            <p>
              {stopActive
                ? `Activated ${emergencyStop.activatedAt ? formatDateTime(emergencyStop.activatedAt) : 'recently'}${
                    emergencyStop.reason ? ` — Reason: "${emergencyStop.reason}"` : ''
                  }. Internal showcase AI bots are paused and new internal paper executions are refused. Clearing this stop removes the submission block without automatically resuming paused bots.`
                : 'Pauses all enabled bots owned by TradeLoom’s internal platform account (usr_platform_canonical), requests cancellation of active internal paper orders, and refuses new internal submissions until cleared. Customer-owned bots are paused individually in Trading.'}
            </p>
            <div className="tl-admin-kv-inline">
              <span>Target scope: <strong>TradeLoom Internal Trading (usr_platform_canonical)</strong></span>
              <span>Authorization: <strong>Administrator (logged in Audit History)</strong></span>
            </div>
          </div>
          <div>
            {isAdmin ? (
              <Button
                variant={stopActive ? 'primary' : 'danger-solid'}
                onClick={handleEmergencyStop}
                disabled={actionLoading}
              >
                {stopActive ? 'Clear Emergency Stop…' : 'Activate Emergency Stop…'}
              </Button>
            ) : (
              <span className="tl-small tl-muted">Administrator role required to change emergency stop state.</span>
            )}
          </div>
        </div>
      </section>

      {/* 2. Worker Infrastructure & Evidence Storage Maintenance */}
      <section className="tl-admin-section" id="workers" aria-labelledby="infra-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="infra-heading">
                Infrastructure &amp; database maintenance
              </h2>
              <ScopeBadge scope="infra" />
            </div>
            <p className="tl-admin-section-desc">
              Worker node heartbeat monitoring and historical strategy evidence storage housekeeping.
            </p>
          </div>
        </div>

        <div className="tl-admin-cards-2">
          <div className="tl-admin-action-card">
            <div>
              <h3>Worker Heartbeat Cleanup</h3>
              <p>
                Removes dead worker heartbeat rows that have not checked in within the last 10 minutes. Does not interrupt active workers.
              </p>
              <div className="tl-admin-kv-inline">
                <span>Active workers: <strong>{overview?.workers?.activeCount ?? 0}</strong></span>
                <span>Stale records: <strong>{overview?.workers?.staleCount ?? 0}</strong></span>
                <span>Avg lag: <strong>{overview?.workers?.avgQueueLagMs ?? 0} ms</strong></span>
              </div>
            </div>
            {isAdmin && (
              <div>
                <Button variant="secondary" size="sm" onClick={handlePruneWorkers} disabled={actionLoading}>
                  Prune Stale Workers
                </Button>
              </div>
            )}
          </div>

          <div className="tl-admin-action-card">
            <div>
              <h3>Strategy Evidence Compaction</h3>
              <p>
                Strips superseded time-series curves from older StrategyEvidence rows while retaining all scalar return, drawdown, and trade audit facts.
              </p>
              {evidenceStorage && (
                <div className="tl-admin-kv-inline">
                  <span>Total rows: <strong>{evidenceStorage.totalRows}</strong></span>
                  <span>Sessions: <strong>{evidenceStorage.distinctSessions}</strong></span>
                  <span>Compacted: <strong>{evidenceStorage.compactedRows}</strong></span>
                  <span>Footprint: <strong>{evidenceStorage.estimatedStorageKb} KB</strong></span>
                </div>
              )}
            </div>
            {isAdmin && (
              <div>
                <Button variant="secondary" size="sm" onClick={handleCompactEvidence} disabled={actionLoading}>
                  Compact Superseded Evidence
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="tl-admin-table-card">
          <div className="tl-admin-toolbar">
            <strong style={{ fontSize: '13.5px' }}>Registered worker nodes</strong>
          </div>
          <div className="tl-admin-table-scroll">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Worker ID</th>
                  <th>Status</th>
                  <th>Queue Lag</th>
                  <th>Started</th>
                  <th>Last Heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {workersList.length > 0 ? (
                  workersList.map((w) => (
                    <tr key={w.id}>
                      <td>
                        <code className="tl-admin-code">{w.id}</code>
                      </td>
                      <td>
                        <AdminPill tone={w.isActive ? 'pos' : 'warn'}>
                          {w.isActive ? 'Active' : 'Stale'}
                        </AdminPill>
                      </td>
                      <td className="tl-num">{w.queueLagMs != null ? `${w.queueLagMs} ms` : '—'}</td>
                      <td className="tl-num tl-nowrap">{formatDateTime(w.startedAt)}</td>
                      <td className="tl-num tl-nowrap">{formatDateTime(w.lastSeen)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="tl-admin-empty">
                      No worker nodes currently registered.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 3. Administrative Audit History & System Events */}
      <section className="tl-admin-section" id="audit" aria-labelledby="audit-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="audit-heading">
                Audit history &amp; system events
              </h2>
              <ScopeBadge scope="infra" />
            </div>
            <p className="tl-admin-section-desc">
              Immutable record of administrative actions alongside automated bot and order execution events.
            </p>
          </div>
        </div>

        <div className="tl-admin-table-card">
          <div className="tl-admin-toolbar">
            <strong style={{ fontSize: '13.5px' }}>Administrative audit log</strong>
          </div>
          <div className="tl-admin-table-scroll">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Administrator</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Details</th>
                  <th>IP Address</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length > 0 ? (
                  auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="tl-num tl-nowrap">{formatDateTime(log.createdAt)}</td>
                      <td>
                        <span className="tl-admin-cell-primary">
                          {log.admin?.fullName || log.admin?.email || log.adminId}
                        </span>
                        {log.admin?.email && (
                          <span className="tl-admin-cell-sub">{log.admin.email}</span>
                        )}
                      </td>
                      <td>
                        <AdminPill tone="accent">{log.action}</AdminPill>
                      </td>
                      <td>
                        <span className="tl-admin-code">{log.targetType}</span>
                        {log.targetId && (
                          <span className="tl-admin-cell-sub">{log.targetId}</span>
                        )}
                      </td>
                      <td>
                        {log.payload ? (
                          <Disclosure label="View parameters">
                            <pre className="tl-admin-pre">
                              {JSON.stringify(log.payload, null, 2)}
                            </pre>
                          </Disclosure>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="tl-num">{log.ipAddress || 'internal'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="tl-admin-empty">
                      No administrative mutations recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <AdminPagination
            page={auditPage}
            pageSize={20}
            total={auditTotal}
            itemLabel="audit records"
            onPageChange={(nextPage) => loadAudit(nextPage)}
          />
        </div>

        <div className="tl-admin-table-card">
          <div className="tl-admin-toolbar">
            <strong style={{ fontSize: '13.5px' }}>Automated engine &amp; order event stream</strong>
            <div className="tl-admin-toolbar-filters" style={{ flex: '0 1 auto' }}>
              <Select
                aria-label="Filter system events by source"
                value={activityCategory}
                onChange={(e) => {
                  setActivityCategory(e.target.value)
                  loadEvents(e.target.value, 0)
                }}
              >
                <option value="">All sources</option>
                <option value="bot_event">Bot events</option>
                <option value="execution_audit">Order audits</option>
              </Select>
            </div>
          </div>
          <div className="tl-admin-table-scroll">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Source</th>
                  <th>Event Type</th>
                  <th>Summary</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {activity.length > 0 ? (
                  activity.map((item) => (
                    <tr key={item.id}>
                      <td className="tl-num tl-nowrap">{formatDateTime(item.timestamp)}</td>
                      <td>
                        <AdminPill tone={item.source === 'bot_event' ? 'neutral' : 'accent'}>
                          {item.source}
                        </AdminPill>
                      </td>
                      <td>
                        <span className="tl-admin-code">{item.type}</span>
                      </td>
                      <td>{item.detail || '—'}</td>
                      <td>
                        <span className="tl-admin-code">{item.refId || '—'}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="tl-admin-empty">
                      No automated operational events recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <AdminPagination
            page={activityPage}
            pageSize={20}
            total={activityTotal}
            itemLabel="events"
            onPageChange={(nextPage) => loadEvents(activityCategory, nextPage)}
          />
        </div>
      </section>
    </>
  )
}
