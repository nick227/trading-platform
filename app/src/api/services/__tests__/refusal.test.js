import { describe, expect, it } from 'vitest'
import { executionToItems, normalizeExecution, refusalText } from '../botDashboardService'

const base = { id: 'x1', ticker: 'SPY', direction: 'buy', quantity: 2, price: 500, createdAt: '2026-11-22T10:00:00Z' }
const outcome = (row) => executionToItems(normalizeExecution(row), { hasCreatedEvent: true })

describe('refused orders', () => {
  it('shows a refused order as "Order refused" with a readable reason, not as cancelled', () => {
    const [item] = outcome({ ...base, status: 'refused', refusalReason: 'bot_allocation_exceeded' })
    expect(item).toMatchObject({ title: 'Order refused', explanation: 'Over this bot’s capital limit.', outcome: true })
    expect(item.diagnostics).toMatchObject({ status: 'refused', refusalReason: 'bot_allocation_exceeded' })
  })

  it('reads historical refusals stored as cancelled + "refused:<reason>" the same way', () => {
    const [item] = outcome({ ...base, status: 'cancelled', cancelReason: 'refused:max_daily_notional' })
    expect(item).toMatchObject({ title: 'Order refused', explanation: 'Over the daily trading limit.' })
  })

  it('keeps real cancellations as cancellations', () => {
    expect(outcome({ ...base, status: 'cancelled', cancelReason: 'user_cancel' })[0]).toMatchObject({ title: 'Order cancelled', explanation: 'Cancelled by you.' })
    expect(outcome({ ...base, status: 'cancelled', cancelReason: 'emergency_stop' })[0]).toMatchObject({ title: 'Order cancelled' })
  })

  it('falls back to plain wording for unknown reasons', () => {
    expect(refusalText('something_new')).toBe('Stopped before it was sent (something new).')
    expect(refusalText(null)).toBe('Stopped before it was sent.')
  })
})
