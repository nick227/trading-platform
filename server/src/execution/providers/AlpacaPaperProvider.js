/**
 * AlpacaPaperProvider (P2 — Paper Brokerage Execution Provider)
 *
 * Implements ExecutionProvider strictly against Alpaca's paper-trading environment
 * (`https://paper-api.alpaca.markets`). Refuses construction if `paper !== true`.
 */
import { AlpacaClient } from '../../../../worker/src/broker/alpacaClient.js'
import {
  EXECUTION_PROVIDER_TYPES,
  ExecutionProvider,
  LiveExecutionDisabledError
} from './ExecutionProvider.js'

export class AlpacaPaperProvider extends ExecutionProvider {
  constructor({ apiKey, apiSecret, brokerConnectionId = null, externalAccountId = null, clientFactory = null }) {
    super({
      providerType: EXECUTION_PROVIDER_TYPES.ALPACA_PAPER,
      environment: 'alpaca_paper',
      simulated: false
    })
    if (!apiKey || !apiSecret) {
      throw new Error('AlpacaPaperProvider requires apiKey and apiSecret')
    }
    this.brokerConnectionId = brokerConnectionId
    this.externalAccountId = externalAccountId
    this._alpaca = clientFactory
      ? clientFactory({ apiKey, apiSecret, paper: true })
      : new AlpacaClient({ apiKey, apiSecret, paper: true })
    if (this._alpaca.paper === false) {
      throw new LiveExecutionDisabledError('AlpacaPaperProvider cannot wrap a non-paper Alpaca client')
    }
  }

  async submitOrder({ ticker, side, qty, type = 'market', limitPrice, clientOrderId }) {
    const order = await this._alpaca.submitOrder({ ticker, side, qty, type, limitPrice, clientOrderId })
    return {
      ...order,
      providerType: this.providerType,
      environment: this.environment
    }
  }

  async getOrder(providerOrderId) {
    return this._alpaca.getOrder(providerOrderId)
  }

  async getOrderByClientOrderId(clientOrderId) {
    return this._alpaca.getOrderByClientOrderId(clientOrderId)
  }

  async cancelOrder(providerOrderId) {
    return this._alpaca.cancelOrder(providerOrderId)
  }

  async getAccount() {
    return this._alpaca.getAccount()
  }

  async getPositions() {
    return this._alpaca.getPositions()
  }

  async getClock() {
    return this._alpaca.getClock()
  }
}
