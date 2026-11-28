import { test, expect } from '@playwright/test'

const adminUser = {
  id: 'usr_admin_qa',
  fullName: 'Admin QA',
  email: 'admin@tradeloom.test',
  role: 'admin',
}

async function mockAdminReadOnlySession(page) {
  await page.route('**/api/**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (!path.startsWith('/api/')) return route.continue()

    if (request.method() !== 'GET') {
      return route.fulfill({
        status: 405,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Visual QA is read-only' }),
      })
    }

    if (path === '/api/auth/me') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(adminUser),
      })
    }

    if (path === '/api/account/broker-credentials') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mode: 'paper_daily', connected: true, paper: true }),
      })
    }

    let data = {}
    if (path === '/api/admin/overview') {
      data = {
        timestamp: '2026-11-27T15:00:00.000Z',
        emergencyStop: { active: false },
        users: { total: 42, activeSubscriptions: 31, byRole: { admin: 2, operator: 3, user: 37 } },
        bots: { total: 24, enabled: 18, paused: 6, ai: 2, rule: 22 },
        executions: { total: 120, filled: 112, queued: 3, pending_fill: 0, failed: 0, filledNotional: 48250 },
        workers: {
          total: 2,
          activeCount: 2,
          staleCount: 0,
          avgQueueLagMs: 18,
          list: [
            {
              id: 'worker-prod-1',
              isActive: true,
              queueLagMs: 18,
              startedAt: '2026-11-27T10:00:00.000Z',
              lastSeen: '2026-11-27T15:00:00.000Z',
            },
          ],
        },
        pipeline: {
          status: 'healthy',
          isTodayTradingDay: true,
          stages: {
            market_data_ingestion: { status: 'ok', session: '2026-11-25' },
            pending_order_execution: { status: 'ok', session: '2026-11-25' },
            ai_research_decision: { status: 'ok', session: '2026-11-25' },
            portfolio_valuation: { status: 'ok', session: '2026-11-25' },
            strategy_evidence_publication: { status: 'ok', session: '2026-11-25' },
          },
        },
      }
    } else if (path === '/api/admin/users') {
      data = {
        total: 2,
        users: [
          {
            id: 'usr_1',
            email: 'alice@example.test',
            fullName: 'Alice Trader',
            role: 'user',
            status: 'active',
            subscription: { plan: 'PRO', status: 'ACTIVE' },
            createdAt: '2026-11-20T00:00:00.000Z',
          },
          {
            id: 'usr_platform_canonical',
            email: 'tradeloom-ai@tradeloom.internal',
            fullName: 'TradeLoom AI System',
            role: 'admin',
            status: 'active',
            subscription: { plan: 'PRO', status: 'ACTIVE' },
            createdAt: '2026-11-01T00:00:00.000Z',
          },
        ],
      }
    } else if (path === '/api/admin/broker/fleet-status') {
      data = {
        simulatedMode: false,
        fleet: {
          totalAccounts: 12,
          paperAccounts: 10,
          liveAccounts: 2,
          inSyncAccounts: 11,
          driftedAccountsCount: 1,
        },
        driftedAccounts: [
          {
            userId: 'usr_drift',
            userEmail: 'drift@example.test',
            paper: true,
            mismatchCount: 1,
            mismatchDetails: [{ symbol: 'AAPL', localQty: 10, brokerQty: 8 }],
          },
        ],
      }
    } else if (path === '/api/admin/executions') {
      data = {
        total: 1,
        executions: [
          {
            id: 'exe_101',
            ticker: 'AAPL',
            direction: 'buy',
            quantity: 5,
            price: 230.5,
            filledPrice: null,
            status: 'queued',
            userId: 'usr_1',
            user: { email: 'alice@example.test' },
            bot: { name: 'DCA SPY' },
            createdAt: '2026-11-27T14:30:00.000Z',
          },
        ],
      }
    } else if (path === '/api/admin/bots') {
      data = {
        total: 1,
        bots: [
          {
            id: 'bot_101',
            name: 'DCA SPY',
            botType: 'rule_based',
            enabled: true,
            userId: 'usr_1',
            user: { fullName: 'Alice Trader', email: 'alice@example.test' },
            portfolio: { totalValue: 10450, cashBalance: 8200 },
            filledExecutionsCount: 4,
          },
        ],
      }
    } else if (path === '/api/admin/market-data/diagnostics') {
      data = {
        status: 'healthy',
        session: '2026-11-25',
        summary: { total: 10, healthy: 10, stale: 0, missing: 0 },
        symbols: [
          {
            symbol: 'AAPL',
            status: 'healthy',
            session: '2026-11-25',
            open: 230.1,
            close: 232.5,
            low: 229.8,
            high: 233.0,
            volume: 42000000,
            barsCount: 252,
          },
        ],
      }
    } else if (path === '/api/admin/research/pipeline-diagnostics') {
      data = {
        status: 'healthy',
        publication: { id: 'pub_qa_1', marketDate: '2026-11-25', model: 'trend_momentum_v1', publisherKeyId: 'key_01' },
        gates: [{ gate: 'schema', status: 'pass' }],
        quality: { edgeOverBaseline: true, genuineOutOfSample: true },
        summary: {
          symbolsEvaluated: 10,
          signalsCount: 4,
          tradingEligibleCount: 4,
          tradingEligibilityVerdict: 'ELIGIBLE',
          explanation: 'Research signals verified and eligible for trading.',
        },
        symbols: [{ symbol: 'AAPL', status: 'signal', direction: 'BUY', score: 0.72, eligibleForTrading: true, edgeOverBaseline: true }],
      }
    } else if (path === '/api/admin/ai/cycles') {
      data = { total: 0, cycles: [], metrics: { totalCycles: 0, totalCostUsd: 0, totalTokens: 0, latestModel: 'gpt-4o-mini' } }
    } else if (path === '/api/admin/ai/decisions') {
      data = { total: 0, decisions: [] }
    } else if (path === '/api/admin/controls/evidence-storage') {
      data = { totalRows: 120, distinctSessions: 4, compactedRows: 80, estimatedStorageKb: 96 }
    } else if (path === '/api/admin/audit-log') {
      data = { total: 0, logs: [] }
    } else if (path === '/api/admin/activity') {
      data = { total: 0, events: [] }
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    })
  })
}

const adminScreens = [
  { path: '/admin', heading: 'Overview', label: 'admin-overview' },
  { path: '/admin/users', heading: 'Users', label: 'admin-users' },
  { path: '/admin/trading', heading: 'Trading', label: 'admin-trading' },
  { path: '/admin/ai', heading: 'AI & Data', label: 'admin-ai' },
  { path: '/admin/system', heading: 'System', label: 'admin-system' },
]

test.describe.configure({ retries: 0 })
for (const width of [320, 375, 768, 1024, 1440]) {
  test(`admin workspaces render with zero overflow and canonical button geometry at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 900 })
    await mockAdminReadOnlySession(page)

    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))

    for (const screen of adminScreens) {
      await page.goto(screen.path)
      await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 8000 })
      await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible({ timeout: 8000 })
      await expect(page.getByTestId('admin-safety-indicator')).toBeVisible()

      // Verify canonical Refresh button uses TradeLoom 42px control geometry (not browser default)
      const refreshHeight = await page
        .getByRole('button', { name: 'Refresh', exact: true })
        .evaluate((el) => Math.round(el.getBoundingClientRect().height))
      expect(refreshHeight).toBeGreaterThanOrEqual(40)
      expect(refreshHeight).toBeLessThanOrEqual(44)

      // Verify zero document-level horizontal overflow
      const overflow = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        offenders: [...document.querySelectorAll('body *')]
          .filter((el) => {
            const rect = el.getBoundingClientRect()
            return rect.width > 0 && rect.right > innerWidth + 1
          })
          .slice(0, 6)
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            className: typeof el.className === 'string' ? el.className : '',
            right: Math.round(el.getBoundingClientRect().right),
          })),
      }))
      expect(overflow.width, `${screen.path} at ${width}px: ${JSON.stringify(overflow.offenders)}`).toBeLessThanOrEqual(width + 1)
      expect(errors, `Unexpected runtime error on ${screen.path}`).toEqual([])

      await page.screenshot({ path: testInfo.outputPath(`${screen.label}-${width}.png`), fullPage: true })
    }
  })
}
