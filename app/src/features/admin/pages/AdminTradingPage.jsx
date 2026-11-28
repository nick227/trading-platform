import { useCallback, useEffect, useState } from 'react'
import {
  cancelAdminExecution,
  fetchAdminBotDetail,
  fetchAdminBots,
  fetchAdminBrokerFleetStatus,
  fetchAdminExecutions,
  toggleAdminBot,
  triggerAdminBrokerReconcileAll,
} from '../../../api/adminClient'
import { Button, Disclosure, Input, Notice, Select, Sheet } from '../../../components/ui'
import { useAdminShell } from '../AdminLayout'
import {
  AdminPagination,
  AdminPill,
  formatDateTime,
  formatMoney,
  isPlatformAccount,
  ScopeBadge,
} from '../adminShared'

export default function AdminTradingPage() {
  const {
    isAdmin,
    actionLoading,
    setActionLoading,
    showFeedback,
    openConfirmDialog,
    closeConfirmDialog,
    refreshShell,
    setBrokerSummary,
  } = useAdminShell()

  // Broker Sync state
  const [brokerFleet, setBrokerFleet] = useState(null)
  const [reconciling, setReconciling] = useState(false)

  // Orders & Fills state
  const [executions, setExecutions] = useState([])
  const [executionsTotal, setExecutionsTotal] = useState(0)
  const [executionStatus, setExecutionStatus] = useState('')
  const [executionTicker, setExecutionTicker] = useState('')
  const [ordersPage, setOrdersPage] = useState(0)

  // Bots state
  const [bots, setBots] = useState([])
  const [botsTotal, setBotsTotal] = useState(0)
  const [botSearch, setBotSearch] = useState('')
  const [botStatus, setBotStatus] = useState('')
  const [botType, setBotType] = useState('')
  const [botsPage, setBotsPage] = useState(0)
  const [selectedBot, setSelectedBot] = useState(null)
  const [botDetailLoading, setBotDetailLoading] = useState(false)

  const [loading, setLoading] = useState(true)

  const loadBroker = useCallback(async () => {
    try {
      const res = await fetchAdminBrokerFleetStatus()
      const data = res?.data ?? res
      if (data) {
        setBrokerFleet(data)
        setBrokerSummary(data)
      }
    } catch {
      // optional
    }
  }, [setBrokerSummary])

  const loadExecutions = useCallback(
    async (status = '', ticker = '', page = 0) => {
      try {
        const data = await fetchAdminExecutions({
          limit: 20,
          offset: page * 20,
          status: status || null,
          ticker: ticker || null,
        })
        setExecutions(data?.executions || [])
        setExecutionsTotal(data?.total || 0)
        setOrdersPage(page)
      } catch (err) {
        showFeedback('error', `Failed to load orders: ${err.serverMessage || err.message}`)
      }
    },
    [showFeedback]
  )

  const loadBots = useCallback(
    async (search = '', status = '', type = '', page = 0) => {
      try {
        const data = await fetchAdminBots({
          limit: 20,
          offset: page * 20,
          search,
          status: status || null,
          botType: type || null,
        })
        setBots(data?.bots || [])
        setBotsTotal(data?.total || 0)
        setBotsPage(page)
      } catch (err) {
        showFeedback('error', `Failed to load trading bots: ${err.serverMessage || err.message}`)
      }
    },
    [showFeedback]
  )

  const refreshTrading = useCallback(async () => {
    setLoading(true)
    await Promise.all([
      loadBroker(),
      loadExecutions(executionStatus, executionTicker, ordersPage),
      loadBots(botSearch, botStatus, botType, botsPage),
    ])
    setLoading(false)
  }, [
    loadBroker,
    loadExecutions,
    loadBots,
    executionStatus,
    executionTicker,
    ordersPage,
    botSearch,
    botStatus,
    botType,
    botsPage,
  ])

  useEffect(() => {
    refreshTrading()
  }, [refreshTrading])

  const handleReconcileFleet = () => {
    openConfirmDialog({
      title: 'Trigger Fleet Broker Reconciliation',
      message: brokerFleet?.simulatedMode
        ? 'Platform is currently in Simulated Broker mode. Running reconciliation will refresh simulated sync checkpoints without calling external Alpaca endpoints.'
        : 'Import recent Alpaca orders and compare recorded TradeLoom positions against broker actuals across all active connected customer accounts.',
      scope: 'customer',
      scopeLabel: 'Customer Connected Broker Accounts',
      consequence: 'Updates local execution records and position sync checkpoints.',
      confirmLabel: 'Run Fleet Reconciliation',
      confirmVariant: 'primary',
      onConfirm: async () => {
        setReconciling(true)
        setActionLoading(true)
        try {
          const res = await triggerAdminBrokerReconcileAll()
          const data = res?.data ?? res
          showFeedback(
            'success',
            `Fleet reconciliation complete: ${data?.succeeded ?? 0} accounts synchronized, ${data?.failed ?? 0} failed.`
          )
          await Promise.all([loadBroker(), refreshShell()])
          closeConfirmDialog()
        } catch (err) {
          showFeedback('error', `Fleet reconciliation failed: ${err.serverMessage || err.message}`)
        } finally {
          setReconciling(false)
          setActionLoading(false)
        }
      },
    })
  }

  const handleCancelOrder = (ex) => {
    const internal = isPlatformAccount(ex.userId, ex.user?.email)
    openConfirmDialog(
      {
        title: `Cancel Order: ${ex.ticker} (${ex.id})`,
        message:
          'Marks this unfilled order cancelled in the TradeLoom database. Note: if an order has already been submitted to an external live broker, verify cancellation directly with the broker to avoid position drift.',
        scope: internal ? 'internal' : 'customer',
        scopeLabel: internal
          ? 'Internal Trading Order'
          : `Customer Order (${ex.user?.email || ex.userId})`,
        consequence: 'Sets local execution status to cancelled and records an audit entry.',
        showInput: true,
        inputLabel: 'Cancellation reason',
        inputPlaceholder: 'Reason for administrative cancellation…',
        confirmLabel: 'Confirm Order Cancellation',
        confirmVariant: 'danger',
        onConfirm: async (reason) => {
          setActionLoading(true)
          try {
            await cancelAdminExecution(ex.id, reason || 'Admin cancelled order')
            showFeedback('success', `Order ${ex.id} (${ex.ticker}) marked cancelled.`)
            await Promise.all([
              loadExecutions(executionStatus, executionTicker, ordersPage),
              refreshShell(),
            ])
            closeConfirmDialog()
          } catch (err) {
            showFeedback('error', `Failed to cancel order: ${err.serverMessage || err.message}`)
          } finally {
            setActionLoading(false)
          }
        },
      },
      'Admin manual cancellation from Trading workspace'
    )
  }

  const handleToggleBot = (bot) => {
    const internal = isPlatformAccount(bot.userId, bot.user?.email)
    openConfirmDialog({
      title: bot.enabled ? `Pause Bot: ${bot.name}` : `Resume Bot: ${bot.name}`,
      message: bot.enabled
        ? `Pause '${bot.name}'? Automated signal evaluations and new order submissions for this bot will stop until resumed.`
        : `Resume automated trading evaluations for '${bot.name}'?`,
      scope: internal ? 'internal' : 'customer',
      scopeLabel: internal
        ? `Internal Trading Bot (${bot.name})`
        : `Customer Bot (${bot.user?.email || bot.userId})`,
      consequence: bot.enabled
        ? 'Sets bot to Paused; does not cancel orders already in flight.'
        : 'Re-enables scheduled evaluations for this bot.',
      confirmLabel: bot.enabled ? 'Pause Bot' : 'Resume Bot',
      confirmVariant: bot.enabled ? 'danger' : 'primary',
      onConfirm: async () => {
        setActionLoading(true)
        try {
          await toggleAdminBot(bot.id)
          showFeedback('success', `Bot '${bot.name}' ${bot.enabled ? 'paused' : 'resumed'}.`)
          await Promise.all([
            loadBots(botSearch, botStatus, botType, botsPage),
            refreshShell(),
          ])
          if (selectedBot?.bot?.id === bot.id) {
            const detailRes = await fetchAdminBotDetail(bot.id)
            setSelectedBot(detailRes?.data || detailRes)
          }
          closeConfirmDialog()
        } catch (err) {
          showFeedback('error', `Failed to update bot state: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const handleInspectBot = async (botId) => {
    setBotDetailLoading(true)
    try {
      const res = await fetchAdminBotDetail(botId)
      setSelectedBot(res?.data || res)
    } catch (err) {
      showFeedback('error', `Failed to load bot details: ${err.serverMessage || err.message}`)
    } finally {
      setBotDetailLoading(false)
    }
  }

  const driftedCount = Number(brokerFleet?.fleet?.driftedAccountsCount || 0)

  return (
    <>
      <header className="tl-admin-page-head">
        <div>
          <h1>Trading</h1>
          <p className="tl-admin-page-sub">
            Customer and internal bots, orders, broker connections, and position reconciliation
          </p>
        </div>
        <div className="tl-admin-head-actions">
          <Button variant="secondary" onClick={refreshTrading} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {/* 1. Broker Connections & Position Sync */}
      <section className="tl-admin-section" id="broker-sync" aria-labelledby="broker-sync-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="broker-sync-heading">
                Broker connections &amp; position sync
              </h2>
              <ScopeBadge scope="customer" />
            </div>
            <p className="tl-admin-section-desc">
              Verifies that recorded TradeLoom share quantities match connected customer Alpaca accounts.
            </p>
          </div>
          {isAdmin && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleReconcileFleet}
              disabled={reconciling || actionLoading}
            >
              {reconciling ? 'Reconciling…' : 'Reconcile Broker Accounts'}
            </Button>
          )}
        </div>

        <div className="tl-admin-kpi-grid">
          <div className="tl-admin-kpi">
            <span className="tl-admin-kpi-label">Connected accounts</span>
            <div className="tl-admin-kpi-value">{brokerFleet?.fleet?.totalAccounts ?? 0}</div>
            <div className="tl-admin-kpi-meta">
              <span>{brokerFleet?.fleet?.paperAccounts ?? 0} paper</span>
              <span>{brokerFleet?.fleet?.liveAccounts ?? 0} live</span>
            </div>
          </div>
          <div className="tl-admin-kpi">
            <span className="tl-admin-kpi-label">In sync</span>
            <div className="tl-admin-kpi-value">{brokerFleet?.fleet?.inSyncAccounts ?? 0}</div>
            <div className="tl-admin-kpi-meta">
              <span>Positions match recorded fills</span>
            </div>
          </div>
          <div className="tl-admin-kpi">
            <span className="tl-admin-kpi-label">Out of sync (drifted)</span>
            <div className="tl-admin-kpi-value">{driftedCount}</div>
            <div className="tl-admin-kpi-meta">
              <span>{driftedCount > 0 ? 'Requires reconciliation' : 'Zero position drift'}</span>
            </div>
          </div>
          <div className="tl-admin-kpi">
            <span className="tl-admin-kpi-label">Execution mode</span>
            <div className="tl-admin-kpi-value" style={{ fontSize: '20px' }}>
              {brokerFleet?.simulatedMode ? 'Simulated' : 'External Broker'}
            </div>
            <div className="tl-admin-kpi-meta">
              <span>
                {brokerFleet?.simulatedMode
                  ? 'Fills settle against daily Alpha Engine bars'
                  : 'Syncs against Alpaca REST positions'}
              </span>
            </div>
          </div>
        </div>

        {brokerFleet?.driftedAccounts?.length > 0 && (
          <div className="tl-admin-table-card">
            <div className="tl-admin-toolbar">
              <strong style={{ fontSize: '13.5px', color: 'var(--tl-neg)' }}>
                Position drift detected in {brokerFleet.driftedAccounts.length} customer{' '}
                {brokerFleet.driftedAccounts.length === 1 ? 'account' : 'accounts'}
              </strong>
            </div>
            <div className="tl-admin-table-scroll">
              <table className="tl-admin-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Account Mode</th>
                    <th>Mismatches</th>
                    <th>Symbol Discrepancies (Recorded vs. Broker)</th>
                  </tr>
                </thead>
                <tbody>
                  {brokerFleet.driftedAccounts.map((d, idx) => (
                    <tr key={`${d.userId}-${idx}`}>
                      <td className="tl-admin-cell-primary">{d.userEmail}</td>
                      <td>{d.paper ? 'Paper' : 'Live'}</td>
                      <td className="tl-num">
                        <AdminPill tone="neg">{d.mismatchCount}</AdminPill>
                      </td>
                      <td>
                        {d.mismatchDetails
                          ?.map((m) => `${m.symbol}: recorded ${m.localQty}, broker ${m.brokerQty}`)
                          .join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* 2. Orders & Fills */}
      <section className="tl-admin-section" id="orders" aria-labelledby="orders-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="orders-heading">
                Orders &amp; fills
              </h2>
              <ScopeBadge scope="customer" label="Customer & Internal" />
            </div>
            <p className="tl-admin-section-desc">
              Target Price reflects the reference price when the decision was made; Executed Price is the actual fill price at market open.
            </p>
          </div>
        </div>

        <div className="tl-admin-table-card">
          <div className="tl-admin-toolbar">
            <div className="tl-admin-toolbar-filters">
              <Input
                placeholder="Filter by symbol (e.g. AAPL)…"
                aria-label="Filter orders by symbol"
                value={executionTicker}
                onChange={(e) => setExecutionTicker(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadExecutions(executionStatus, executionTicker, 0)
                }}
              />
              <Select
                aria-label="Filter orders by status"
                value={executionStatus}
                onChange={(e) => {
                  setExecutionStatus(e.target.value)
                  loadExecutions(e.target.value, executionTicker, 0)
                }}
              >
                <option value="">All statuses</option>
                <option value="queued">Queued</option>
                <option value="pending_fill">Pending fill</option>
                <option value="filled">Filled</option>
                <option value="cancelled">Cancelled</option>
                <option value="failed">Failed</option>
                <option value="refused">Refused</option>
              </Select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => loadExecutions(executionStatus, executionTicker, 0)}
              >
                Apply Filter
              </Button>
            </div>
          </div>

          <div className="tl-admin-table-scroll">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Order</th>
                  <th>Scope &amp; Owner</th>
                  <th>Target Price vs. Executed Price</th>
                  <th>Status</th>
                  <th>Reason / Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {executions.length > 0 ? (
                  executions.map((ex) => {
                    const cancellable = ['queued', 'pending_fill', 'processing'].includes(ex.status)
                    const internal = isPlatformAccount(ex.userId, ex.user?.email)
                    const statusTone =
                      ex.status === 'filled'
                        ? 'pos'
                        : ['cancelled', 'failed', 'refused'].includes(ex.status)
                        ? 'neg'
                        : 'warn'

                    return (
                      <tr key={ex.id}>
                        <td className="tl-num tl-nowrap">{formatDateTime(ex.createdAt)}</td>
                        <td>
                          <span className="tl-admin-cell-primary">
                            {ex.direction?.toUpperCase()} {ex.quantity} {ex.ticker}
                          </span>
                          <span className="tl-admin-cell-sub">{ex.id}</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <ScopeBadge
                              scope={internal ? 'internal' : 'customer'}
                              label={internal ? 'Internal' : 'Customer'}
                            />
                            <span className="tl-admin-cell-primary">
                              {ex.bot?.name || ex.botId || 'Manual order'}
                            </span>
                          </div>
                          <span className="tl-admin-cell-sub">{ex.user?.email || ex.userId}</span>
                        </td>
                        <td className="tl-num">
                          <div>Target: {ex.price ? formatMoney(ex.price) : 'Market'}</div>
                          <span className="tl-admin-cell-sub">
                            {ex.filledPrice != null
                              ? `Executed: ${formatMoney(ex.filledPrice)}`
                              : 'Executed: Pending'}
                          </span>
                        </td>
                        <td>
                          <AdminPill tone={statusTone}>{ex.status}</AdminPill>
                        </td>
                        <td>{ex.diagnostics || '—'}</td>
                        <td>
                          {cancellable && isAdmin && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleCancelOrder(ex)}
                              disabled={actionLoading}
                            >
                              Cancel
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="tl-admin-empty">
                      No orders match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <AdminPagination
            page={ordersPage}
            pageSize={20}
            total={executionsTotal}
            itemLabel="orders"
            onPageChange={(nextPage) => loadExecutions(executionStatus, executionTicker, nextPage)}
          />
        </div>
      </section>

      {/* 3. Trading Bots */}
      <section className="tl-admin-section" id="bots" aria-labelledby="bots-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="bots-heading">
                Trading bots
              </h2>
              <ScopeBadge scope="customer" label="Customer & Internal" />
            </div>
            <p className="tl-admin-section-desc">
              Inspect configuration, portfolio equity, and event history across customer bots and TradeLoom&apos;s internal showcase bots.
            </p>
          </div>
        </div>

        <div className="tl-admin-table-card">
          <div className="tl-admin-toolbar">
            <div className="tl-admin-toolbar-filters">
              <Input
                placeholder="Search by bot name or ID…"
                aria-label="Search bots"
                value={botSearch}
                onChange={(e) => setBotSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadBots(botSearch, botStatus, botType, 0)
                }}
              />
              <Select
                aria-label="Filter bots by status"
                value={botStatus}
                onChange={(e) => {
                  setBotStatus(e.target.value)
                  loadBots(botSearch, e.target.value, botType, 0)
                }}
              >
                <option value="">All statuses</option>
                <option value="active">Running</option>
                <option value="paused">Paused</option>
              </Select>
              <Select
                aria-label="Filter bots by type"
                value={botType}
                onChange={(e) => {
                  setBotType(e.target.value)
                  loadBots(botSearch, botStatus, e.target.value, 0)
                }}
              >
                <option value="">All types</option>
                <option value="ai">AI strategies</option>
                <option value="rule">Rule-based</option>
              </Select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => loadBots(botSearch, botStatus, botType, 0)}
              >
                Search
              </Button>
            </div>
          </div>

          <div className="tl-admin-table-scroll">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Bot</th>
                  <th>Scope &amp; Owner</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Portfolio Equity</th>
                  <th>Filled Trades</th>
                  <th>Latest Event</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bots.length > 0 ? (
                  bots.map((b) => {
                    const isAi = b.botType?.includes('ai') || b.templateId?.startsWith('tmpl_ai_')
                    const internal = isPlatformAccount(b.userId, b.user?.email)
                    return (
                      <tr key={b.id}>
                        <td>
                          <span className="tl-admin-cell-primary">{b.name}</span>
                          <span className="tl-admin-cell-sub">
                            {b.id} {b.templateId ? `· ${b.templateId}` : ''}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <ScopeBadge
                              scope={internal ? 'internal' : 'customer'}
                              label={internal ? 'Internal' : 'Customer'}
                            />
                            <span>{b.user?.fullName || b.user?.email || b.userId}</span>
                          </div>
                          {b.user?.email && <span className="tl-admin-cell-sub">{b.user.email}</span>}
                        </td>
                        <td>
                          <AdminPill tone={isAi ? 'accent' : 'neutral'}>
                            {isAi ? 'AI Strategy' : 'Rule-based'}
                          </AdminPill>
                        </td>
                        <td>
                          <AdminPill tone={b.enabled ? 'pos' : 'warn'}>
                            {b.enabled ? 'Running' : 'Paused'}
                          </AdminPill>
                        </td>
                        <td className="tl-num">
                          {b.portfolio ? (
                            <>
                              <span className="tl-admin-cell-primary">
                                {formatMoney(b.portfolio.totalValue)}
                              </span>
                              <span className="tl-admin-cell-sub">
                                Cash: {formatMoney(b.portfolio.cashBalance)}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="tl-num">{b.filledExecutionsCount ?? 0}</td>
                        <td>
                          {b.lastEvent ? (
                            <>
                              <span className="tl-admin-code">{b.lastEvent.type}</span>
                              <span className="tl-admin-cell-sub">
                                {formatDateTime(b.lastEvent.createdAt)}
                              </span>
                            </>
                          ) : (
                            <span className="tl-muted tl-small">No events</span>
                          )}
                        </td>
                        <td>
                          <div className="tl-admin-row-actions">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleInspectBot(b.id)}
                              disabled={botDetailLoading}
                            >
                              Inspect
                            </Button>
                            {isAdmin && (
                              <Button
                                variant={b.enabled ? 'danger' : 'primary'}
                                size="sm"
                                onClick={() => handleToggleBot(b)}
                                disabled={actionLoading}
                              >
                                {b.enabled ? 'Pause' : 'Resume'}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="tl-admin-empty">
                      No bots match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <AdminPagination
            page={botsPage}
            pageSize={20}
            total={botsTotal}
            itemLabel="bots"
            onPageChange={(nextPage) => loadBots(botSearch, botStatus, botType, nextPage)}
          />
        </div>
      </section>

      {/* Pattern 3: Bot Detail Drawer */}
      {selectedBot && (
        <Sheet
          title={`Bot Inspector: ${selectedBot.bot?.name || selectedBot.bot?.id}`}
          className="sheet--admin-drawer"
          onClose={() => setSelectedBot(null)}
        >
          <div className="tl-admin-drawer-meta">
            <ScopeBadge
              scope={isPlatformAccount(selectedBot.bot?.userId, selectedBot.user?.email) ? 'internal' : 'customer'}
            />
            <span>Owner: <strong>{selectedBot.user?.email || selectedBot.bot?.userId}</strong></span>
            <span>ID: <code className="tl-admin-code">{selectedBot.bot?.id}</code></span>
            <span>Template: <strong>{selectedBot.bot?.templateId || 'Custom'}</strong></span>
          </div>

          <div className="tl-admin-kpi-grid">
            <div className="tl-admin-kpi">
              <span className="tl-admin-kpi-label">Status</span>
              <div className="tl-admin-kpi-value" style={{ fontSize: '20px' }}>
                {selectedBot.bot?.enabled ? 'Running' : 'Paused'}
              </div>
            </div>
            <div className="tl-admin-kpi">
              <span className="tl-admin-kpi-label">Portfolio Value</span>
              <div className="tl-admin-kpi-value" style={{ fontSize: '20px' }}>
                {formatMoney(selectedBot.portfolio?.totalValue)}
              </div>
            </div>
            <div className="tl-admin-kpi">
              <span className="tl-admin-kpi-label">Available Cash</span>
              <div className="tl-admin-kpi-value" style={{ fontSize: '20px' }}>
                {formatMoney(selectedBot.portfolio?.cashBalance)}
              </div>
            </div>
            <div className="tl-admin-kpi">
              <span className="tl-admin-kpi-label">Rules</span>
              <div className="tl-admin-kpi-value" style={{ fontSize: '20px' }}>
                {selectedBot.rules?.length ?? 0}
              </div>
            </div>
          </div>

          <div className="tl-admin-drawer-section">
            <Disclosure label="View technical bot configuration (JSON)">
              <pre className="tl-admin-pre">
                {JSON.stringify(selectedBot.bot?.config ?? {}, null, 2)}
              </pre>
            </Disclosure>
          </div>

          <div className="tl-admin-drawer-section">
            <h3>Recent orders</h3>
            {selectedBot.recentExecutions?.length > 0 ? (
              <div className="tl-admin-table-card">
                <div className="tl-admin-table-scroll">
                  <table className="tl-admin-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Symbol</th>
                        <th>Side / Qty</th>
                        <th>Status</th>
                        <th>Executed Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBot.recentExecutions.map((e) => (
                        <tr key={e.id}>
                          <td className="tl-num tl-nowrap">{formatDateTime(e.createdAt)}</td>
                          <td className="tl-admin-cell-primary">{e.ticker}</td>
                          <td className="tl-num">
                            {e.direction?.toUpperCase()} {e.quantity}
                          </td>
                          <td>
                            <AdminPill tone={e.status === 'filled' ? 'pos' : 'neutral'}>
                              {e.status}
                            </AdminPill>
                          </td>
                          <td className="tl-num">
                            {e.filledPrice != null ? formatMoney(e.filledPrice) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <Notice tone="info">No executions recorded for this bot.</Notice>
            )}
          </div>

          <div className="tl-admin-drawer-section">
            <h3>Recent event history</h3>
            {selectedBot.recentEvents?.length > 0 ? (
              <div className="tl-admin-table-card">
                <div className="tl-admin-table-scroll">
                  <table className="tl-admin-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Type</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBot.recentEvents.map((ev) => (
                        <tr key={ev.id}>
                          <td className="tl-num tl-nowrap">{formatDateTime(ev.createdAt)}</td>
                          <td>
                            <span className="tl-admin-code">{ev.type}</span>
                          </td>
                          <td>{ev.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="tl-small tl-muted m0">No recent events recorded.</p>
            )}
          </div>
        </Sheet>
      )}
    </>
  )
}
