import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import AdminDashboard from '../AdminDashboard'
import * as adminClient from '../../../api/adminClient'

vi.mock('../../../app/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'usr_adm', email: 'admin@tradeloom.com', fullName: 'Administrator', role: 'admin' },
    sessionLoading: false
  })
}))

const mockOverview = {
  timestamp: new Date().toISOString(),
  emergencyStop: { active: false },
  users: { total: 5, activeSubscriptions: 3, byRole: { admin: 1, operator: 1, user: 3 } },
  bots: { total: 4, enabled: 3, paused: 1, ai: 2, rule: 2 },
  executions: { total: 10, filled: 6, queued: 1, pending_fill: 1, filledNotional: 2500 },
  workers: {
    total: 2,
    activeCount: 1,
    staleCount: 1,
    avgQueueLagMs: 25,
    list: [
      { id: 'worker-node-1', isActive: true, queueLagMs: 25, startedAt: new Date().toISOString(), lastSeen: new Date().toISOString() }
    ]
  },
  pipeline: {
    status: 'ok',
    stages: {
      market_data_ingestion: { status: 'ok', session: '2026-11-25' },
      pending_order_execution: { status: 'ok', session: '2026-11-25' },
      ai_research_decision: { status: 'ok', session: '2026-11-24' },
      portfolio_valuation: { status: 'ok', session: '2026-11-25' },
      strategy_evidence_publication: { status: 'ok', session: '2026-11-25' }
    },
    accounting: {
      cash: 8232.06,
      holdingsValue: 1755.08,
      totalEquity: 9987.14,
      unrealizedPnl: -12.86
    }
  }
}

const mockActivity = {
  total: 2,
  events: [
    { id: 'evt-1', timestamp: new Date().toISOString(), source: 'bot_event', type: 'ai_decision', detail: 'BUY AAPL' },
    { id: 'aud-1', timestamp: new Date().toISOString(), source: 'execution_audit', type: 'order_filled', detail: 'Filled 5 AAPL' }
  ]
}

const mockUsers = {
  total: 2,
  users: [
    { id: 'usr_1', email: 'user1@test.com', fullName: 'User One', role: 'user', createdAt: new Date().toISOString() },
    { id: 'usr_2', email: 'op@test.com', fullName: 'Operator One', role: 'operator', createdAt: new Date().toISOString() }
  ]
}

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.spyOn(adminClient, 'fetchAdminOverview').mockResolvedValue(mockOverview)
    vi.spyOn(adminClient, 'fetchAdminActivity').mockResolvedValue(mockActivity)
    vi.spyOn(adminClient, 'fetchAdminUsers').mockResolvedValue(mockUsers)
  })

  it('renders overview metrics cards and autonomous pipeline stages', async () => {
    render(<AdminDashboard />)

    await waitFor(() => {
      expect(screen.getByText('Platform Administration')).toBeInTheDocument()
      expect(screen.getByText('Engine Operational')).toBeInTheDocument()
      expect(screen.getByText('User Population')).toBeInTheDocument()
      expect(screen.getByText('Bot Fleet')).toBeInTheDocument()
      expect(screen.getByText('Autonomous AI Strategy Lifecycle')).toBeInTheDocument()
    })
  })

  it('displays navigation tabs and switches to Operational Controls', async () => {
    render(<AdminDashboard />)

    await waitFor(() => {
      expect(screen.getByText("Bird's Eye Overview")).toBeInTheDocument()
    })

    const controlsTab = screen.getByRole('button', { name: 'Operational Controls' })
    controlsTab.click()

    await waitFor(() => {
      expect(screen.getByText('Next-Market-Open Paper Execution')).toBeInTheDocument()
      expect(screen.getByText('Daily AI Research Cycle')).toBeInTheDocument()
      expect(screen.getByText('Platform Emergency Kill Switch')).toBeInTheDocument()
    })
  })

  it('opens in-app action dialog for emergency stop confirmation and calls setAdminEmergencyStop', async () => {
    const mockSetEmergencyStop = vi.spyOn(adminClient, 'setAdminEmergencyStop').mockResolvedValue({ success: true })

    render(<AdminDashboard />)

    await waitFor(() => {
      expect(screen.getByText("Bird's Eye Overview")).toBeInTheDocument()
    })

    const controlsTab = screen.getByRole('button', { name: 'Operational Controls' })
    controlsTab.click()

    await waitFor(() => {
      expect(screen.getAllByText('🚨 Trigger Emergency Stop')[0]).toBeInTheDocument()
    })

    const stopButton = screen.getAllByText('🚨 Trigger Emergency Stop')[0]
    stopButton.click()

    // Verify modal dialog appears
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '🚨 Trigger Platform Emergency Stop' })).toBeInTheDocument()
      expect(screen.getByText(/CRITICAL ACTION: This will immediately pause all platform bots/i)).toBeInTheDocument()
    })

    // Click confirm in the modal
    const dialog = screen.getByRole('dialog', { name: '🚨 Trigger Platform Emergency Stop' })
    const confirmButton = dialog.querySelector('.tl-btn-danger')
    expect(confirmButton).toBeInTheDocument()
    confirmButton.click()

    await waitFor(() => {
      expect(mockSetEmergencyStop).toHaveBeenCalledWith(expect.objectContaining({ active: true }))
    })
  })

  it('renders Intent Price vs Fill Price domain header and pagination in Order Blotter', async () => {
    vi.spyOn(adminClient, 'fetchAdminExecutions').mockResolvedValue({
      total: 45,
      executions: [
        {
          id: 'exec-1',
          ticker: 'AAPL',
          direction: 'buy',
          quantity: 5,
          price: 230.50,
          filledPrice: 231.10,
          status: 'filled',
          createdAt: new Date().toISOString()
        }
      ]
    })

    render(<AdminDashboard />)

    await waitFor(() => {
      expect(screen.getByText("Bird's Eye Overview")).toBeInTheDocument()
    })

    const blotterTab = screen.getByRole('button', { name: /Order Blotter/i })
    blotterTab.click()

    await waitFor(() => {
      expect(screen.getByText('Intent Price vs Fill Price')).toBeInTheDocument()
      expect(screen.getByText(/Showing 1–20 of 45 orders/i)).toBeInTheDocument()
      expect(screen.getByText('Intent: $230.50')).toBeInTheDocument()
      expect(screen.getByText('Fill: $231.10')).toBeInTheDocument()
    })
  })

  it('renders pagination controls in User Accounts table and navigates pages', async () => {
    const mockFetchUsers = vi.spyOn(adminClient, 'fetchAdminUsers').mockResolvedValue({
      total: 42,
      users: [
        { id: 'usr-1', email: 'alice@example.com', fullName: 'Alice Trader', role: 'user', status: 'active', createdAt: new Date().toISOString() }
      ]
    })

    render(<AdminDashboard />)

    await waitFor(() => {
      expect(screen.getByText("Bird's Eye Overview")).toBeInTheDocument()
    })

    const usersTab = screen.getByRole('button', { name: /User Accounts & Roles/i })
    usersTab.click()

    await waitFor(() => {
      expect(screen.getByText(/Showing 1–20 of 42 users/i)).toBeInTheDocument()
    })

    const nextBtn = screen.getByRole('button', { name: /Next ▶/i })
    expect(nextBtn).toBeEnabled()
    nextBtn.click()

    await waitFor(() => {
      expect(mockFetchUsers).toHaveBeenCalledWith(expect.objectContaining({ offset: 20, limit: 20 }))
    })
  })

  it('switches to AI Research & Decisions tab, renders telemetry and opens explainability modal', async () => {
    vi.spyOn(adminClient, 'fetchAdminAiCycles').mockResolvedValue({
      total: 1,
      metrics: {
        totalCycles: 1,
        totalCostUsd: 0.00048,
        totalTokens: 1950,
        latestModel: 'gpt-4o-mini-2024-07-18'
      },
      cycles: [
        {
          id: 'cycle-1',
          session: '2026-11-25',
          intendedSession: '2026-11-26',
          model: 'gpt-4o-mini-2024-07-18',
          marketSummary: 'Risk-on regime with tech leadership',
          isReplay: false,
          estimatedCostUsd: 0.00048,
          usage: { total_tokens: 1950 },
          decisionCounts: { buy: 1, hold: 1, sell: 0 }
        }
      ]
    })

    vi.spyOn(adminClient, 'fetchAdminAiDecisions').mockResolvedValue({
      total: 1,
      decisions: [
        {
          cycleId: 'cycle-1',
          session: '2026-11-25',
          symbol: 'AAPL',
          action: 'BUY',
          confidence: 0.88,
          thesis: 'Strong institutional accumulation above 20-day moving average.',
          exitRule: { stopLossPct: 4.0, takeProfitPct: 8.0, timeStopDays: 5 }
        }
      ]
    })

    const mockCycleDetail = vi.spyOn(adminClient, 'fetchAdminAiCycleDetail').mockResolvedValue({
      id: 'cycle-1',
      session: '2026-11-25',
      model: 'gpt-4o-mini-2024-07-18',
      provider: 'openai',
      marketSummary: 'Risk-on regime with tech leadership',
      isReplay: false,
      symbolEvaluations: [
        {
          symbol: 'AAPL',
          action: 'BUY',
          confidence: 0.88,
          thesis: 'Strong institutional accumulation above 20-day moving average.',
          exitRule: { stopLossPct: 4.0, takeProfitPct: 8.0, timeStopDays: 5 },
          evidence: { trend: 'bullish', volumeMultiple: 1.5 }
        }
      ]
    })

    render(<AdminDashboard />)

    await waitFor(() => {
      expect(screen.getByText("Bird's Eye Overview")).toBeInTheDocument()
    })

    const aiTab = screen.getByRole('button', { name: /AI Research & Decisions/i })
    aiTab.click()

    await waitFor(() => {
      expect(screen.getByText('Autonomous AI Research Cycles')).toBeInTheDocument()
      expect(screen.getByText('Risk-on regime with tech leadership')).toBeInTheDocument()
      expect(screen.getByText('1 BUY')).toBeInTheDocument()
      expect(screen.getByText('Strong institutional accumulation above 20-day moving average.')).toBeInTheDocument()
    })

    const inspectBtn = screen.getByRole('button', { name: /Inspect Decisions & Theses/i })
    inspectBtn.click()

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'AI Decision Explainability Inspector' })).toBeInTheDocument()
      expect(mockCycleDetail).toHaveBeenCalledWith('cycle-1')
    })
  })

  it('switches to Pipeline Monitor, displays 10-Symbol market data diagnostics and handles feed re-validation', async () => {
    const mockDiagnostics = {
      status: 'healthy',
      session: '2026-11-25',
      summary: { total: 10, healthy: 10, stale: 0, missing: 0 },
      symbols: [
        {
          symbol: 'AAPL',
          session: '2026-11-25',
          status: 'healthy',
          open: 230.10,
          close: 232.50,
          high: 233.00,
          low: 229.80,
          volume: 45000000,
          barsCount: 22,
          reason: null
        },
        {
          symbol: 'MSFT',
          session: '2026-11-25',
          status: 'healthy',
          open: 420.00,
          close: 425.10,
          high: 426.00,
          low: 419.50,
          volume: 21000000,
          barsCount: 22,
          reason: null
        }
      ]
    }

    vi.spyOn(adminClient, 'fetchAdminMarketDataDiagnostics').mockResolvedValue(mockDiagnostics)
    const mockRevalidate = vi.spyOn(adminClient, 'revalidateAdminMarketFeed').mockResolvedValue(mockDiagnostics)

    render(<AdminDashboard />)

    await waitFor(() => {
      expect(screen.getByText("Bird's Eye Overview")).toBeInTheDocument()
    })

    const pipelineTab = screen.getByRole('button', { name: /Pipeline Monitor/i })
    pipelineTab.click()

    await waitFor(() => {
      expect(screen.getByText(/10-Symbol Universe Market Data Feed Diagnostics/i)).toBeInTheDocument()
      expect(screen.getByText('Feed Healthy (10/10)')).toBeInTheDocument()
      expect(screen.getAllByText('Sound · Zero Leakage').length).toBeGreaterThan(0)
      expect(screen.getByText('AAPL')).toBeInTheDocument()
      expect(screen.getByText('MSFT')).toBeInTheDocument()
    })

    const revalidateBtn = screen.getByRole('button', { name: /Re-validate Universe Feeds/i })
    revalidateBtn.click()

    await waitFor(() => {
      expect(mockRevalidate).toHaveBeenCalledWith({ session: '2026-11-25' })
    })
  })

  it('switches to AI Research & Decisions and displays Signed Research Publication Pipeline diagnostics', async () => {
    const mockResearchDiagnostics = {
      status: 'healthy',
      publication: {
        id: 'pub_d4ab57ddb25f42e21521c1fbeca0c3851a08680f08cc64f4e1321f7ef3baa9b7',
        marketDate: '2026-11-25',
        publishedAt: '2026-11-25T22:03:38Z',
        model: 'trend_momentum_v1',
        runStatus: 'HEALTHY',
        publisherKeyId: 'key_ae_pub_01',
        workerId: 'scheduled_worker',
        schemaVersion: 'research-publication/v1'
      },
      gates: [
        { gate: 'schema', status: 'pass' },
        { gate: 'universe', status: 'pass' },
        { gate: 'provenance', status: 'pass' },
        { gate: 'freshness', status: 'pass' },
        { gate: 'reproduction', status: 'pass' },
        { gate: 'market_data', status: 'pass' },
        { gate: 'holdout_sufficient', status: 'pass' },
        { gate: 'edge_over_baseline', status: 'fail' }
      ],
      failedGates: ['edge_over_baseline'],
      quality: {
        edgeOverBaseline: false,
        genuineOutOfSample: true
      },
      summary: {
        pipelineActive: true,
        operationalStatus: 'HEALTHY',
        symbolsEvaluated: 10,
        signalsCount: 10,
        tradingEligibleCount: 0,
        tradingEligibilityVerdict: 'PROTECTED_NO_EDGE',
        explanation: 'Research publication is healthy and verified, but trading is prevented because the published model has not demonstrated a statistically significant edge over buy-and-hold on genuine out-of-sample data.'
      },
      symbols: [
        {
          symbol: 'AAPL',
          status: 'signal',
          direction: 'BUY',
          score: 0.4788,
          predictionId: 'pred_aapl_123',
          eligibleForTrading: false,
          edgeOverBaseline: false,
          genuineOutOfSample: true,
          qualityVerdict: 'no_demonstrated_edge'
        }
      ]
    }

    const mockFetch = vi.spyOn(adminClient, 'fetchAdminResearchDiagnostics').mockResolvedValue(mockResearchDiagnostics)

    render(<AdminDashboard />)

    await waitFor(() => {
      expect(screen.getByText("Bird's Eye Overview")).toBeInTheDocument()
    })

    const aiResearchTab = screen.getByRole('button', { name: /AI Research & Decisions/i })
    aiResearchTab.click()

    await waitFor(() => {
      expect(screen.getByText(/Signed Research Publication Pipeline/i)).toBeInTheDocument()
      expect(screen.getByText(/● Pipeline Healthy/i)).toBeInTheDocument()
      expect(screen.getByText(/PROTECTED · NO EDGE/i)).toBeInTheDocument()
      expect(screen.getByText(/Trading Safeguard Active: Protected — No Demonstrated Edge/i)).toBeInTheDocument()
      expect(screen.getByText('trend_momentum_v1')).toBeInTheDocument()
      expect(screen.getByText('schema')).toBeInTheDocument()
      expect(screen.getByText('edge_over_baseline')).toBeInTheDocument()
      expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0)
    })

    const refreshBtn = screen.getByRole('button', { name: /↻ Refresh Publication Pipeline/i })
    refreshBtn.click()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  it('switches to Operational Controls, renders evidence storage metrics and triggers compaction', async () => {
    const mockStorage = {
      totalRows: 240,
      distinctSessions: 5,
      compactedRows: 180,
      activeRows: 60,
      sharedCurveRows: 36,
      estimatedStorageKb: 120
    }
    vi.spyOn(adminClient, 'fetchAdminEvidenceStorage').mockResolvedValue(mockStorage)
    const mockCompact = vi.spyOn(adminClient, 'compactAdminEvidence').mockResolvedValue({
      success: true,
      data: { compactedRows: 30 }
    })

    render(<AdminDashboard />)

    await waitFor(() => {
      expect(screen.getByText("Bird's Eye Overview")).toBeInTheDocument()
    })

    const controlsTab = screen.getByRole('button', { name: /Operational Controls/i })
    controlsTab.click()

    await waitFor(() => {
      expect(screen.getByText(/Strategy Evidence Compaction & Storage/i)).toBeInTheDocument()
      expect(screen.getByText('240')).toBeInTheDocument()
      expect(screen.getByText('180')).toBeInTheDocument()
      expect(screen.getByText('120 KB')).toBeInTheDocument()
    })

    const compactBtn = screen.getByRole('button', { name: /📦 Compact Superseded Evidence/i })
    compactBtn.click()

    await waitFor(() => {
      expect(mockCompact).toHaveBeenCalled()
    })
  })
})
