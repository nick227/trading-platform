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
    await expect(home.getByRole('heading',{name:'Automated trading with integrated research, strategy testing, and portfolio management.'})).toBeVisible()
    await expect(home.getByRole('heading',{name:'Register for beta access'})).toBeVisible()
    await expect(home.getByTestId('hero-workflow')).toHaveCount(0)
    await expect(home.locator('.tl-public-hero__copy')).toContainText('TradeLoom is being developed to research market opportunities')
    await expect(home.locator('.tl-public-hero__copy')).toContainText('Real-money brokerage execution is not yet available.')
    await home.getByRole('button',{name:'Show password'}).click()
    await expect(home.locator('input[name="password"]')).toHaveAttribute('type','text')
    await home.getByRole('button',{name:'Hide password'}).click()
    await expect(home.locator('input[name="password"]')).toHaveAttribute('type','password')
    await expect(home.getByRole('button',{name:'Create beta account'})).toBeVisible()
    await expect(home.getByRole('heading',{name:'All accounts are currently free during beta development.'})).toBeVisible()
    await expect(home.getByRole('heading',{name:'Review the performance of our automated trading strategies.'})).toBeVisible()
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1)
    await home.getByRole('button',{name:'Sign in'}).click()
    await expect(home.getByRole('heading',{name:'Welcome back'})).toBeVisible()
    await home.getByRole('button',{name:'Create account'}).click()
    await expect(home.getByRole('heading',{name:'Register for beta access'})).toBeVisible()
    await expect(home.getByText('Pricing to be announced')).toBeVisible()
    await expect(home.getByText(/Beta access is temporary/)).toBeVisible()
    await home.getByText('When will TradeLoom support real-money trading?').click()
    await expect(home.getByText(/Live trading, deposits, and a launch date are not currently available/)).toBeVisible()
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

test('automation section describes planned real-money execution without presenting internal AI stages', async ({page}) => {
  let pipelineRequests = 0
  await page.route('**/api/public/strategies/tmpl_ai_catalyst_momentum/pipeline', route => {
    pipelineRequests += 1
    return route.fulfill({status:503,contentType:'application/json',body:'{}'})
  })
  await page.goto('/')
  const automation = page.locator('#public-automation')
  await expect(automation.getByRole('heading',{name:'TradeLoom is being developed to automate trading strategies through connected brokerage accounts.'})).toBeVisible()
  await expect(automation).toContainText('Live brokerage execution is still under development.')
  await expect(automation).not.toContainText('AUTOMATED PAPER TRADING')
  await expect(page.getByTestId('public-pipeline')).toHaveCount(0)
  await expect(page.getByText('Recorded AI pipeline')).toHaveCount(0)
  expect(pipelineRequests).toBe(0)
})

test('methodology explains testing methods without unexplained jargon', async ({page}) => {
  await page.goto('/')
  const section=page.locator('#public-testing')
  await expect(section.getByRole('heading',{name:'Evaluate trading strategies using historical and forward-testing results.'})).toBeVisible()
  await expect(section.getByRole('heading',{name:'Testing strategies against past market data'})).toBeVisible()
  await expect(section.getByRole('heading',{name:'Testing against historical data not used during development'})).toBeVisible()
  await expect(section.getByRole('heading',{name:'Testing with new market activity without placing real orders'})).toBeVisible()
  await expect(section).not.toContainText('Holdout evaluations')
  await expect(section.getByRole('link',{name:'Review published strategy reports'})).toHaveAttribute('href','/strategies')
})

test('product and trust copy links to real workflows with no unsupported checkout', async ({page}) => {
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'The platform integrates stock research, automated strategies, and portfolio management.'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Published strategy results include losses and testing limitations.'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Register for the TradeLoom beta.'})).toBeVisible()
  await expect(page.getByRole('navigation',{name:'Public homepage links'})).toBeVisible()
  await expect(page.getByText('Are stock research rankings buy recommendations?')).toBeVisible()
  await expect(page.getByRole('link',{name:'Inspect strategies without signing in'})).toHaveAttribute('href','/strategies')
})

test('original first-viewport composition and section pacing are preserved', async ({page}) => {
  await page.setViewportSize({width:1440,height:900})
  await page.goto('/')
  const hero = page.locator('.tl-public-hero')
  const copy = hero.locator('.tl-public-hero__copy')
  const form = hero.locator('#get-started')
  await expect(copy.getByRole('heading', {name:'Automated trading with integrated research, strategy testing, and portfolio management.'})).toBeVisible()
  await expect(form.getByRole('heading', {name:'Register for beta access'})).toBeVisible()
  const [copyBounds, formBounds] = await Promise.all([copy.boundingBox(), form.boundingBox()])
  expect(copyBounds).not.toBeNull()
  expect(formBounds).not.toBeNull()
  expect(copyBounds.x + copyBounds.width).toBeLessThan(formBounds.x)
  const sectionOrder = await page.evaluate(() =>
    [...document.querySelectorAll('.tl-public-home > section')].map(el => el.id || (el.classList.contains('tl-public-hero') ? 'hero' : ''))
  )
  expect(sectionOrder.slice(0,4)).toEqual(['hero', 'pricing', 'public-live-evidence', 'how-it-works'])
  expect(sectionOrder.indexOf('public-stock-research')).toBeGreaterThan(sectionOrder.indexOf('features'))
  expect(sectionOrder.indexOf('public-automation')).toBeGreaterThan(sectionOrder.indexOf('public-live-evidence'))
})


test('beta and premium descriptions do not imply live trading is available', async ({page}) => {
  await page.goto('/')
  const pricing = page.locator('#pricing')
  await expect(pricing).toContainText('All registered accounts')
  await expect(pricing).toContainText('real-money brokerage trading when live execution is released')
  await expect(pricing).toContainText('Beta access is temporary')
  await expect(pricing).not.toContainText('Expanded automated bot access')
  await expect(pricing).not.toContainText('first-month')
  await expect(page.locator('.tl-public-hero')).toContainText('live brokerage trading is under development')
})
