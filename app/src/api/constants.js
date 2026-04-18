export const DIRECTION = {
  BUY: 'buy',
  SELL: 'sell'
}

export const SIDE = {
  BUY: 'BUY',
  SELL: 'SELL'
}

export const STATUS = {
  QUEUED:           'queued',
  PROCESSING:       'processing',
  PARTIALLY_FILLED: 'partially_filled',
  FILLED:           'filled',
  CANCELLED:        'cancelled',
  FAILED:           'failed'
}

// Statuses that represent a real, settled position (used by derivePositions)
export const SETTLED_STATUSES = new Set(['filled', 'partially_filled'])

export const STUB_USER_ID = 'usr_stub_demo'
