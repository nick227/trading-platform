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
})
