import { test, expect } from '@playwright/test'

test.describe('Bot Management Workflows', () => {
  test.beforeEach(async ({ page }) => {
    // Mock API responses for bots
    await page.route('/api/bots', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'bot-1',
            name: 'SPY Trend Bot',
            botType: 'rule_based',
            enabled: true,
            config: { tickers: ['SPY'], quantity: 100, direction: 'buy' },
            portfolioId: 'prt_stub_demo',
            templateId: 'trend-template',
            createdAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T10:00:00Z',
            deletedAt: null
          },
          {
            id: 'bot-2',
            name: 'AAPL Momentum Bot',
            botType: 'strategy_based',
            enabled: false,
            config: { tickers: ['AAPL'], quantity: 50, direction: 'buy' },
            portfolioId: 'prt_stub_demo',
            strategyId: 'strategy-1',
            createdAt: '2024-01-14T15:30:00Z',
            updatedAt: '2024-01-14T15:30:00Z',
            deletedAt: null
          }
        ])
      })
    })

    await page.route('/bots/catalog', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ruleBased: [
            {
              id: 'trend-template',
              name: 'SPY Trend Filter',
              description: 'Trend following strategy for SPY',
              botType: 'rule_based',
              config: { tickers: ['SPY'], quantity: 100, direction: 'buy' },
              tags: ['trend']
            }
          ],
          strategyBased: []
        })
      })
    })
  })

  test('should view and manage bots dashboard', async ({ page }) => {
    await page.goto('/bots')

    // Check page title
    await expect(page.locator('h1')).toContainText('Bots')
    
    // Check bot status summary
    await expect(page.locator('text=1 running')).toBeVisible()
    await expect(page.locator('text=1 paused')).toBeVisible()
    await expect(page.locator('text=Total: 2')).toBeVisible()

    // Check bot cards are displayed
    await expect(page.locator('text=SPY Trend Bot')).toBeVisible()
    await expect(page.locator('text=AAPL Momentum Bot')).toBeVisible()

    // Check status badges
    await expect(page.locator('text=Running')).toBeVisible()
    await expect(page.locator('text=Paused')).toBeVisible()
  })

  test('should filter bots by status', async ({ page }) => {
    await page.goto('/bots')

    // Filter to running bots only
    await page.click('button:has-text("Running")')
    
    // Should only show running bot
    await expect(page.locator('text=SPY Trend Bot')).toBeVisible()
    await expect(page.locator('text=AAPL Momentum Bot')).not.toBeVisible()

    // Filter to paused bots only
    await page.click('button:has-text("Paused")')
    
    // Should only show paused bot
    await expect(page.locator('text=AAPL Momentum Bot')).toBeVisible()
    await expect(page.locator('text=SPY Trend Bot')).not.toBeVisible()

    // Show all bots
    await page.click('button:has-text("All Bots")')
    
    // Should show both bots
    await expect(page.locator('text=SPY Trend Bot')).toBeVisible()
    await expect(page.locator('text=AAPL Momentum Bot')).toBeVisible()
  })

  test('should navigate to bot details', async ({ page }) => {
    await page.goto('/bots')

    // Mock bot details API
    await page.route('/api/bots/bot-1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'bot-1',
          name: 'SPY Trend Bot',
          botType: 'rule_based',
          enabled: true,
          config: { tickers: ['SPY'], quantity: 100, direction: 'buy' },
          portfolioId: 'prt_stub_demo',
          templateId: 'trend-template',
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          deletedAt: null
        })
      })
    })

    // Click manage button
    await page.click('button:has-text("Manage")')

    // Should navigate to bot details page
    await expect(page).toHaveURL('/bots/bot-1')
    await expect(page.locator('h1')).toContainText('SPY Trend Bot')
    await expect(page.locator('text=Running')).toBeVisible()
  })

  test('should toggle bot status', async ({ page }) => {
    await page.goto('/bots')

    // Mock update API
    await page.route('/api/bots/bot-1', async (route) => {
      const method = route.request().method()
      if (method === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'bot-1',
            name: 'SPY Trend Bot',
            botType: 'rule_based',
            enabled: false, // Changed to disabled
            config: { tickers: ['SPY'], quantity: 100, direction: 'buy' },
            portfolioId: 'prt_stub_demo',
            templateId: 'trend-template',
            createdAt: '2024-01-15T10:00:00Z',
            updatedAt: '2024-01-15T15:30:00Z',
            deletedAt: null
          })
        })
      }
    })

    // Click pause button
    await page.click('button:has-text("Pause")')

    // Should show confirmation and update status
    await expect(page.locator('text=Paused')).toBeVisible()
  })

  test('should delete bot with confirmation', async ({ page }) => {
    await page.goto('/bots')

    // Mock delete API
    await page.route('/api/bots/bot-1', async (route) => {
      const method = route.request().method()
      if (method === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true })
        })
      }
    })

    // Handle confirmation dialog
    page.on('dialog', dialog => dialog.accept())

    // Click delete button
    await page.click('button:has-text("Delete")')

    // Should show confirmation dialog and delete bot
    await expect(page.locator('text=SPY Trend Bot')).not.toBeVisible()
  })

  test('should create new bot from template', async ({ page }) => {
    await page.goto('/bots')

    // Mock template creation API
    await page.route('/api/bots/catalog/from-template', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'bot-new',
          name: 'New Trend Bot',
          botType: 'rule_based',
          enabled: true,
          config: { tickers: ['SPY'], quantity: 50, direction: 'buy' },
          portfolioId: 'prt_stub_demo',
          templateId: 'trend-template',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null
        })
      })
    })

    // Navigate to create bot page
    await page.click('button:has-text("Create New Bot")')
    await expect(page).toHaveURL('/bots/create')

    // Select template
    await page.click('text=SPY Trend Filter')
    await page.click('button:has-text("Use Template")')

    // Fill bot configuration
    await page.fill('input[name="name"]', 'New Trend Bot')
    await page.fill('input[name="quantity"]', '50')

    // Proceed to confirmation
    await page.click('button:has-text("Next")')
    await expect(page).toHaveURL('/bots/confirm')

    // Confirm bot creation
    await page.check('input[type="checkbox"]') // Acknowledge terms
    await page.click('button:has-text("Execute Bot")')

    // Should navigate back to bots with success message
    await expect(page).toHaveURL('/bots')
    await expect(page.locator('text=Success!')).toBeVisible()
  })

  test('should view bot history', async ({ page }) => {
    await page.goto('/bots')

    // Mock bot history API
    await page.route('/api/bots/bot-1/events', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'event-1',
            botId: 'bot-1',
            type: 'rule_triggered',
            detail: 'Trend filter rule triggered',
            createdAt: '2024-01-15T10:30:00Z'
          },
          {
            id: 'event-2',
            botId: 'bot-1',
            type: 'execution_created',
            detail: 'Buy execution created',
            createdAt: '2024-01-15T10:31:00Z'
          }
        ])
      })
    })

    // Click history button
    await page.click('button:has-text("History")')

    // Should navigate to bot history page
    await expect(page).toHaveURL('/bots/bot-1/history')
    await expect(page.locator('text=Bot History')).toBeVisible()
    await expect(page.locator('text=rule_triggered')).toBeVisible()
    await expect(page.locator('text=execution_created')).toBeVisible()
  })

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock API error
    await page.route('/api/bots', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' })
      })
    })

    await page.goto('/bots')

    // Should display error message
    await expect(page.locator('text=Error')).toBeVisible()
    await expect(page.locator('text=Failed to load bots')).toBeVisible()
  })

  test('should be responsive on mobile', async ({ page }) => {
    await page.goto('/bots')
    
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })

    // Check mobile layout
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('text=SPY Trend Bot')).toBeVisible()
    
    // Check filter buttons are accessible
    await expect(page.locator('button:has-text("All Bots")')).toBeVisible()
    await expect(page.locator('button:has-text("Running")')).toBeVisible()
  })

  test('should support keyboard navigation', async ({ page }) => {
    await page.goto('/bots')

    // Tab through interactive elements
    await page.keyboard.press('Tab')
    await expect(page.locator('button:has-text("All Bots")')).toBeFocused()
    
    await page.keyboard.press('Tab')
    await expect(page.locator('button:has-text("Running")')).toBeFocused()
    
    // Activate button with Enter
    await page.keyboard.press('Enter')
    
    // Should filter to running bots
    await expect(page.locator('text=SPY Trend Bot')).toBeVisible()
    await expect(page.locator('text=AAPL Momentum Bot')).not.toBeVisible()
  })
})

test.describe('Bot Creation Workflow', () => {
  test('should complete full bot creation flow', async ({ page }) => {
    // Mock all required APIs
    await page.route('/bots/catalog', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ruleBased: [
            {
              id: 'trend-template',
              name: 'SPY Trend Filter',
              description: 'Trend following strategy',
              botType: 'rule_based',
              config: { tickers: ['SPY'], quantity: 100, direction: 'buy' }
            }
          ],
          strategyBased: []
        })
      })
    })

    await page.route('/api/bots/catalog/from-template', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'bot-new',
          name: 'Test Bot',
          botType: 'rule_based',
          enabled: true,
          config: { tickers: ['SPY'], quantity: 25, direction: 'buy' },
          portfolioId: 'prt_stub_demo',
          templateId: 'trend-template',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null
        })
      })
    })

    // Start at templates page
    await page.goto('/templates')

    // Select template
    await page.click('text=SPY Trend Filter')
    await page.click('button:has-text("Use Template")')

    // Configure bot
    await page.fill('input[name="name"]', 'Test Bot')
    await page.fill('input[name="quantity"]', '25')
    await page.click('button:has-text("Next")')

    // Confirm and execute
    await page.waitForURL('/bots/confirm')
    await page.check('input[type="checkbox"]')
    await page.click('button:has-text("Execute Bot")')

    // Verify success
    await page.waitForURL('/bots')
    await expect(page.locator('text=Success!')).toBeVisible()
    await expect(page.locator('text=Test Bot created successfully!')).toBeVisible()
  })
})
