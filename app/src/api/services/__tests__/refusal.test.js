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

describe('cancellation and failure wording never shows raw reason codes', () => {
  const base = { id: 'x2', ticker: 'AAPL', direction: 'buy', quantity: 1, price: 100, createdAt: '2026-11-22T10:00:00Z' }
  const one = (row) => executionToItems(normalizeExecution({ ...base, ...row }), { hasCreatedEvent: true })[0]
  it.each([
    ['user_cancel_requested_pre_submit', 'Cancelled by you before it was sent.'],
    ['emergency_stop_pre_submit', 'Cancelled by the emergency stop before it was sent.'],
    ['broker_cancelled_after_user_request', 'Cancelled at the broker, as you requested.'],
    ['broker_status:expired', 'Closed by the broker (expired).'],
    ['something_unmapped', 'This order was cancelled.'],
  ])('cancelled · %s', (reason, text) => {
    expect(one({ status: 'cancelled', cancelReason: reason })).toMatchObject({ title: 'Order cancelled', explanation: text })
  })
  it('failed orders read plainly', () => {
    expect(one({ status: 'failed', cancelReason: 'max_attempts_exceeded' }).explanation).toBe('Couldn’t be sent after several attempts. Nothing reached the broker.')
  })
})
