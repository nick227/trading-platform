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

test('automation pipeline distinguishes recorded, skipped and unrecorded stages', async ({page}) => {
  await page.route('**/api/public/strategies/tmpl_ai_catalyst_momentum/pipeline', route => route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({data:{
      status:'healthy',pendingOrdersCount:0,stages:{
        market_data_ingestion:{status:'ok',session:'2026-11-24'},
        pending_order_execution:{status:'skipped',session:'2026-11-24'},
        ai_research_decision:{status:'unrecorded'},
        portfolio_valuation:{status:'ok',session:'2026-11-24'},
        strategy_evidence_publication:{status:'unrecorded'}
      }
    }})
  }))
  await page.goto('/')
  await page.locator('#public-automation').scrollIntoViewIfNeeded()
  const pipeline = page.getByTestId('public-pipeline')
  await expect(pipeline).toBeVisible()
  await expect(pipeline.getByText('2 of 5 stages')).toBeVisible()
  await expect(pipeline.getByText('Skipped')).toBeVisible()
  await expect(pipeline.getByText('Not recorded')).toHaveCount(2)
  await expect(pipeline.getByText('Pending paper orders').first()).toBeVisible()
})

test('methodology distinguishes historical, holdout and forward evidence', async ({page}) => {
  await page.goto('/')
  const section=page.locator('#public-testing')
  await expect(section.getByRole('heading',{name:'Test results need context.'})).toBeVisible()
  await expect(section.getByText('Historical backtests')).toBeVisible()
  await expect(section.getByText('Holdout evaluations')).toBeVisible()
  await expect(section.getByText('Forward paper trading')).toBeVisible()
  await expect(section.getByRole('link',{name:'Review published strategy reports'})).toHaveAttribute('href','/strategies')
})

test('product and trust copy links to real workflows with no unsupported checkout', async ({page}) => {
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'Research, automation, and portfolio oversight.'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Simulated trading, clearly identified.'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Create a free TradeLoom account.'})).toBeVisible()
  await expect(page.getByRole('navigation',{name:'Public homepage links'})).toBeVisible()
  await expect(page.getByText('Are stock research rankings buy recommendations?')).toBeVisible()
  await expect(page.getByRole('link',{name:'Inspect strategies without signing in'})).toHaveAttribute('href','/strategies')
})
