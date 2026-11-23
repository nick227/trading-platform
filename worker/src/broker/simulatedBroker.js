/**
 * Internal simulator broker (historical_replay or paper_daily). Implements the broker
 * interface the M6 order worker uses, entirely in-process: no Alpaca client, no credentials,
 * no network calls except Alpha Engine's daily session close.
 *
 * Every order fills immediately at its session's daily close — the session recorded on the
 * execution when the bot decided (paper_daily), else the current simulator session — and is
 * labelled `simreplay_<session>_…` (replay) or `simdaily_<session>_…` (paper_daily). Fills
 * are reconstructed from the execution row after a restart. Simulated fills of daily
 * closes — never broker executions.
 */
import prisma from '../db/prisma.js'
import { engineClient } from '../../../server/src/clients/engine.js'
import { currentSimSession, isSimulatedOrderId, parseSimOrderId, sessionClock, simOrderId, simulatedAccount, simulationConfig } from '../../../server/src/services/simulationService.js'
import { wrapError } from './alpacaClient.js'

const TERMINAL = new Set(['filled', 'canceled', 'rejected', 'expired'])

export class SimulatedBroker {
  constructor(userId, { config = simulationConfig(), prismaClient = prisma, sessionClose = (t, s) => engineClient.getSessionClose(t, s), now = () => new Date(), resolveSession = () => currentSimSession({ config }) } = {}) {
    if (!config.enabled) throw new Error('simulator is not enabled')
    this.userId = userId
    this.config = config
    this.db = prismaClient
    this.sessionClose = sessionClose
    this.now = now
    this.resolveSession = resolveSession
    this.orders = new Map() // clientOrderId -> order
    this.simulated = true
  }

  async getClock() {
    // The simulator's session is a completed trading session by construction.
    const session = await this.resolveSession()
    const open = new Date(`${session}T14:30:00Z`)
    return { is_open: true, next_open: open.toISOString(), next_close: sessionClock(session).toISOString(), simulated: true, mode: this.config.mode, session }
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
    let session, px
    try {
      const row = await this.db.execution.findFirst({ where: { clientOrderId, userId: this.userId }, select: { simSession: true } })
      session = row?.simSession ?? (await this.resolveSession())
      px = await this.sessionClose(ticker, session)
    } catch (err) {
      throw wrapError({ code: 'ECONNABORTED', message: `simulator price unavailable: ${err.message}` })
    }
    if (!px || px.session !== session || !(Number(px.close) > 0)) {
      // Fail closed: never fill at a different session's price than the one decided on.
      throw wrapError({ response: { status: 422, data: { message: `no ${session} close for ${ticker}` } }, message: '422' })
    }
    const at = this.now()
    const order = {
      alpacaOrderId: simOrderId(this.config, session, clientOrderId), clientOrderId, ticker, side, qty: Number(qty),
      status: 'filled', filledQty: Number(qty), filledAvgPrice: Number(px.close), submittedAt: at, filledAt: at,
      simulation: { mode: this.config.mode, session, price: 'daily_close', source: px.source ?? 'alpha-engine' },
    }
    this.orders.set(clientOrderId, order)
    return structuredClone(order)
  }

  async _fromDb(clientOrderId) {
    const e = await this.db.execution.findFirst({ where: { clientOrderId, userId: this.userId } })
    if (!e || !isSimulatedOrderId(e.brokerOrderId)) return null
    const parsed = parseSimOrderId(e.brokerOrderId)
    return {
      alpacaOrderId: e.brokerOrderId, clientOrderId, ticker: e.ticker, side: e.direction, qty: Number(e.quantity),
      status: e.brokerStatus && TERMINAL.has(e.brokerStatus) ? e.brokerStatus : 'filled',
      filledQty: Number(e.filledQuantity ?? e.quantity), filledAvgPrice: Number(e.filledPrice ?? e.price),
      submittedAt: e.submittedAt, filledAt: e.filledAt,
      simulation: { mode: parsed.mode, session: parsed.session, price: 'daily_close' },
    }
  }

  async getOrderByClientOrderId(clientOrderId) {
    const o = this.orders.get(clientOrderId) ?? (await this._fromDb(clientOrderId))
    return o ? structuredClone(o) : null
  }

  async getOrder(id) {
    const local = [...this.orders.values()].find((o) => o.alpacaOrderId === id)
    if (local) return structuredClone(local)
    const parsed = parseSimOrderId(id)
    if (parsed) {
      const o = await this._fromDb(parsed.clientOrderId)
      if (o) return o
    }
    throw wrapError({ response: { status: 404, data: { message: 'order not found' } }, message: '404' })
  }

  async cancelOrder() {
    // Simulator orders fill on submission; there is nothing open to cancel.
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
