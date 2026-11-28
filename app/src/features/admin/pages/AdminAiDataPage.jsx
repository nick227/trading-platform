import { useCallback, useEffect, useState } from 'react'
import {
  fetchAdminAiCycleDetail,
  fetchAdminAiCycles,
  fetchAdminAiDecisions,
  fetchAdminMarketDataDiagnostics,
  fetchAdminResearchDiagnostics,
  revalidateAdminMarketFeed,
  runAdminAiResearch,
  runAdminEvidenceSync,
  runAdminMarketOpen,
} from '../../../api/adminClient'
import { Button, Disclosure, Input, Notice, Select, Sheet } from '../../../components/ui'
import { useAdminShell } from '../AdminLayout'
import { AdminPagination, AdminPill, formatDateTime, ScopeBadge } from '../adminShared'

export default function AdminAiDataPage() {
  const {
    isAdmin,
    actionLoading,
    setActionLoading,
    showFeedback,
    openConfirmDialog,
    closeConfirmDialog,
    refreshShell,
    setFeedSummary,
  } = useAdminShell()

  const [marketData, setMarketData] = useState(null)
  const [revalidating, setRevalidating] = useState(false)

  const [researchDiag, setResearchDiag] = useState(null)
  const [researchLoading, setResearchLoading] = useState(false)

  const [cycles, setCycles] = useState([])
  const [cyclesTotal, setCyclesTotal] = useState(0)
  const [cyclesMetrics, setCyclesMetrics] = useState(null)
  const [cyclesPage, setCyclesPage] = useState(0)
  const [selectedCycle, setSelectedCycle] = useState(null)
  const [cycleDetailLoading, setCycleDetailLoading] = useState(false)

  const [decisions, setDecisions] = useState([])
  const [decisionsTotal, setDecisionsTotal] = useState(0)
  const [symbolFilter, setSymbolFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [decisionsPage, setDecisionsPage] = useState(0)

  const [loading, setLoading] = useState(true)

  const loadFeeds = useCallback(async () => {
    try {
      const res = await fetchAdminMarketDataDiagnostics()
      const data = res?.data ?? res
      setMarketData(data)
      if (data) setFeedSummary(data)
    } catch (err) {
      showFeedback('error', `Failed to load market feed diagnostics: ${err.serverMessage || err.message}`)
    }
  }, [setFeedSummary, showFeedback])

  const loadSignalGate = useCallback(async () => {
    setResearchLoading(true)
    try {
      const res = await fetchAdminResearchDiagnostics()
      setResearchDiag(res?.data ?? res)
    } catch (err) {
      showFeedback('error', `Failed to load signal diagnostics: ${err.serverMessage || err.message}`)
    } finally {
      setResearchLoading(false)
    }
  }, [showFeedback])

  const loadCycles = useCallback(
    async (page = 0) => {
      try {
        const data = await fetchAdminAiCycles({ limit: 20, offset: page * 20 })
        setCycles(data?.cycles || [])
        setCyclesTotal(data?.total || 0)
        setCyclesMetrics(data?.metrics || null)
        setCyclesPage(page)
      } catch (err) {
        showFeedback('error', `Failed to load AI research cycles: ${err.serverMessage || err.message}`)
      }
    },
    [showFeedback]
  )

  const loadDecisions = useCallback(
    async (sym = '', act = '', page = 0) => {
      try {
        const data = await fetchAdminAiDecisions({
          symbol: sym || null,
          action: act || null,
          limit: 20,
          offset: page * 20,
        })
        setDecisions(data?.decisions || [])
        setDecisionsTotal(data?.total || 0)
        setDecisionsPage(page)
      } catch (err) {
        showFeedback('error', `Failed to load AI symbol decisions: ${err.serverMessage || err.message}`)
      }
    },
    [showFeedback]
  )

  const refreshAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([
      loadFeeds(),
      loadSignalGate(),
      loadCycles(cyclesPage),
      loadDecisions(symbolFilter, actionFilter, decisionsPage),
    ])
    setLoading(false)
  }, [loadFeeds, loadSignalGate, loadCycles, loadDecisions, cyclesPage, symbolFilter, actionFilter, decisionsPage])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  const handleRevalidateFeeds = async () => {
    setRevalidating(true)
    try {
      const res = await revalidateAdminMarketFeed({ session: marketData?.session })
      const data = res?.data ?? res
      setMarketData(data)
      setFeedSummary(data)
      showFeedback(
        'success',
        `Market feeds verified for ${data?.session || 'latest session'}: ${data?.summary?.healthy ?? 0}/${data?.summary?.total ?? 10} symbols healthy.`
      )
    } catch (err) {
      showFeedback('error', `Market feed verification failed: ${err.serverMessage || err.message}`)
    } finally {
      setRevalidating(false)
    }
  }

  const handleRunMarketOpen = () => {
    openConfirmDialog({
      title: 'Process Queued Market-Open Paper Fills',
      message:
        'Processes queued next-open paper orders for TradeLoom’s showcase AI bot (bot_canonical_ai_catalyst_momentum) using opening bars from Alpha Engine. Automatically skips weekends and exchange holidays.',
      scope: 'internal',
      scopeLabel: 'Internal Trading (bot_canonical_ai_catalyst_momentum)',
      consequence: 'Fills eligible queued internal paper orders; does not touch customer bots.',
      confirmLabel: 'Run Market-Open Fills',
      confirmVariant: 'primary',
      onConfirm: async () => {
        setActionLoading(true)
        try {
          const res = await runAdminMarketOpen()
          const data = res?.data ?? res
          if (data?.skipped) {
            showFeedback('success', `Skipped market-open fills (${data.reason || 'exchange closed today'}).`)
          } else {
            showFeedback('success', `Market-open fills processed: ${data?.filledCount ?? 0} filled.`)
          }
          await Promise.all([refreshAll(), refreshShell()])
          closeConfirmDialog()
        } catch (err) {
          showFeedback('error', `Market-open fill run failed: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const handleRunAiResearch = () => {
    openConfirmDialog({
      title: 'Run Daily AI Research Cycle',
      message:
        'Runs the full post-close workflow for TradeLoom’s showcase AI bot: processes eligible pending paper fills, validates 10-symbol bars, requests structured evaluations from OpenAI (gpt-4o-mini), queues next-open paper orders, and updates public strategy evidence.',
      scope: 'internal',
      scopeLabel: 'Internal Trading (bot_canonical_ai_catalyst_momentum)',
      consequence: 'Incurs LLM token usage (unless cached) and queues internal next-open paper orders.',
      confirmLabel: 'Run Research Cycle',
      confirmVariant: 'primary',
      onConfirm: async () => {
        setActionLoading(true)
        try {
          await runAdminAiResearch()
          showFeedback('success', 'Daily AI research cycle completed.')
          await Promise.all([refreshAll(), refreshShell()])
          closeConfirmDialog()
        } catch (err) {
          showFeedback('error', `AI research cycle failed: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const handleSyncEvidence = () => {
    openConfirmDialog({
      title: 'Synchronize Public Strategy Evidence',
      message:
        'Recomputes and publishes standardized 5-year, 1-year, holdout, and forward simulation results across platform strategy templates.',
      scope: 'internal',
      scopeLabel: 'Internal Trading & Public Strategy Catalog',
      consequence: 'Upserts StrategyEvidence snapshots; does not affect customer accounts.',
      confirmLabel: 'Synchronize Evidence',
      confirmVariant: 'primary',
      onConfirm: async () => {
        setActionLoading(true)
        try {
          await runAdminEvidenceSync()
          showFeedback('success', 'Public strategy evidence synchronized.')
          await Promise.all([refreshAll(), refreshShell()])
          closeConfirmDialog()
        } catch (err) {
          showFeedback('error', `Evidence sync failed: ${err.serverMessage || err.message}`)
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const handleInspectCycle = async (cycleId) => {
    setCycleDetailLoading(true)
    try {
      const data = await fetchAdminAiCycleDetail(cycleId)
      setSelectedCycle(data)
    } catch (err) {
      showFeedback('error', `Failed to load AI cycle details: ${err.serverMessage || err.message}`)
    } finally {
      setCycleDetailLoading(false)
    }
  }

  const verdictEligible = researchDiag?.summary?.tradingEligibilityVerdict === 'ELIGIBLE'

  return (
    <>
      <header className="tl-admin-page-head">
        <div>
          <h1>AI &amp; Data</h1>
          <p className="tl-admin-page-sub">
            Market data feeds, strategy signal safety gates, and internal AI research cycles
          </p>
        </div>
        <div className="tl-admin-head-actions">
          <Button variant="secondary" onClick={refreshAll} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {/* 1. 10-Symbol Market Data Feeds */}
      <section className="tl-admin-section" id="market-feeds" aria-labelledby="feeds-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="feeds-heading">
                Market data feeds (10-symbol universe)
              </h2>
              <ScopeBadge scope="infra" />
              {marketData?.status && (
                <AdminPill tone={marketData.status === 'healthy' ? 'pos' : 'warn'}>
                  {marketData.status === 'healthy'
                    ? `Healthy (${marketData.summary?.healthy ?? 10}/${marketData.summary?.total ?? 10})`
                    : `Degraded (${marketData.summary?.healthy ?? 0}/${marketData.summary?.total ?? 10})`}
                </AdminPill>
              )}
            </div>
            <p className="tl-admin-section-desc">
              Target session: <strong>{marketData?.session || 'Latest completed session'}</strong> · Point-in-time daily bars from Alpha Engine.
            </p>
          </div>
          {isAdmin && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRevalidateFeeds}
              disabled={revalidating || actionLoading}
            >
              {revalidating ? 'Verifying…' : 'Verify Market Feeds'}
            </Button>
          )}
        </div>

        <div className="tl-admin-table-card">
          <div className="tl-admin-table-scroll">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Feed Health</th>
                  <th>Latest Session</th>
                  <th>Open / Close</th>
                  <th>Low – High</th>
                  <th>Volume</th>
                  <th>History</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {marketData?.symbols?.length > 0 ? (
                  marketData.symbols.map((s) => {
                    const tone = s.status === 'healthy' ? 'pos' : s.status === 'stale' ? 'warn' : 'neg'
                    return (
                      <tr key={s.symbol}>
                        <td className="tl-admin-cell-primary">{s.symbol}</td>
                        <td>
                          <AdminPill tone={tone}>{s.status}</AdminPill>
                        </td>
                        <td className="tl-num">{s.session || '—'}</td>
                        <td className="tl-num">
                          <div>Close: {s.close != null ? `$${s.close.toFixed(2)}` : '—'}</div>
                          <span className="tl-admin-cell-sub">
                            Open: {s.open != null ? `$${s.open.toFixed(2)}` : '—'}
                          </span>
                        </td>
                        <td className="tl-num">
                          {s.low != null && s.high != null
                            ? `$${s.low.toFixed(2)} – $${s.high.toFixed(2)}`
                            : '—'}
                        </td>
                        <td className="tl-num">
                          {s.volume != null ? Number(s.volume).toLocaleString() : '—'}
                        </td>
                        <td className="tl-num">{s.barsCount} bars</td>
                        <td>{s.reason || 'Verified'}</td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="tl-admin-empty">
                      {loading ? 'Loading market feed diagnostics…' : 'No market feed data available.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 2. Strategy Signal Safety Gate */}
      <section className="tl-admin-section" id="signals" aria-labelledby="signals-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="signals-heading">
                Strategy signal safety gate
              </h2>
              <ScopeBadge scope="internal" />
              <AdminPill
                tone={
                  researchDiag?.status === 'healthy'
                    ? 'pos'
                    : researchDiag?.status === 'degraded'
                    ? 'warn'
                    : 'neutral'
                }
              >
                {researchDiag?.status === 'healthy'
                  ? 'Publication Healthy'
                  : researchDiag?.status === 'degraded'
                  ? 'Publication Degraded'
                  : 'Dormant'}
              </AdminPill>
            </div>
            <p className="tl-admin-section-desc">
              Checks whether Alpha Engine&apos;s published research model passed out-of-sample holdout checks before allowing automated signal trading.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={loadSignalGate} disabled={researchLoading}>
            {researchLoading ? 'Checking…' : 'Refresh Signal Gate'}
          </Button>
        </div>

        <Notice tone={verdictEligible ? 'info' : 'warn'} className={verdictEligible ? 'tl-notice--success' : ''}>
          <div>
            <strong>
              {verdictEligible
                ? 'Trading safeguard satisfied — Signals eligible to trade'
                : 'Trading safeguard active — Protected (no demonstrated edge over buy-and-hold)'}
            </strong>
            <p style={{ margin: '4px 0 0' }}>
              {researchDiag?.summary?.explanation ||
                'Published research signals must pass cryptographic provenance and out-of-sample holdout verification before deploying capital.'}
            </p>
          </div>
        </Notice>

        <div className="tl-admin-kpi-grid">
          <div className="tl-admin-kpi">
            <span className="tl-admin-kpi-label">Published model</span>
            <div className="tl-admin-kpi-value" style={{ fontSize: '18px' }}>
              {researchDiag?.publication?.model || 'trend_momentum_v1'}
            </div>
            <div className="tl-admin-kpi-meta">
              <span>Session: {researchDiag?.publication?.marketDate || '—'}</span>
            </div>
          </div>
          <div className="tl-admin-kpi">
            <span className="tl-admin-kpi-label">Eligible symbols</span>
            <div className="tl-admin-kpi-value">
              {researchDiag?.summary?.tradingEligibleCount ?? 0} / {researchDiag?.summary?.symbolsEvaluated ?? 10}
            </div>
            <div className="tl-admin-kpi-meta">
              <span>{researchDiag?.summary?.signalsCount ?? 0} signals published</span>
            </div>
          </div>
          <div className="tl-admin-kpi">
            <span className="tl-admin-kpi-label">Holdout edge check</span>
            <div className="tl-admin-kpi-value" style={{ fontSize: '18px' }}>
              {researchDiag?.quality?.edgeOverBaseline ? 'Pass' : 'Blocked (No Edge)'}
            </div>
            <div className="tl-admin-kpi-meta">
              <span>
                Out-of-sample: {researchDiag?.quality?.genuineOutOfSample ? 'Verified' : 'Unverified'}
              </span>
            </div>
          </div>
          <div className="tl-admin-kpi">
            <span className="tl-admin-kpi-label">Verification gates</span>
            <div className="tl-admin-kpi-value" style={{ fontSize: '18px' }}>
              {researchDiag?.gates?.length
                ? `${researchDiag.gates.filter((g) => g.status === 'pass').length}/${researchDiag.gates.length} Passed`
                : '—'}
            </div>
            <div className="tl-admin-kpi-meta">
              <span>Key: {researchDiag?.publication?.publisherKeyId || '—'}</span>
            </div>
          </div>
        </div>

        {researchDiag?.gates?.length > 0 && (
          <Disclosure label="View 8-gate contract checks & publication metadata">
            <div className="tl-admin-gate-list" style={{ marginBottom: '10px' }}>
              {researchDiag.gates.map((g) => (
                <AdminPill key={g.gate} tone={g.status === 'pass' ? 'pos' : 'neg'}>
                  {g.status === 'pass' ? '✓' : '✗'} {g.gate}
                </AdminPill>
              ))}
            </div>
            <div className="tl-small tl-muted">
              Publication ID: <code className="tl-admin-code">{researchDiag?.publication?.id || 'None'}</code> · Worker:{' '}
              <code className="tl-admin-code">{researchDiag?.publication?.workerId || 'scheduled_worker'}</code>
            </div>
          </Disclosure>
        )}

        <div className="tl-admin-table-card">
          <div className="tl-admin-table-scroll">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Signal</th>
                  <th>Direction</th>
                  <th>Score</th>
                  <th>Baseline Edge</th>
                  <th>Trading Eligibility</th>
                </tr>
              </thead>
              <tbody>
                {researchDiag?.symbols?.length > 0 ? (
                  researchDiag.symbols.map((s) => (
                    <tr key={s.symbol}>
                      <td className="tl-admin-cell-primary">{s.symbol}</td>
                      <td>{s.status === 'signal' ? 'Published' : 'No signal'}</td>
                      <td>
                        {s.direction ? (
                          <AdminPill tone={s.direction === 'BUY' ? 'pos' : s.direction === 'SELL' ? 'neg' : 'neutral'}>
                            {s.direction}
                          </AdminPill>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="tl-num">{s.score != null ? Number(s.score).toFixed(4) : '—'}</td>
                      <td>{s.edgeOverBaseline ? 'Edge confirmed' : 'No edge over baseline'}</td>
                      <td>
                        <AdminPill tone={s.eligibleForTrading ? 'pos' : 'warn'}>
                          {s.eligibleForTrading ? 'Eligible' : 'Protected (Blocked)'}
                        </AdminPill>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="tl-admin-empty">
                      {researchLoading ? 'Loading signal diagnostics…' : 'No published research signals available.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 3. Internal AI Research Cycles & Contextual Controls */}
      <section className="tl-admin-section" id="pipeline" aria-labelledby="cycles-heading">
        <div className="tl-admin-section-head">
          <div>
            <div className="tl-admin-section-title-row">
              <h2 className="tl-admin-section-title" id="cycles-heading">
                Showcase AI research cycles &amp; manual recovery
              </h2>
              <ScopeBadge scope="internal" />
            </div>
            <p className="tl-admin-section-desc">
              Daily LLM evaluations, token usage, and manual recovery jobs for TradeLoom&apos;s internal showcase strategy (<code className="tl-admin-code">bot_canonical_ai_catalyst_momentum</code>).
            </p>
          </div>
        </div>

        {isAdmin && (
          <div className="tl-admin-cards-2">
            <div className="tl-admin-action-card">
              <div>
                <h3>Run Daily AI Research Cycle</h3>
                <p>
                  Manual recovery if the scheduled 4:30 PM ET post-close job missed. Evaluates all 10 symbols via{' '}
                  <code className="tl-admin-code">{cyclesMetrics?.latestModel || 'gpt-4o-mini'}</code>, processes eligible fills, and queues next-open paper orders.
                </p>
                <div className="tl-admin-kv-inline">
                  <span>Completed cycles: <strong>{cyclesTotal}</strong></span>
                  <span>
                    Total token spend: <strong>${Number(cyclesMetrics?.totalCostUsd || 0).toFixed(4)}</strong> (
                    {Number(cyclesMetrics?.totalTokens || 0).toLocaleString()} tokens)
                  </span>
                </div>
              </div>
              <div>
                <Button variant="primary" size="sm" onClick={handleRunAiResearch} disabled={actionLoading}>
                  Run Research Cycle
                </Button>
              </div>
            </div>

            <div className="tl-admin-action-card">
              <div>
                <h3>Market-Open Paper Fills &amp; Public Evidence</h3>
                <p>
                  Process queued next-open paper orders against opening bars (if the 9:45 AM ET job missed) or recompute standardized public strategy evidence snapshots.
                </p>
              </div>
              <div className="tl-admin-row-actions">
                <Button variant="secondary" size="sm" onClick={handleRunMarketOpen} disabled={actionLoading}>
                  Run Market-Open Fills
                </Button>
                <Button variant="secondary" size="sm" onClick={handleSyncEvidence} disabled={actionLoading}>
                  Sync Public Evidence
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="tl-admin-table-card">
          <div className="tl-admin-toolbar">
            <strong style={{ fontSize: '13.5px' }}>Autonomous AI research cycles</strong>
            <Button variant="secondary" size="sm" onClick={() => loadCycles(cyclesPage)}>
              Refresh Cycles
            </Button>
          </div>
          <div className="tl-admin-table-scroll">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Target Fill Session</th>
                  <th>Mode</th>
                  <th>Market Summary</th>
                  <th>Decisions</th>
                  <th>Model / Spend</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {cycles.length > 0 ? (
                  cycles.map((c) => (
                    <tr key={c.id}>
                      <td className="tl-num tl-nowrap">
                        <span className="tl-admin-cell-primary">{c.session || '—'}</span>
                        <span className="tl-admin-cell-sub">
                          {c.createdAt ? new Date(c.createdAt).toLocaleTimeString() : ''}
                        </span>
                      </td>
                      <td className="tl-num tl-nowrap">{c.intendedSession || 'Next open'}</td>
                      <td>
                        <AdminPill tone={c.isReplay ? 'warn' : 'pos'}>
                          {c.isReplay ? 'Replay' : 'Forward Live'}
                        </AdminPill>
                      </td>
                      <td style={{ maxWidth: '280px' }}>{c.marketSummary || '—'}</td>
                      <td>
                        <div className="tl-admin-row-actions">
                          <AdminPill tone="pos">{c.decisionCounts?.buy ?? 0} BUY</AdminPill>
                          <AdminPill tone="neutral">{c.decisionCounts?.hold ?? 0} HOLD</AdminPill>
                          <AdminPill tone="neg">{c.decisionCounts?.sell ?? 0} SELL</AdminPill>
                        </div>
                      </td>
                      <td className="tl-num">
                        <div>{c.model}</div>
                        <span className="tl-admin-cell-sub">
                          ${Number(c.estimatedCostUsd || 0).toFixed(5)} ({c.usage?.total_tokens || 0} tok)
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleInspectCycle(c.id)}
                          disabled={cycleDetailLoading}
                        >
                          Inspect Cycle
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="tl-admin-empty">
                      No AI research cycles recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <AdminPagination
            page={cyclesPage}
            pageSize={20}
            total={cyclesTotal}
            itemLabel="cycles"
            onPageChange={(nextPage) => loadCycles(nextPage)}
          />
        </div>

        {/* Symbol-Level Decision Search */}
        <div className="tl-admin-table-card">
          <div className="tl-admin-toolbar">
            <div className="tl-admin-toolbar-filters">
              <Input
                placeholder="Filter decisions by symbol (e.g. AAPL)…"
                aria-label="Filter AI decisions by symbol"
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadDecisions(symbolFilter, actionFilter, 0)
                }}
              />
              <Select
                aria-label="Filter AI decisions by action"
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value)
                  loadDecisions(symbolFilter, e.target.value, 0)
                }}
              >
                <option value="">All actions</option>
                <option value="BUY">BUY</option>
                <option value="HOLD">HOLD</option>
                <option value="SELL">SELL</option>
              </Select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => loadDecisions(symbolFilter, actionFilter, 0)}
              >
                Search Decisions
              </Button>
            </div>
          </div>
          <div className="tl-admin-table-scroll">
            <table className="tl-admin-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Symbol</th>
                  <th>Action</th>
                  <th>Confidence</th>
                  <th>Protective Exit Rules</th>
                  <th>Analytical Thesis</th>
                </tr>
              </thead>
              <tbody>
                {decisions.length > 0 ? (
                  decisions.map((d, idx) => (
                    <tr key={`${d.cycleId}-${d.symbol}-${idx}`}>
                      <td className="tl-num tl-nowrap">{d.session}</td>
                      <td className="tl-admin-cell-primary">{d.symbol}</td>
                      <td>
                        <AdminPill tone={d.action === 'BUY' ? 'pos' : d.action === 'SELL' ? 'neg' : 'neutral'}>
                          {d.action}
                        </AdminPill>
                      </td>
                      <td className="tl-num">{Math.round((d.confidence || 0) * 100)}%</td>
                      <td className="tl-num tl-nowrap">
                        {d.exitRule?.stopLossPct
                          ? `SL -${d.exitRule.stopLossPct}% · TP +${d.exitRule.takeProfitPct}% · ${d.exitRule.timeStopDays}d`
                          : '—'}
                      </td>
                      <td>{d.thesis}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="tl-admin-empty">
                      No symbol decisions match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <AdminPagination
            page={decisionsPage}
            pageSize={20}
            total={decisionsTotal}
            itemLabel="decisions"
            onPageChange={(nextPage) => loadDecisions(symbolFilter, actionFilter, nextPage)}
          />
        </div>
      </section>

      {/* Pattern 3: AI Cycle Detail Drawer */}
      {selectedCycle && (
        <Sheet
          title={`AI Research Cycle: ${selectedCycle.session || selectedCycle.id}`}
          className="sheet--admin-drawer"
          onClose={() => setSelectedCycle(null)}
        >
          <div className="tl-admin-drawer-meta">
            <ScopeBadge scope="internal" />
            <span>Model: <strong>{selectedCycle.model}</strong></span>
            <span>Provider: <strong>{selectedCycle.provider}</strong></span>
            <span>Mode: <strong>{selectedCycle.isReplay ? 'Replay' : 'Forward Live'}</strong></span>
          </div>

          <Notice tone="info">
            <div>
              <strong>Market regime summary</strong>
              <p style={{ margin: '4px 0 0' }}>
                {selectedCycle.marketSummary || 'No summary recorded for this cycle.'}
              </p>
            </div>
          </Notice>

          <div className="tl-admin-drawer-section">
            <h3>Symbol evaluations ({selectedCycle.symbolEvaluations?.length || 0})</h3>
            <div style={{ display: 'grid', gap: '10px' }}>
              {selectedCycle.symbolEvaluations?.map((ev) => (
                <div key={ev.symbol} className="tl-card-shell tl-card-shell--compact">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '8px',
                      marginBottom: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ fontSize: '15px' }}>{ev.symbol}</strong>
                      <AdminPill tone={ev.action === 'BUY' ? 'pos' : ev.action === 'SELL' ? 'neg' : 'neutral'}>
                        {ev.action}
                      </AdminPill>
                      <span className="tl-small tl-muted tl-num">
                        Confidence: {Math.round((ev.confidence || 0) * 100)}%
                      </span>
                    </div>
                    {ev.exitRule?.stopLossPct && (
                      <span className="tl-small tl-muted tl-num">
                        SL -{ev.exitRule.stopLossPct}% · TP +{ev.exitRule.takeProfitPct}% · {ev.exitRule.timeStopDays}d
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.5 }}>{ev.thesis}</p>
                </div>
              ))}
            </div>
          </div>
        </Sheet>
      )}
    </>
  )
}
