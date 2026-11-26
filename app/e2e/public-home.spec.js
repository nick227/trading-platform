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
    await expect(home.getByRole('heading',{name:'Examine recorded results before choosing a strategy.'})).toBeVisible()
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

test('public evidence cards preserve source results and missing evidence states', async ({ page }) => {
  await page.route('**/api/public/strategies', route => route.fulfill({
    status: 200, contentType:'application/json', body:JSON.stringify({data:[
      {templateId:'test-historical',name:'Historical sample',windows:{'1Y':{status:'ok',medianReturnPct:-3.5,medianBuyAndHoldPct:2.25,symbolsTested:5,trades:4}}},
      {templateId:'tmpl_ai_catalyst_momentum',name:'AI session pending',tags:['ai'],windows:{forward:{status:'awaiting_sessions'}}}
    ]})
  }))
  await page.goto('/')
  await page.locator('#public-live-evidence').scrollIntoViewIfNeeded()
  await expect(page.getByText('−3.50%')).toBeVisible()
  await expect(page.getByText('+2.25%')).toBeVisible()
  await expect(page.getByText('Awaiting forward paper sessions')).toBeVisible()
  await expect(page.getByText('Historical sample')).toBeVisible()
})

test('stock research shows actual published ranking fields and no made-up data date', async ({ page }) => {
  await page.route('**/api/engine/rankings/top*', route => route.fulfill({
    status:200, contentType:'application/json', body:JSON.stringify({success:true,data:{rankings:[
      {symbol:'MSFT',rank:1,score:75.5},{symbol:'NVDA',rank:2,score:68.25}
    ]}})
  }))
  await page.goto('/')
  await page.locator('#public-stock-research').scrollIntoViewIfNeeded()
  const picker = page.getByTestId('public-stock-picker')
  await expect(picker).toBeVisible()
  await expect(picker.getByText('MSFT')).toBeVisible()
  await expect(picker.getByText('Research score 75.5')).toBeVisible()
  await expect(picker.getByText('Publication date unavailable')).toBeVisible()
  await expect(picker.getByRole('link',{name:/Open stock research/})).toHaveAttribute('href','/research')
})
