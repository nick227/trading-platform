/**
 * ExecutionProvider Contract (P2 — Interchangeable Execution Providers)
 *
 * Strategy, rule-engine, and AI layers never interact with brokerage SDKs or simulator internals.
 * Every execution provider implements this deterministic interface and returns standardized
 * snapshots annotated with market-data and execution provenance.
 */

export const EXECUTION_PROVIDER_TYPES = Object.freeze({
  INTERNAL_SIMULATOR: 'internal_simulator',
  ALPACA_PAPER: 'alpaca_paper',
  ALPACA_LIVE: 'alpaca_live'
})

export const MARKET_LATENCY_CLASSES = Object.freeze({
  REALTIME_STREAM: 'realtime_stream',
  DELAYED_QUOTE: 'delayed_quote',
  SESSION_OPEN: 'session_open',
  SESSION_CLOSE: 'session_close',
  HISTORICAL_REPLAY: 'historical_replay'
})

export class LiveExecutionDisabledError extends Error {
  constructor(message = 'Live execution provider is disabled. Real-money order submission is prohibited.') {
    super(message)
    this.name = 'LiveExecutionDisabledError'
    this.code = 'LIVE_EXECUTION_DISABLED'
    this.retryable = false
  }
}

/**
 * Base class documenting and enforcing the ExecutionProvider contract.
 */
export class ExecutionProvider {
  constructor({ providerType, environment, simulated }) {
    this.providerType = providerType
    this.environment = environment
    this.simulated = Boolean(simulated)
    this.paper = environment !== 'alpaca_live'
  }

  async submitOrder(_orderRequest) {
    throw new Error(`${this.providerType}.submitOrder not implemented`)
  }

  async getOrder(_providerOrderId) {
    throw new Error(`${this.providerType}.getOrder not implemented`)
  }

  async getOrderByClientOrderId(_clientOrderId) {
    throw new Error(`${this.providerType}.getOrderByClientOrderId not implemented`)
  }

  async cancelOrder(_providerOrderId) {
    throw new Error(`${this.providerType}.cancelOrder not implemented`)
  }

  async getAccount() {
    throw new Error(`${this.providerType}.getAccount not implemented`)
  }

  async getPositions() {
    throw new Error(`${this.providerType}.getPositions not implemented`)
  }

  async getClock() {
    throw new Error(`${this.providerType}.getClock not implemented`)
  }
}
