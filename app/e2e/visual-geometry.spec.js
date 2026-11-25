import { test, expect } from '@playwright/test'

// Exercise the actual app stylesheet with deterministic, backend-independent
// components. A second, authenticated walkthrough remains part of release QA.
const fixture = `
  <link rel="stylesheet" href="/src/styles/main.css">
  <main class="tl-page">
    <header class="tl-header tl-aligned-header">
      <div><h1 class="tl-title">Visual geometry audit</h1><p class="tl-lede">A long subtitle that must not move the action beyond the page edge.</p></div>
      <a class="tl-btn tl-btn--primary" href="#cards">Create bot</a>
    </header>
    <section class="tl-section" id="cards">
      <div class="tl-section-head"><h2 class="tl-section-title">Actions</h2></div>
      <div class="tl-card-shell" style="margin-top:16px">
        <div class="tl-action-group" data-testid="equal-actions">
          <button class="tl-btn tl-btn--primary">Create bot</button>
          <button class="tl-btn tl-btn--secondary">Run backtest</button>
        </div>
        <div class="tl-action-row tl-action-row--equal" data-testid="equal-row" style="margin-top:20px">
          <button class="tl-btn tl-btn--secondary">Details</button>
          <button class="tl-btn tl-btn--primary">Open workshop</button>
          <button class="tl-btn tl-btn--secondary">Compare</button>
        </div>
        <div class="tl-bot-actions tl-action-row" style="margin-top:20px">
          <button class="tl-btn tl-btn--positive">Resume</button>
          <button class="tl-btn tl-btn--warning">Pause</button>
          <button class="tl-btn tl-btn--danger-solid">Stop bot</button>
          <button class="tl-btn tl-btn--secondary">Edit bot</button>
        </div>
      </div>
    </section>
    <section class="tl-section">
      <div class="tl-section-head"><h2 class="tl-section-title">Metrics</h2></div>
      <div class="tl-metric-grid" style="margin-top:16px">
        <div class="tl-card-shell tl-card-shell--compact"><strong>$10,000</strong><p>Paper capital</p></div>
        <div class="tl-card-shell tl-card-shell--compact"><strong>$2,000</strong><p>Order limit</p></div>
        <div class="tl-card-shell tl-card-shell--compact"><strong>Daily</strong><p>Evaluation</p></div>
      </div>
      <dl class="tl-fact-rows" style="margin-top:16px">
        <div><dt>Portfolio allocation</dt><dd>$10,000</dd></div>
        <div><dt>Maximum per order</dt><dd>$2,000</dd></div>
      </dl>
      <input class="tl-input" aria-label="Strategy name" value="Momentum" style="margin-top:16px" />
      <table class="tl-table" style="margin-top:16px">
        <thead><tr><th>Symbol</th><th>Return</th><th>Buy and hold</th><th>Max drawdown</th><th>Trades</th><th>Win rate</th></tr></thead>
        <tbody><tr><td>NVDA</td><td>+8.4%</td><td>+12.4%</td><td>−4.1%</td><td>16</td><td>61%</td></tr></tbody>
      </table>
    </section>
  </main>
`

test.describe('visual geometry contract', () => {
  for (const width of [320, 375, 768, 1024, 1440]) {
    test(`shared control and edge geometry at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await page.setContent(fixture)
      await expect.poll(() => page.locator('.tl-btn--primary').first().evaluate(
        el => getComputedStyle(el).backgroundColor
      )).not.toBe('rgba(0, 0, 0, 0)')

      const geometry = await page.evaluate(() => {
        const rect = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect()
          return { x: r.x, right: r.right, width: r.width, height: r.height }
        }
        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          page: rect('.tl-page'),
          card: rect('.tl-card-shell'),
          firstAction: rect('[data-testid="equal-actions"] .tl-btn:first-child'),
          secondAction: rect('[data-testid="equal-actions"] .tl-btn:last-child'),
          botActionWidths: [...document.querySelectorAll('.tl-bot-actions > .tl-btn')].map(el => el.getBoundingClientRect().width),
          equalRowWidths: [...document.querySelectorAll('[data-testid="equal-row"] > .tl-btn')].map(el => el.getBoundingClientRect().width),
          controlRadius: getComputedStyle(document.querySelector('.tl-btn--primary')).borderRadius,
          cardRadius: getComputedStyle(document.querySelector('.tl-card-shell')).borderRadius,
          inputHeight: document.querySelector('.tl-input').getBoundingClientRect().height,
          positive: getComputedStyle(document.querySelector('.tl-btn--positive')).backgroundColor,
          warning: getComputedStyle(document.querySelector('.tl-btn--warning')).backgroundColor,
          destructive: getComputedStyle(document.querySelector('.tl-btn--danger-solid')).backgroundColor,
        }
      })
      expect(geometry.documentWidth).toBeLessThanOrEqual(width + 1)
      expect(geometry.card.x).toBeGreaterThanOrEqual(geometry.page.x - 1)
      expect(geometry.card.right).toBeLessThanOrEqual(geometry.page.right + 1)
      expect(geometry.firstAction.height).toBe(42)
      expect(geometry.secondAction.height).toBe(42)
      expect(geometry.inputHeight).toBe(42)
      expect(Math.abs(geometry.firstAction.width - geometry.secondAction.width)).toBeLessThanOrEqual(1)
      expect(Math.max(...geometry.botActionWidths) - Math.min(...geometry.botActionWidths)).toBeLessThanOrEqual(1)
      expect(Math.max(...geometry.equalRowWidths) - Math.min(...geometry.equalRowWidths)).toBeLessThanOrEqual(1)
      expect(geometry.controlRadius).toBe('9px')
      expect(geometry.cardRadius).toBe('12px')
      expect(new Set([geometry.positive, geometry.warning, geometry.destructive]).size).toBe(3)
      await page.screenshot({ path: testInfo.outputPath(`geometry-${width}.png`), fullPage: true })
    })
  }
})
