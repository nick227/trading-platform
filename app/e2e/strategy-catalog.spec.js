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
    await expect(root.getByRole('heading',{name:"Automated trading strategies"})).toBeVisible()
    const cards=root.getByTestId('strategy-card')
    await expect(cards).toHaveCount(3)
    for(const card of await cards.all()) {
      await expect(card.locator('a')).toHaveCount(1)
      await expect(card.locator('h2')).toHaveCount(1)
    }
    await expect(cards.first()).toContainText('−7.25%')
    await expect(cards.first()).toContainText('+3.50%')
    await expect(cards.first()).toContainText('Typical strategy return')
    await expect(cards.nth(1)).toContainText('has not completed enough simulated trading sessions')
    await expect(cards.nth(2)).toContainText('cannot be tested using the available historical method')
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

test('tiled cards have no hover shadow, movement, or border-color transition', async ({page}) => {
  await page.setViewportSize({width:1440,height:900})
  await mockCatalog(page)
  await page.goto('/strategies')
  const cards=page.getByTestId('strategy-card')
  await expect(cards).toHaveCount(3)
  const initial=await cards.first().evaluate(el=>{const s=getComputedStyle(el);return {shadow:s.boxShadow,transform:s.transform,border:s.borderColor,transition:s.transitionDuration}})
  await cards.first().hover()
  const hovered=await cards.first().evaluate(el=>{const s=getComputedStyle(el);return {shadow:s.boxShadow,transform:s.transform,border:s.borderColor,transition:s.transitionDuration}})
  expect(hovered).toEqual(initial)
  expect(initial.shadow).toBe('none')
  expect(initial.transform).toBe('none')
  expect(initial.transition).toBe('0s')
})

test('the catalog tiles into one, two, and three columns without changing evidence', async ({page}) => {
  await mockCatalog(page)
  for(const [width,columns] of [[375,1],[900,2],[1440,3]]) {
    await page.setViewportSize({width,height:900})
    await page.goto('/strategies')
    const cards=page.getByTestId('strategy-card')
    await expect(cards).toHaveCount(3)
    const positions=await cards.evaluateAll(list=>list.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})))
    expect(new Set(positions.filter(x=>x.y===positions[0].y).map(x=>x.x)).size).toBe(columns)
    await expect(cards.first()).toContainText('−7.25%')
    await expect(cards.first()).toContainText('+3.50%')
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1)
  }
})
