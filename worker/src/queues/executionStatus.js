// Execution status vocabulary shared by the order worker, bot engine, and risk checks.

// Not terminal: the order may still reach (or already be at) the broker.
// `needs_reconciliation` = a submit was attempted but its outcome is unknown;
// it is only ever resolved by broker lookup, never by a fresh submit.
export const ACTIVE_EXECUTION_STATUSES = ['queued', 'processing', 'submitted', 'partially_filled', 'needs_reconciliation']

// Known to the broker (or possibly known) and awaiting a final broker state.
export const BROKER_OPEN_STATUSES = ['submitted', 'partially_filled', 'needs_reconciliation']

// `refused` = stopped by a pre-submission check (risk cap, emergency stop, ownership…);
// never sent to the broker. Distinct from `cancelled` (user, emergency stop, or broker).
export const REFUSED_STATUS = 'refused'
export const TERMINAL_EXECUTION_STATUSES = ['filled', 'cancelled', 'failed', REFUSED_STATUS]

// Before `refused` existed, refusals were stored as cancelled + cancelReason 'refused:<reason>'.
// Those rows are kept as-is (optional backfill: server/scripts/backfillRefusedStatus.mjs), so
// every refusal query matches both shapes.
export const LEGACY_REFUSAL_PREFIX = 'refused:'
export const REFUSAL_WHERE = [
  { status: REFUSED_STATUS },
  { status: 'cancelled', cancelReason: { startsWith: LEGACY_REFUSAL_PREFIX } }
]

/** The refusal reason of an execution in either shape, else null. */
export function refusalReasonOf(x) {
  if (!x) return null
  if (x.status === REFUSED_STATUS) return x.refusalReason ?? 'unknown'
  if (x.status === 'cancelled' && typeof x.cancelReason === 'string' && x.cancelReason.startsWith(LEGACY_REFUSAL_PREFIX)) return x.cancelReason.slice(LEGACY_REFUSAL_PREFIX.length)
  return null
}

// Alpaca order states.
export const TERMINAL_BROKER_STATUSES = new Set(['canceled', 'rejected', 'expired', 'done_for_day'])
export const PENDING_BROKER_STATUSES = new Set([
  'new', 'accepted', 'pending_new', 'accepted_for_bidding', 'pending_replace', 'replaced',
  'calculated', 'pending_cancel', 'held', 'stopped', 'suspended'
])
