import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AdminDashboard from '../AdminDashboard'
import * as adminClient from '../../../api/adminClient'

vi.mock('react-router-dom', async () => vi.importActual('react-router-dom'))

const authMock = {
  user: { id: 'usr_adm', email: 'admin@tradeloom.com', fullName: 'Administrator', role: 'admin' },
  sessionLoading: false,
}

vi.mock('../../../app/AuthProvider', () => ({
  useAuth: () => authMock,
}))

function renderAdmin(initialEntry = '/admin') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/admin/*" element={<AdminDashboard />} />
      </Routes>
    </MemoryRouter>
  )
}

const mockOverview = {
  timestamp: '2026-11-27T15:00:00.000Z',
  emergencyStop: { active: false },
  users: { total: 5, activeSubscriptions: 3, byRole: { admin: 1, operator: 1, user: 3 } },
  bots: { total: 4, enabled: 3, paused: 1, ai: 2, rule: 2 },
  executions: { total: 10, filled: 6, queued: 2, pending_fill: 1, failed: 0, filledNotional: 2500 },
  workers: {
    total: 2,
    activeCount: 1,
    staleCount: 1,
    avgQueueLagMs: 25,
    list: [
      {
        id: 'worker-node-1',
        isActive: true,
        queueLagMs: 25,
        startedAt: '2026-11-27T12:00:00.000Z',
        lastSeen: '2026-11-27T15:00:00.000Z',
      },
    ],
  },
  pipeline: {
    status: 'ok',
    isTodayTradingDay: true,
    stages: {
      market_data_ingestion: { status: 'ok', session: '2026-11-25' },
      pending_order_execution: { status: 'ok', session: '2026-11-25' },
      ai_research_decision: { status: 'ok', session: '2026-11-24' },
      portfolio_valuation: { status: 'ok', session: '2026-11-25' },
      strategy_evidence_publication: { status: 'ok', session: '2026-11-25' },
    },
  },
}

describe('AdminDashboard (MR 1 Five-Workspace Architecture)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    authMock.user = {
      id: 'usr_adm',
      email: 'admin@tradeloom.com',
      fullName: 'Administrator',
      role: 'admin',
    }
    vi.spyOn(adminClient, 'fetchAdminOverview').mockResolvedValue(mockOverview)
    vi.spyOn(adminClient, 'fetchAdminActivity').mockResolvedValue({
      total: 1,
      events: [
        {
          id: 'evt-1',
          timestamp: '2026-11-27T14:55:00.000Z',
          source: 'bot_event',
          type: 'ai_decision',
          detail: 'BUY AAPL',
        },
      ],
    })
    vi.spyOn(adminClient, 'fetchAdminAuditLogs').mockResolvedValue({
      total: 1,
      logs: [
        {
          id: 'aud-1',
          createdAt: '2026-11-27T14:50:00.000Z',
          action: 'revalidate_market_data',
          targetType: 'market_feed',
          admin: { email: 'admin@tradeloom.com', fullName: 'Administrator' },
        },
      ],
    })
    vi.spyOn(adminClient, 'fetchAdminBrokerFleetStatus').mockResolvedValue({
      simulatedMode: true,
      fleet: {
        totalAccounts: 4,
        paperAccounts: 4,
        liveAccounts: 0,
        inSyncAccounts: 4,
        driftedAccountsCount: 0,
      },
      driftedAccounts: [],
    })
    vi.spyOn(adminClient, 'fetchAdminMarketDataDiagnostics').mockResolvedValue({
      status: 'healthy',
      session: '2026-11-25',
      summary: { total: 10, healthy: 10, stale: 0, missing: 0 },
      symbols: [],
    })
  })

  it('renders 5-workspace left rail, operational Overview, scope badges, and persistent safety indicator without Emergency Stop in header', async () => {
    renderAdmin('/admin')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
      expect(screen.getByText('Platform operations and customer activity')).toBeInTheDocument()
    })

    const workspaceNav = screen.getByRole('navigation', { name: 'Admin workspaces' })
    expect(within(workspaceNav).getByRole('link', { name: /Overview/i })).toBeInTheDocument()
    expect(within(workspaceNav).getByRole('link', { name: /Users/i })).toBeInTheDocument()
    expect(within(workspaceNav).getByRole('link', { name: /Trading/i })).toBeInTheDocument()
    expect(within(workspaceNav).getByRole('link', { name: /AI & Data/i })).toBeInTheDocument()
    expect(within(workspaceNav).getByRole('link', { name: /System/i })).toBeInTheDocument()

    const safetyBox = screen.getByTestId('admin-safety-indicator')
    expect(within(safetyBox).getByText('Operating Normally')).toBeInTheDocument()
    expect(within(safetyBox).getByRole('link', { name: /Safety controls/i })).toHaveAttribute(
      'href',
      '/admin/system#emergency-stop'
    )

    expect(screen.queryByRole('button', { name: /Emergency Stop/i })).not.toBeInTheDocument()

    expect(screen.getByText('Customers')).toBeInTheDocument()
    expect(screen.getByText('Running bots')).toBeInTheDocument()
    expect(screen.getByText('Pending orders')).toBeInTheDocument()
    expect(screen.getByText('Workers')).toBeInTheDocument()
    expect(screen.getByText("Today's trading operations")).toBeInTheDocument()
    expect(screen.getByText('Market data received')).toBeInTheDocument()

    expect(screen.getAllByText(/Internal Trading/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/System Infrastructure/i).length).toBeGreaterThan(0)
  })

  it('displays workspace-wide active emergency banner with timestamp and scope when emergency stop is active', async () => {
    vi.spyOn(adminClient, 'fetchAdminOverview').mockResolvedValue({
      ...mockOverview,
      emergencyStop: {
        active: true,
        activatedAt: '2026-11-27T14:00:00.000Z',
        reason: 'Feed anomaly investigation',
      },
    })

    renderAdmin('/admin')

    await waitFor(() => {
      const banner = screen.getByTestId('admin-emergency-banner')
      expect(banner).toBeInTheDocument()
      expect(within(banner).getByText(/Feed anomaly investigation/i)).toBeInTheDocument()
      expect(within(banner).getByText(/usr_platform_canonical/i)).toBeInTheDocument()
    })
  })

  it('shows read-only operator notice and hides state-changing buttons for operator role', async () => {
    authMock.user = {
      id: 'usr_op',
      email: 'operator@tradeloom.com',
      fullName: 'Support Operator',
      role: 'operator',
    }

    renderAdmin('/admin/system')

    await waitFor(() => {
      expect(screen.getByText(/Read-only operator view:/i)).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'System' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /Activate Emergency Stop/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Prune Stale Workers/i })).not.toBeInTheDocument()
  })

  it('navigates to System, opens standardized confirmation Sheet for Emergency Stop, and records reason', async () => {
    const mockSetStop = vi
      .spyOn(adminClient, 'setAdminEmergencyStop')
      .mockResolvedValue({ active: true })
    vi.spyOn(adminClient, 'fetchAdminEvidenceStorage').mockResolvedValue({
      totalRows: 240,
      distinctSessions: 5,
      compactedRows: 180,
      estimatedStorageKb: 120,
    })

    renderAdmin('/admin/system')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'System' })).toBeInTheDocument()
      expect(screen.getByText('120 KB')).toBeInTheDocument()
    })

    const activateBtn = screen.getByRole('button', { name: /Activate Emergency Stop/i })
    fireEvent.click(activateBtn)

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Activate Internal Trading Emergency Stop' })
      ).toBeInTheDocument()
      expect(screen.getAllByText(/usr_platform_canonical/i).length).toBeGreaterThan(0)
    })

    const dialog = screen.getByRole('dialog', { name: 'Activate Internal Trading Emergency Stop' })
    const confirmBtn = within(dialog).getByRole('button', { name: 'Activate Emergency Stop' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockSetStop).toHaveBeenCalledWith(expect.objectContaining({ active: true }))
    })
  })

  it('renders Users directory, distinguishes internal system account from customers, and paginates', async () => {
    const mockFetchUsers = vi.spyOn(adminClient, 'fetchAdminUsers').mockResolvedValue({
      total: 42,
      users: [
        {
          id: 'usr-1',
          email: 'alice@example.com',
          fullName: 'Alice Trader',
          role: 'user',
          status: 'active',
          createdAt: '2026-11-20T00:00:00.000Z',
        },
        {
          id: 'usr_platform_canonical',
          email: 'tradeloom-ai@tradeloom.internal',
          fullName: 'TradeLoom AI System',
          role: 'admin',
          status: 'active',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    })

    renderAdmin('/admin/users')

    await waitFor(() => {
      expect(screen.getByText('Alice Trader')).toBeInTheDocument()
      expect(screen.getByText('Internal System')).toBeInTheDocument()
      expect(screen.getByText(/Showing 1–20 of 42 users/i)).toBeInTheDocument()
    })

    const nextBtn = screen.getByRole('button', { name: 'Next' })
    fireEvent.click(nextBtn)

    await waitFor(() => {
      expect(mockFetchUsers).toHaveBeenCalledWith(expect.objectContaining({ offset: 20, limit: 20 }))
    })
  })

  it('renders unified Trading workspace with Broker Sync drift alert, Orders & Fills, and Bots', async () => {
    vi.spyOn(adminClient, 'fetchAdminBrokerFleetStatus').mockResolvedValue({
      simulatedMode: false,
      fleet: {
        totalAccounts: 8,
        paperAccounts: 6,
        liveAccounts: 2,
        inSyncAccounts: 7,
        driftedAccountsCount: 1,
      },
      driftedAccounts: [
        {
          userId: 'usr_drifted',
          userEmail: 'trader@example.com',
          paper: false,
          mismatchCount: 1,
          mismatchDetails: [{ symbol: 'TSLA', localQty: 25, brokerQty: 20 }],
        },
      ],
    })
    const mockReconcile = vi.spyOn(adminClient, 'triggerAdminBrokerReconcileAll').mockResolvedValue({
      total: 8,
      succeeded: 8,
      failed: 0,
    })
    vi.spyOn(adminClient, 'fetchAdminExecutions').mockResolvedValue({
      total: 1,
      executions: [
        {
          id: 'exec-1',
          ticker: 'AAPL',
          direction: 'buy',
          quantity: 5,
          price: 230.5,
          filledPrice: 231.1,
          status: 'filled',
          userId: 'usr-1',
          user: { email: 'alice@example.com' },
          createdAt: '2026-11-27T14:30:00.000Z',
        },
      ],
    })
    vi.spyOn(adminClient, 'fetchAdminBots').mockResolvedValue({
      total: 1,
      bots: [
        {
          id: 'bot-1',
          name: 'Momentum Bot',
          botType: 'rule_based',
          enabled: true,
          userId: 'usr-1',
          user: { fullName: 'Alice Trader', email: 'alice@example.com' },
          filledExecutionsCount: 3,
        },
      ],
    })

    renderAdmin('/admin/trading')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Trading' })).toBeInTheDocument()
      expect(screen.getByText('trader@example.com')).toBeInTheDocument()
      expect(screen.getByText('Target: $230.50')).toBeInTheDocument()
      expect(screen.getByText('Executed: $231.10')).toBeInTheDocument()
      expect(screen.getByText('Momentum Bot')).toBeInTheDocument()
    })

    const reconcileBtn = screen.getByRole('button', { name: /Reconcile Broker Accounts/i })
    fireEvent.click(reconcileBtn)

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: 'Trigger Fleet Broker Reconciliation' })
      ).toBeInTheDocument()
    })

    const confirmBtn = screen.getByRole('button', { name: 'Run Fleet Reconciliation' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockReconcile).toHaveBeenCalled()
    })
  })

  it('renders unified AI & Data workspace with Market Feeds, Signal Safety Gate, and Cycle Inspector Sheet', async () => {
    vi.spyOn(adminClient, 'fetchAdminMarketDataDiagnostics').mockResolvedValue({
      status: 'healthy',
      session: '2026-11-25',
      summary: { total: 10, healthy: 10, stale: 0, missing: 0 },
      symbols: [
        {
          symbol: 'AAPL',
          session: '2026-11-25',
          status: 'healthy',
          open: 230.1,
          close: 232.5,
          high: 233.0,
          low: 229.8,
          volume: 45000000,
          barsCount: 22,
          reason: null,
        },
      ],
    })
    const mockRevalidate = vi.spyOn(adminClient, 'revalidateAdminMarketFeed').mockResolvedValue({
      status: 'healthy',
      session: '2026-11-25',
      summary: { total: 10, healthy: 10 },
      symbols: [],
    })
    vi.spyOn(adminClient, 'fetchAdminResearchDiagnostics').mockResolvedValue({
      status: 'healthy',
      publication: {
        id: 'pub_123',
        marketDate: '2026-11-25',
        model: 'trend_momentum_v1',
        publisherKeyId: 'key_ae_pub_01',
        workerId: 'scheduled_worker',
      },
      gates: [
        { gate: 'schema', status: 'pass' },
        { gate: 'edge_over_baseline', status: 'fail' },
      ],
      quality: { edgeOverBaseline: false, genuineOutOfSample: true },
      summary: {
        symbolsEvaluated: 10,
        signalsCount: 10,
        tradingEligibleCount: 0,
        tradingEligibilityVerdict: 'PROTECTED_NO_EDGE',
        explanation: 'Protected because model showed no edge over baseline.',
      },
      symbols: [
        {
          symbol: 'AAPL',
          status: 'signal',
          direction: 'BUY',
          score: 0.4788,
          eligibleForTrading: false,
          edgeOverBaseline: false,
        },
      ],
    })
    vi.spyOn(adminClient, 'fetchAdminAiCycles').mockResolvedValue({
      total: 1,
      metrics: { totalCycles: 1, totalCostUsd: 0.0005, totalTokens: 1950, latestModel: 'gpt-4o-mini' },
      cycles: [
        {
          id: 'cycle-1',
          session: '2026-11-25',
          intendedSession: '2026-11-26',
          model: 'gpt-4o-mini',
          marketSummary: 'Risk-on regime with tech leadership',
          isReplay: false,
          estimatedCostUsd: 0.0005,
          usage: { total_tokens: 1950 },
          decisionCounts: { buy: 1, hold: 1, sell: 0 },
        },
      ],
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
          exitRule: { stopLossPct: 4, takeProfitPct: 8, timeStopDays: 5 },
        },
      ],
    })
    const mockCycleDetail = vi.spyOn(adminClient, 'fetchAdminAiCycleDetail').mockResolvedValue({
      id: 'cycle-1',
      session: '2026-11-25',
      model: 'gpt-4o-mini',
      provider: 'openai',
      marketSummary: 'Risk-on regime with tech leadership',
      isReplay: false,
      symbolEvaluations: [
        {
          symbol: 'AAPL',
          action: 'BUY',
          confidence: 0.88,
          thesis: 'Strong institutional accumulation above 20-day moving average.',
          exitRule: { stopLossPct: 4, takeProfitPct: 8, timeStopDays: 5 },
        },
      ],
    })

    renderAdmin('/admin/ai')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AI & Data' })).toBeInTheDocument()
      expect(screen.getByText('Healthy (10/10)')).toBeInTheDocument()
      expect(screen.getByText('trend_momentum_v1')).toBeInTheDocument()
      expect(screen.getByText('Risk-on regime with tech leadership')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Verify Market Feeds' }))
    await waitFor(() => {
      expect(mockRevalidate).toHaveBeenCalledWith({ session: '2026-11-25' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Cycle' }))
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /AI Research Cycle: 2026-11-25/i })).toBeInTheDocument()
      expect(mockCycleDetail).toHaveBeenCalledWith('cycle-1')
    })
  })
})
