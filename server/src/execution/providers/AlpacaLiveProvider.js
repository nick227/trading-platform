/**
 * Disabled Live Execution Provider (P2 — Hard Live Containment)
 *
 * Explicitly represents the future real-money provider slot while guaranteeing by construction
 * that zero live network requests or order submissions can occur while live trading is disabled.
 */
import {
  EXECUTION_PROVIDER_TYPES,
  ExecutionProvider,
  LiveExecutionDisabledError
} from './ExecutionProvider.js'

export class AlpacaLiveProvider extends ExecutionProvider {
  constructor({ allowConstruct = false } = {}) {
    if (!allowConstruct) {
      throw new LiveExecutionDisabledError()
    }
    super({
      providerType: EXECUTION_PROVIDER_TYPES.ALPACA_LIVE,
      environment: 'alpaca_live',
      simulated: false
    })
  }

  async submitOrder() {
    throw new LiveExecutionDisabledError()
  }

  async getOrder() {
    throw new LiveExecutionDisabledError()
  }

  async getOrderByClientOrderId() {
    throw new LiveExecutionDisabledError()
  }

  async cancelOrder() {
    throw new LiveExecutionDisabledError()
  }

  async getAccount() {
    throw new LiveExecutionDisabledError()
  }

  async getPositions() {
    throw new LiveExecutionDisabledError()
  }

  async getClock() {
    throw new LiveExecutionDisabledError()
  }
}
