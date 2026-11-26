import { test, expect } from '@playwright/test'

test('public homepage survives all evidence endpoint failures without blocking registration', async ({page}) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/public/strategies', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'unavailable'})}))
  await page.route('**/api/engine/rankings/top*', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'unavailable'})}))
  await page.route('**/api/public/strategies/tmpl_ai_catalyst_momentum/pipeline', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'unavailable'})}))
  await page.goto('/')
  const home = page.getByTestId('public-home')
  await expect(home.getByRole('heading',{name:'Trading bots you can watch and control.'})).toBeVisible()
  await expect(home.getByRole('button',{name:'Create free account'})).toBeVisible()
  await page.locator('#public-live-evidence').scrollIntoViewIfNeeded()
  await expect(page.locator('#public-live-evidence')).toContainText('Strategy data is temporarily unavailable.')
  await page.locator('#public-stock-research').scrollIntoViewIfNeeded()
  await expect(page.locator('#public-stock-research')).toContainText('Stock ranking data is temporarily unavailable.')
  await page.locator('#public-automation').scrollIntoViewIfNeeded()
  await expect(page.locator('#public-automation')).toContainText('Pipeline activity is temporarily unavailable.')
  await expect(home.getByRole('button',{name:'Create free account'})).toBeVisible()
  expect(errors).toEqual([])
})

for (const width of [320, 375, 768, 1440]) {
  test(`full public homepage remains within viewport at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900})
    await page.route('**/api/public/strategies', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[]})}))
    await page.route('**/api/engine/rankings/top*', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data:{rankings:[]}})}))
    await page.route('**/api/public/strategies/tmpl_ai_catalyst_momentum/pipeline', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{status:'bot_not_found',stages:{}}})}))
    await page.goto('/')
    await page.locator('#public-final-cta').scrollIntoViewIfNeeded()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1)
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content',/AI-assisted stock research/)
  })
}

test('registration input has proper labels and password reveal remains keyboard accessible', async ({page}) => {
  await page.goto('/')
  const password=page.getByLabel('Password',{exact:true})
  await expect(page.getByLabel('Full name')).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(password).toHaveAttribute('type','password')
  const reveal=page.getByRole('button',{name:'Show password'})
  await reveal.focus()
  await expect(reveal).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(password).toHaveAttribute('type','text')
  await page.keyboard.press('Enter')
  await expect(password).toHaveAttribute('type','password')
})
