import { test, expect } from '@playwright/test'

const strategies = [
  {templateId:'historical-sample',name:'Historical Strategy',description:'The strategy compares published price signals against configured trading rules.',windows:{
    '5Y':{status:'ok',symbolsTested:3,symbolsTraded:2,medianReturnPct:-7.25,medianBuyAndHoldPct:3.5,trades:6},
    '1Y':{status:'ok',symbolsTested:3,symbolsTraded:0,medianReturnPct:0,medianBuyAndHoldPct:1.4,trades:0},
  }},
  {templateId:'tmpl_ai_catalyst_momentum',name:'AI Momentum & Technical Breakout',tags:['ai'],description:'This strategy uses AI-assisted analysis to evaluate potential trades.',windows:{forward:{status:'awaiting_sessions'}}},
  {templateId:'unavailable-sample',name:'Historical Data Unavailable',windows:{'5Y':{status:'not_backtestable'}}},
]
function mockCatalog(page) {
  return page.route('**/api/public/strategies',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({data:strategies}),
  }))
}
for(const width of [320,375,768,1024,1440]) {
  test(`catalog cards are readable and remain within the viewport at ${width}px`, async ({page})=>{
    await page.setViewportSize({width,height:900})
    await mockCatalog(page)
    await page.goto('/strategies')
    const root=page.getByTestId('strategies-index')
    await expect(root.getByRole('heading',{name:"Explore TradeLoom's automated trading strategies."})).toBeVisible()
    const cards=root.getByTestId('strategy-card')
    await expect(cards).toHaveCount(3)
    for(const card of await cards.all()) {
      await expect(card.locator('a')).toHaveCount(1)
      await expect(card.locator('h2')).toHaveCount(1)
    }
    await expect(cards.first()).toContainText('−7.25%')
    await expect(cards.first()).toContainText('+3.50%')
    await expect(cards.first()).toContainText('The typical strategy return was')
    await expect(cards.nth(1)).toContainText('There are not yet enough completed trading sessions')
    await expect(cards.nth(2)).toContainText('cannot be evaluated with the available historical test')
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1)
  })
}
test('strategy cards offer one keyboard-accessible destination',async ({page})=>{
  await mockCatalog(page)
  await page.goto('/strategies')
  const link=page.getByTestId('strategy-card').first().locator('a')
  await link.focus()
  await expect(link).toBeFocused()
  await expect(link).toHaveAttribute('href','/strategies/historical-sample')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/strategies\/historical-sample$/)
})
test('catalog API failure preserves an understandable error state',async ({page})=>{
  await page.route('**/api/public/strategies',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}))
  await page.goto('/strategies')
  await expect(page.getByRole('alert')).toContainText('The list could not be loaded.')
  await expect(page.getByTestId('strategy-card')).toHaveCount(0)
})
