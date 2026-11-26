import { test, expect } from '@playwright/test'

// Unlike visual-geometry.spec.js, this covers a rendered React route with data.
// The public strategies screen requires no test account or trading backend.
const strategies = [
  {
    templateId: 'visual-audit-long-strategy',
    name: 'A deliberately long momentum strategy name to exercise responsive geometry',
    description: 'Checks the actual strategy cards, evidence columns and aligned gutters.',
    tags: [],
    windows: {
      '5Y': { status: 'ok', symbolsTested: 8, symbolsTraded: 7, beatBuyAndHold: 5, medianReturnPct: 12.5, medianBuyAndHoldPct: 9.1 },
      '1Y': { status: 'awaiting_sessions' },
    },
  },
  {
    templateId: 'visual-audit-ai',
    name: 'AI catalyst',
    tags: ['ai'],
    windows: { forward: { status: 'awaiting_sessions' } },
  },
]

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`public Strategies renders without page overflow at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/public/strategies*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(strategies) }),
    )
    await page.goto('/strategies')
    const screen = page.getByTestId('strategies-index')
    await expect(screen).toBeVisible()
    const cards = page.getByTestId('strategy-card')
    await expect(cards).toHaveCount(2)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1)
    for (const card of await cards.all()) {
      const bounds = await card.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds.x).toBeGreaterThanOrEqual(-1)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
      const radius = await card.evaluate((el) => getComputedStyle(el).borderRadius)
      expect(radius).toBe('12px')
    }
    // Tiled cards retain consistent geometry within each grid column.
    const axes = await cards.evaluateAll((items) => items.map((el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return {
        left: rect.left,
        right: rect.right,
        paddingLeft: parseFloat(style.paddingLeft),
        paddingRight: parseFloat(style.paddingRight),
        radius: parseFloat(style.borderTopLeftRadius),
      }
    }))
    for (const axis of axes.slice(1)) {
      expect(Math.abs(axis.paddingLeft - axes[0].paddingLeft)).toBeLessThanOrEqual(1)
      expect(Math.abs(axis.paddingRight - axes[0].paddingRight)).toBeLessThanOrEqual(1)
    }
    expect(axes[0].paddingLeft).toBe(width < 700 ? 16 : 24)
    const columns = width >= 1300 ? 3 : width >= 700 ? 2 : 1
    const firstRow = axes.slice(0, Math.min(columns, axes.length))
    expect(new Set(firstRow.map(axis => Math.round(axis.left))).size).toBe(firstRow.length)
    await page.screenshot({ path: testInfo.outputPath(`strategies-${width}.png`), fullPage: true })
  })
}
