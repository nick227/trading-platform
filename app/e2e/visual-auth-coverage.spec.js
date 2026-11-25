import { test, expect } from '@playwright/test'

// A real, unprotected React route. Exercises the same form geometry used by
// signed-in settings and bot builder, without creating accounts or orders.
for (const width of [320, 375, 768, 1024, 1440]) {
  test(`authentication layout and interaction geometry at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/auth')
    const panel = page.locator('.tl-auth-panel')
    await expect(panel).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    const loginInput = page.locator('#login-email')
    const loginPassword = page.locator('#login-password')
    const loginButton = page.getByRole('button', { name: 'Sign in' })
    await expect(loginInput).toBeVisible()
    const geometry = await page.evaluate(() => {
      const box = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect()
        return { x: r.left, right: r.right, width: r.width, height: r.height }
      }
      return {
        documentWidth: document.documentElement.scrollWidth,
        panel: box('.tl-auth-panel'),
        email: box('#login-email'),
        password: box('#login-password'),
        action: box('button[type="submit"]'),
        radius: getComputedStyle(document.querySelector('.tl-auth-panel')).borderTopLeftRadius,
      }
    })
    expect(geometry.documentWidth).toBeLessThanOrEqual(width + 1)
    expect(geometry.panel.x).toBeGreaterThanOrEqual(-1)
    expect(geometry.panel.right).toBeLessThanOrEqual(width + 1)
    expect(Math.abs(geometry.email.x - geometry.password.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(geometry.email.right - geometry.password.right)).toBeLessThanOrEqual(1)
    expect(geometry.email.height).toBe(42)
    expect(geometry.action.height).toBe(42)
    expect(geometry.radius).toBe('12px')

    // Exercise a real form mode change; no account is created.
    await page.getByRole('tab', { name: 'Register' }).click()
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
    const registerFields = await page.locator('#reg-name, #reg-email, #reg-password').all()
    expect(registerFields).toHaveLength(3)
    const rects = await Promise.all(registerFields.map((el) => el.boundingBox()))
    for (const rect of rects.slice(1)) {
      expect(Math.abs(rect.x - rects[0].x)).toBeLessThanOrEqual(1)
      expect(Math.abs(rect.width - rects[0].width)).toBeLessThanOrEqual(1)
    }
    await expect(loginButton).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`auth-${width}.png`), fullPage: true })
  })
}
