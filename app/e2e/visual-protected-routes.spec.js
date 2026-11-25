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
    else if (path === '/api/bots/catalog') data = { ruleBased: [], strategyBased: [] }
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
      body: JSON.stringify({ data }),
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

for (const width of [320, 375, 768, 1024, 1440]) {
  for (const screen of screens) {
    test(`protected ${screen.label} visual acceptance at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await mockReadOnlySession(page)
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(screen.path)
      await expect.poll(() => new URL(page.url()).pathname).toBe(screen.path)
      await expect(page.locator('.tl-skel').first()).toBeHidden({ timeout: 10000 }).catch(() => {})
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1)
      await expect(page.locator('body')).not.toContainText('Something went wrong')
      expect(errors).toEqual([])
      await page.screenshot({
        path: testInfo.outputPath(`${screen.label}-${width}.png`),
        fullPage: true,
      })
    })
  }
}
