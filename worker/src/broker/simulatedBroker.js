/**
 * Internal historical-replay simulator. Implements the broker interface the M6 order
 * worker uses, entirely in-process: no Alpaca client, no credentials, no network calls
 * except Alpha Engine's daily session close.
 *
 * Every order fills immediately at the configured replay session's close and is
 * labelled `simreplay_<session>_<clientOrderId>`. Fills are reconstructed from the
 * execution row after a restart, so recovery and reconciliation behave like M6 expects.
 * These are simulated fills of historical prices — never broker executions.
 */
import prisma from '../db/prisma.js'
import { engineClient } from '../../../server/src/clients/engine.js'
import { SIM_ORDER_PREFIX, simulatedAccount, simulationConfig } from '../../../server/src/services/simulationService.js'
import { wrapError } from './alpacaClient.js'

const TERMINAL = new Set(['filled', 'canceled', 'rejected', 'expired'])

export class SimulatedBroker {
  constructor(userId, { config = simulationConfig(), prismaClient = prisma, sessionClose = (t, s) => engineClient.getSessionClose(t, s), now = () => new Date() } = {}) {
    if (!config.enabled) throw new Error('simulator is not enabled')
    this.userId = userId
    this.config = config
    this.db = prismaClient
    this.sessionClose = sessionClose
    this.now = now
    this.orders = new Map() // clientOrderId -> order
    this.simulated = true
  }

  _orderId(clientOrderId) {
    return `${SIM_ORDER_PREFIX}${this.config.session}_${clientOrderId}`
  }

  async getClock() {
    // The replayed session is a trading session by construction (validated by Alpha Engine).
    const open = new Date(`${this.config.session}T14:30:00Z`)
    const close = new Date(`${this.config.session}T21:00:00Z`)
    return { is_open: true, next_open: open.toISOString(), next_close: close.toISOString(), simulated: true, mode: this.config.mode, session: this.config.session }
  }

  async getAccount() {
    return simulatedAccount(this.userId, { prismaClient: this.db, config: this.config })
  }

  async getPositions() {
    return (await this.getAccount()).positions
  }

  async submitOrder({ ticker, side, qty, clientOrderId }) {
    if (this.orders.has(clientOrderId) || (await this._fromDb(clientOrderId))) {
      throw wrapError({ response: { status: 422, data: { message: 'client_order_id must be unique' } }, message: '422' })
    }
    let px
    try {
      px = await this.sessionClose(ticker, this.config.session)
    } catch (err) {
      throw wrapError({ code: 'ECONNABORTED', message: `replay price unavailable: ${err.message}` })
    }
    if (!px || px.session !== this.config.session || !(Number(px.close) > 0)) {
      // Fail closed: never fill at a different session's price than the one configured.
      throw wrapError({ response: { status: 422, data: { message: `no ${this.config.session} close for ${ticker}` } }, message: '422' })
    }
    const at = this.now()
    const order = {
      alpacaOrderId: this._orderId(clientOrderId), clientOrderId, ticker, side, qty: Number(qty),
      status: 'filled', filledQty: Number(qty), filledAvgPrice: Number(px.close), submittedAt: at, filledAt: at,
      simulation: { mode: this.config.mode, session: this.config.session, price: 'daily_close', source: px.source ?? 'alpha-engine' },
    }
    this.orders.set(clientOrderId, order)
    return structuredClone(order)
  }

  async _fromDb(clientOrderId) {
    const e = await this.db.execution.findFirst({ where: { clientOrderId, userId: this.userId } })
    if (!e || typeof e.brokerOrderId !== 'string' || !e.brokerOrderId.startsWith(SIM_ORDER_PREFIX)) return null
    return {
      alpacaOrderId: e.brokerOrderId, clientOrderId, ticker: e.ticker, side: e.direction, qty: Number(e.quantity),
      status: e.brokerStatus && TERMINAL.has(e.brokerStatus) ? e.brokerStatus : 'filled',
      filledQty: Number(e.filledQuantity ?? e.quantity), filledAvgPrice: Number(e.filledPrice ?? e.price),
      submittedAt: e.submittedAt, filledAt: e.filledAt,
      simulation: { mode: this.config.mode, session: this.config.session, price: 'daily_close' },
    }
  }

  async getOrderByClientOrderId(clientOrderId) {
    const o = this.orders.get(clientOrderId) ?? (await this._fromDb(clientOrderId))
    return o ? structuredClone(o) : null
  }

  async getOrder(id) {
    const local = [...this.orders.values()].find((o) => o.alpacaOrderId === id)
    if (local) return structuredClone(local)
    const prefix = `${SIM_ORDER_PREFIX}${this.config.session}_`
    if (typeof id === 'string' && id.startsWith(prefix)) {
      const o = await this._fromDb(id.slice(prefix.length))
      if (o) return o
    }
    throw wrapError({ response: { status: 404, data: { message: 'order not found' } }, message: '404' })
  }

  async cancelOrder() {
    // Replay orders fill on submission; there is nothing open to cancel.
  }
}

const brokers = new Map()

export function getSimulatedBroker(userId, opts) {
  if (!brokers.has(userId)) brokers.set(userId, new SimulatedBroker(userId, opts))
  return brokers.get(userId)
}

export function clearSimulatedBrokers() {
  brokers.clear()
}
