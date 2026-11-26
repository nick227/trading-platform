import { test, expect } from '@playwright/test'

// Real strategy detail route with deterministic published evidence. No live orders,
// backend credentials, market data, or invented completed performance.
const aiStrategy = {
  templateId: 'visual-ai-content-review',
  name: 'AI Momentum & Technical Breakout',
  tags: ['ai', 'openai'],
  workshopAvailable: false,
  version: { id: 'sv_0123456789abcdef', current: true, backtestable: false, firstSession: '2026-11-20' },
  versions: [{ id: 'sv_0123456789abcdef', selected: true, current: true, firstSession: '2026-11-20' }],
  description: 'Uses AI to evaluate trading opportunities.',
  design: {
    objective: 'Autonomous AI allocation across liquid equities',
    benchmark: 'Equal-weighted buy and hold across ten symbols',
    parameterBasis: 'Model evaluates daily post-close data',
  },
  definition: { config: { allocatedAmount: 10000, maxOrderNotional: 2000 }, rules: [], parameters: {} },
  standard: { windows: ['forward'] },
  summary: { forward: { status: 'awaiting_sessions', symbolsTested: 0 } },
  results: [],
  assumptions: ['Simulated trades are not a prediction of future results.'],
}

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`strategy content hierarchy and technical disclosure at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/public/strategies/visual-ai-content-review*', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: aiStrategy }),
    }))
    await page.route('**/api/ai/strategies/visual-ai-content-review/decisions*', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: { decisions: [] } }),
    }))
    await page.goto('/strategies/visual-ai-content-review')
    const root = page.getByTestId('strategy-detail')
    await expect(root).toBeVisible()
    await expect(root.getByRole('heading', { name: 'AI Momentum & Technical Breakout', level: 1 })).toBeVisible()
    await expect(root.getByText('Uses AI to evaluate trading opportunities.')).toBeVisible()
    await expect(page.getByTestId('window-status')).toContainText('No completed simulated sessions yet')
    await expect(root.getByText('Starting simulated capital')).toBeVisible()
    await expect(root.getByText('Maximum per order')).toBeVisible()
    await expect(root.getByText('Forward paper')).toHaveCount(0)
    await expect(root.getByText('v01234567')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1)
    // Capture from the top so sticky navigation remains at its actual document position.
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0) })
    await page.screenshot({ path: testInfo.outputPath(`strategy-summary-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: 'How this strategy is defined and compared' }).click()
    await expect(root.getByText('Autonomous AI allocation across liquid equities')).toBeVisible()
    await page.getByRole('button', { name: 'Previous published versions' }).click()
    await expect(page.getByTestId('version-list')).toBeVisible()
    await page.getByRole('button', { name: 'How the performance results were tested' }).click()
    await expect(root.getByText('Simulated trades are not a prediction of future results.')).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1)
    // Capture from the top so sticky navigation remains at its actual document position.
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0) })
    await page.screenshot({ path: testInfo.outputPath(`strategy-expanded-${width}.png`), fullPage: true })
  })
}
