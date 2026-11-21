// Execution status vocabulary shared by the order worker, bot engine, and risk checks.

// Not terminal: the order may still reach (or already be at) the broker.
// `needs_reconciliation` = a submit was attempted but its outcome is unknown;
// it is only ever resolved by broker lookup, never by a fresh submit.
export const ACTIVE_EXECUTION_STATUSES = ['queued', 'processing', 'submitted', 'partially_filled', 'needs_reconciliation']

// Known to the broker (or possibly known) and awaiting a final broker state.
export const BROKER_OPEN_STATUSES = ['submitted', 'partially_filled', 'needs_reconciliation']

export const TERMINAL_EXECUTION_STATUSES = ['filled', 'cancelled', 'failed']

// Alpaca order states.
export const TERMINAL_BROKER_STATUSES = new Set(['canceled', 'rejected', 'expired', 'done_for_day'])
export const PENDING_BROKER_STATUSES = new Set([
  'new', 'accepted', 'pending_new', 'accepted_for_bidding', 'pending_replace', 'replaced',
  'calculated', 'pending_cancel', 'held', 'stopped', 'suspended'
])
