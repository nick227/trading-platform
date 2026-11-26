import { test, expect } from '@playwright/test'

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`public homepage conversion, pricing and geometry at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900})
    await page.route('**/api/public/strategies',route=>route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify({data:[]})
    }))
    await page.goto('/')
    const home=page.getByTestId('public-home')
    await expect(home).toBeVisible()
    await expect(home.getByRole('heading',{name:'AI stock research and automated trading.'})).toBeVisible()
    await expect(home.getByRole('heading',{name:'Start with a free account'})).toBeVisible()
    await expect(home.getByTestId('hero-workflow')).toBeVisible()
    await expect(home.getByRole('link',{name:/Explore published results/})).toHaveAttribute('href','/strategies')
    await home.getByRole('button',{name:'Show password'}).click()
    await expect(home.locator('input[name="password"]')).toHaveAttribute('type','text')
    await home.getByRole('button',{name:'Hide password'}).click()
    await expect(home.locator('input[name="password"]')).toHaveAttribute('type','password')
    await expect(home.getByRole('button',{name:'Create free account'})).toBeVisible()
    await expect(home.getByRole('heading',{name:/Start free/})).toBeVisible()
    await expect(home.getByRole('heading',{name:'See what the bots actually do.'})).toBeVisible()
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1)
    await home.getByRole('button',{name:'Sign in'}).click()
    await expect(home.getByRole('heading',{name:'Welcome back'})).toBeVisible()
    await home.getByRole('button',{name:'Create account'}).click()
    await expect(home.getByRole('heading',{name:'Start with a free account'})).toBeVisible()
    await expect(home.getByText('Pricing to be announced')).toBeVisible()
    await expect(home.getByText(/Account registration does not start a subscription/)).toBeVisible()
    await home.getByText('Is TradeLoom trading real money?').click()
    await expect(home.getByText(/Live brokerage orders are disabled/)).toBeVisible()
  })
}
