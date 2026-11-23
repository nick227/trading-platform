/**
 * Internal historical-replay and continuous paper simulator.
 * Implements the broker interface the order worker uses, entirely in-process:
 * no Alpaca client, no credentials, no network calls except Alpha Engine quotes/closes.
 */
import prisma from '../db/prisma.js'
import { engineClient } from '../../../server/src/clients/engine.js'
import { SIM_ORDER_PREFIX, simulatedAccount, simulationConfig } from '../../../server/src/services/simulationService.js'
import { priceCache } from '../market/priceCache.js'
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
    const sessionTag = this.config.session || 'continuous'
    return `${SIM_ORDER_PREFIX}${sessionTag}_${clientOrderId}`
  }

  async getClock() {
    if (this.config.mode === 'continuous_paper') {
      const now = this.now()
      return { is_open: true, simulated: true, mode: this.config.mode, timestamp: now.toISOString() }
    }
    // Replay mode:
    const sessionTag = this.config.session || '2026-11-20'
    const open = new Date(`${sessionTag}T14:30:00Z`)
    const close = new Date(`${sessionTag}T21:00:00Z`)
    return { is_open: true, next_open: open.toISOString(), next_close: close.toISOString(), simulated: true, mode: this.config.mode, session: sessionTag }
  }

  async getAccount() {
    return simulatedAccount(this.userId, {
      prismaClient: this.db,
      config: this.config,
      priceGetter: (ticker) => priceCache.get(ticker)?.last,
    })
  }

  async getPositions() {
    return (await this.getAccount()).positions
  }

  async submitOrder({ ticker, side, qty, clientOrderId }) {
    if (this.orders.has(clientOrderId) || (await this._fromDb(clientOrderId))) {
      throw wrapError({ response: { status: 422, data: { message: 'client_order_id must be unique' } }, message: '422' })
    }

    let px = null

    // Continuous paper mode: try live quote from priceCache or engineClient
    if (this.config.mode === 'continuous_paper') {
      const cached = priceCache.get(ticker)
      if (cached?.last && Number(cached.last) > 0) {
        px = { close: Number(cached.last), session: this.config.session, source: 'continuous-cache' }
      } else {
        try {
          const q = await engineClient.getQuote(ticker)
          const last = Number(q?.price ?? q?.last ?? q?.close)
          if (Number.isFinite(last) && last > 0) {
            px = { close: last, session: this.config.session, source: 'alpha-engine-quote' }
          }
        } catch { /* fallback to sessionClose */ }
      }
    }

    // Historical or fallback: fetch session close
    if (!px) {
      try {
        px = await this.sessionClose(ticker, this.config.session)
      } catch (err) {
        throw wrapError({ code: 'ECONNABORTED', message: `replay price unavailable: ${err.message}` })
      }
    }

    if (!px || (this.config.mode === 'historical_replay' && px.session && px.session !== this.config.session) || !(Number(px.close) > 0)) {
      // Fail closed: never fill at an unverified price.
      throw wrapError({ response: { status: 422, data: { message: `no valid price for ${ticker}` } }, message: '422' })
    }

    const at = this.now()
    const fillPrice = Number(px.close)
    const order = {
      alpacaOrderId: this._orderId(clientOrderId),
      clientOrderId,
      ticker,
      side,
      qty: Number(qty),
      status: 'filled',
      filledQty: Number(qty),
      filledAvgPrice: fillPrice,
      submittedAt: at,
      filledAt: at,
      simulation: {
        mode: this.config.mode,
        session: this.config.session,
        price: 'market_price',
        source: px.source ?? 'alpha-engine',
      },
    }
    this.orders.set(clientOrderId, order)
    return structuredClone(order)
  }

  async _fromDb(clientOrderId) {
    const e = await this.db.execution.findFirst({ where: { clientOrderId, userId: this.userId } })
    if (!e || typeof e.brokerOrderId !== 'string' || !e.brokerOrderId.startsWith(SIM_ORDER_PREFIX)) return null
    return {
      alpacaOrderId: e.brokerOrderId,
      clientOrderId,
      ticker: e.ticker,
      side: e.direction,
      qty: Number(e.quantity),
      status: e.brokerStatus && TERMINAL.has(e.brokerStatus) ? e.brokerStatus : 'filled',
      filledQty: Number(e.filledQuantity ?? e.quantity),
      filledAvgPrice: Number(e.filledPrice ?? e.price),
      submittedAt: e.submittedAt,
      filledAt: e.filledAt,
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
    const prefix = `${SIM_ORDER_PREFIX}${this.config.session || 'continuous'}_`
    if (typeof id === 'string' && id.startsWith(prefix)) {
      const o = await this._fromDb(id.slice(prefix.length))
      if (o) return o
    }
    throw wrapError({ response: { status: 404, data: { message: 'order not found' } }, message: '404' })
  }

  async cancelOrder() {
    // Simulator orders fill synchronously on submission; there is nothing open to cancel.
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
