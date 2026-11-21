import Alpaca from '@alpacahq/alpaca-trade-api'

// Typed error classes so callers can distinguish retryable vs terminal failures
export class BrokerNetworkError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BrokerNetworkError'
    this.retryable = true
  }
}

export class BrokerRejectionError extends Error {
  constructor(message, reason) {
    super(message)
    this.name = 'BrokerRejectionError'
    this.retryable = false
    this.reason = reason
  }
}

export class AlpacaClient {
  constructor({ apiKey, apiSecret, paper = true }) {
    // Guard: prevent live trading unless explicitly enabled
    if (!paper && process.env.ALLOW_LIVE_TRADING !== 'true') {
      throw new Error(
        'Live trading is disabled. Set ALLOW_LIVE_TRADING=true to enable.'
      )
    }

    this.paper = paper
    this._client = new Alpaca({
      keyId: apiKey,
      secretKey: apiSecret,
      paper
    })
  }

  // Submit a new order. Returns standardized order object.
  async submitOrder({ ticker, side, qty, type = 'market', limitPrice, clientOrderId }) {
    try {
      const params = {
        symbol: ticker,
        qty,
        side,            // 'buy' | 'sell'
        type,            // 'market' | 'limit'
        time_in_force: type === 'market' ? 'day' : 'gtc'
      }
      if (clientOrderId) {
        params.client_order_id = clientOrderId
      }
      if (type === 'limit' && limitPrice != null) {
        params.limit_price = limitPrice
      }

      const order = await this._client.createOrder(params)
      return normalizeOrder(order)
    } catch (err) {
      throw wrapError(err)
    }
  }

  // Poll current order status by broker order ID
  async getOrder(alpacaOrderId) {
    try {
      const order = await this._client.getOrder(alpacaOrderId)
      return normalizeOrder(order)
    } catch (err) {
      throw wrapError(err)
    }
  }

  async getOrderByClientOrderId(clientOrderId) {
    try {
      const order = await this._client.getOrderByClientId(clientOrderId)
      return normalizeOrder(order)
    } catch (err) {
      if (err?.response?.status === 404) return null
      throw wrapError(err)
    }
  }

  // Cancel an open order
  async cancelOrder(alpacaOrderId) {
    try {
      await this._client.cancelOrder(alpacaOrderId)
    } catch (err) {
      // 422 = already filled/cancelled — not an error for our purposes
      if (err?.response?.status === 422) return
      throw wrapError(err)
    }
  }

  // Account buying power and status
  async getAccount() {
    try {
      return await this._client.getAccount()
    } catch (err) {
      throw wrapError(err)
    }
  }

  // All open positions
  async getPositions() {
    try {
      return await this._client.getPositions()
    } catch (err) {
      throw wrapError(err)
    }
  }

  // Market clock — is market open, next open/close times
  async getClock() {
    try {
      return await this._client.getClock()
    } catch (err) {
      throw wrapError(err)
    }
  }

  // Market calendar for a date range
  async getCalendar({ start, end }) {
    try {
      return await this._client.getCalendar({ start, end })
    } catch (err) {
      throw wrapError(err)
    }
  }

  // Expose the underlying client for streaming (used by dataStream.js)
  get raw() {
    return this._client
  }
}

// Normalize Alpaca order shape to our internal format
function normalizeOrder(order) {
  return {
    alpacaOrderId:  order.id,
    clientOrderId:  order.client_order_id ?? null,
    status:         order.status,        // 'new' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired'
    filledQty:      parseFloat(order.filled_qty ?? 0),
    filledAvgPrice: order.filled_avg_price ? parseFloat(order.filled_avg_price) : null,
    submittedAt:    order.submitted_at ? new Date(order.submitted_at) : null,
    filledAt:       order.filled_at     ? new Date(order.filled_at)   : null
  }
}

// Statuses where the request may or may not have taken effect at the broker.
const RETRYABLE_HTTP = new Set([408, 425, 429])

export function wrapError(err) {
  const status = err?.response?.status
  // No HTTP response at all (timeout, connection reset/refused, DNS, abort): the
  // outcome is unknown — the broker may have accepted the order. Never treat as rejected.
  if (status == null || status >= 500 || RETRYABLE_HTTP.has(status)) {
    const e = new BrokerNetworkError(err?.message ?? 'broker request failed')
    e.httpStatus = status ?? null
    e.code = err?.code ?? null
    return e
  }
  // 401/403 = credentials, 422 = unprocessable (bad params / insufficient funds)
  const reason = err?.response?.data?.message ?? err.message
  const rejection = new BrokerRejectionError(reason, reason)
  rejection.httpStatus = status
  // Alpaca also uses 403 for "insufficient buying power/shares" — that is not a credential problem.
  rejection.credentialError = status === 401 || (status === 403 && !/buying power|shares|insufficient/i.test(String(reason)))
  return rejection
}
