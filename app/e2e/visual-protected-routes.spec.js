import { test, expect } from '@playwright/test'

// Real protected React routes with deterministic, read-only paper-trading API
// responses. No real users, brokerage credentials, order submissions or trades.
const user = { id: 'visual-review-user', fullName: 'Visual Review', email: 'review@example.test' }
const valuation = {
  source: 'simulated', simulated: true, simMode: 'paper_daily',
  startingCash: 10000, equity: 10000, cash: 10000, marketValue: 0,
  totalPnl: 0, realizedPnl: 0, unrealizedPnl: 0, totalPnlPct: 0,
  fillCount: 0, positions: [], unpricedSymbols: [], valuationComplete: true,
}

async function mockReadOnlySession(page) {
  await page.route('**/api/**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    // Vite serves frontend modules from /src/api/*; never mock those modules.
    if (!path.startsWith('/api/')) return route.continue()
    if (request.method() !== 'GET') {
      return route.fulfill({
        status: 405, contentType: 'application/json',
        body: JSON.stringify({ error: 'Visual QA is read-only' }),
      })
    }
    let data = {}
    if (path === '/api/auth/me') data = user
    else if (path === '/api/account/broker-credentials') data = { mode: 'paper_daily', connected: false, paper: true }
    else if (path === '/api/account/valuation') data = valuation
    else if (path === '/api/account/value-history') data = { source: 'simulated', startingCash: 10000, points: [] }
    else if (path === '/api/alpaca/account') data = { buyingPower: 10000 }
    else if (path === '/api/bots/catalog') data = {
      ruleBased: [{
        id: 'visual-dca', name: 'Visual DCA', botType: 'rule_based',
        description: 'Paper-trading sample template for visual QA',
        config: { tickers: ['SPY'], direction: 'buy', allocatedAmount: 1000, maxOrderNotional: 100 },
        rules: [],
      }],
      strategyBased: [],
    }
    else if (path === '/api/bots') data = []
    else if (path === '/api/orders' || path === '/api/executions' || path === '/api/assets' || path === '/api/strategies/platform' || path === '/api/public/strategies') data = []
    else if (path === '/api/bots/visual-bot') data = {
      id: 'visual-bot', name: 'Sample Paper Bot', enabled: false, stopped: false,
      botType: 'rule_based', allocation: 1000, capitalInUse: null,
      config: { symbols: ['SPY'], direction: 'buy', frequency: 'daily', amount: 100 },
      rules: [], performance: null,
    }
    else if (path === '/api/portfolios/default') data = { id: 'visual-portfolio' }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      // Profile client reads raw JSON; the generic API client unwraps { data }.
      body: JSON.stringify(
        path === '/api/auth/me' || path === '/api/account/broker-credentials'
          ? data
          : { data },
      ),
    })
  })
}

const screens = [
  { path: '/', label: 'dashboard' },
  { path: '/bots', label: 'bots' },
  { path: '/bots/new', label: 'builder' },
  { path: '/assets', label: 'assets' },
  { path: '/orders', label: 'orders' },
  { path: '/orders/confirm', label: 'order-missing' },
  { path: '/profile', label: 'account' },
  { path: '/research', label: 'research' },
]

// One test per viewport: failures stop quickly instead of retrying each route.
test.describe.configure({ retries: 0 })
for (const width of [320, 375, 768, 1024, 1440]) {
  test(`protected pages render at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 900 })
    await mockReadOnlySession(page)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))

    for (const screen of screens) {
      await page.goto(screen.path)
      await expect.poll(() => new URL(page.url()).pathname).toBe(screen.path)
      await expect(page.locator('.tl-nav')).toBeVisible({ timeout: 6000 })
      await expect(page.locator('main, .page.container').first()).toBeVisible({ timeout: 6000 })
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 6000 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 6000 }).toBeLessThanOrEqual(width + 1)
      await expect(page.locator('body')).not.toContainText('Something went wrong')
      expect(errors, `Unexpected runtime exception on ${screen.path}`).toEqual([])
      await page.screenshot({ path: testInfo.outputPath(`${screen.label}-${width}.png`), fullPage: true })
    }
  })
}
