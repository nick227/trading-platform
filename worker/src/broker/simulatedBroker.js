/**
 * Internal simulator broker (historical_replay, paper_daily, continuous_paper).
 * Implements the broker interface the order worker uses, entirely in-process:
 * no Alpaca client, no credentials, no broker executions.
 */
import prisma from '../db/prisma.js'
import { engineClient } from '../../../server/src/clients/engine.js'
import { currentSimSession, isSimulatedOrderId, parseSimOrderId, sessionClock, simOrderId, simulatedAccount, simulationConfig } from '../../../server/src/services/simulationService.js'
import { priceCache } from '../market/priceCache.js'
import { wrapError } from './alpacaClient.js'

const TERMINAL = new Set(['filled', 'canceled', 'rejected', 'expired'])

export class SimulatedBroker {
  constructor(userId, {
    config = simulationConfig(),
    prismaClient = prisma,
    sessionClose = (t, s) => engineClient.getSessionClose(t, s),
    now = () => new Date(),
    resolveSession = () => currentSimSession({ config }),
  } = {}) {
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
    if (this.config.mode === 'continuous_paper') {
      const now = this.now()
      return { is_open: true, simulated: true, mode: this.config.mode, timestamp: now.toISOString() }
    }
    const session = await this.resolveSession()
    const open = new Date(`${session}T14:30:00Z`)
    return {
      is_open: true,
      next_open: open.toISOString(),
      next_close: sessionClock(session).toISOString(),
      simulated: true,
      mode: this.config.mode,
      session,
    }
  }

  async getAccount() {
    return simulatedAccount(this.userId, {
      config: this.config,
      prismaClient: this.db,
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

    let session = null
    let px = null

    if (this.config.mode === 'continuous_paper') {
      session = new Date().toISOString().slice(0, 10)
      const cached = priceCache.get(ticker)
      if (cached?.last && Number(cached.last) > 0) {
        px = { close: Number(cached.last), session, source: 'continuous-cache' }
      } else {
        try {
          const q = await engineClient.getQuote(ticker)
          const last = Number(q?.price ?? q?.last ?? q?.close)
          if (Number.isFinite(last) && last > 0) {
            px = { close: last, session, source: 'alpha-engine-quote' }
          }
        } catch { /* fallback to sessionClose */ }
      }
    }

    if (!px) {
      try {
        const row = await this.db.execution.findFirst({ where: { clientOrderId, userId: this.userId }, select: { simSession: true } })
        session = row?.simSession ?? (await this.resolveSession())
        px = await this.sessionClose(ticker, session)
      } catch (err) {
        throw wrapError({ code: 'ECONNABORTED', message: `simulator price unavailable: ${err.message}` })
      }
    }

    if (!px || (this.config.mode !== 'continuous_paper' && px.session !== session) || !(Number(px.close) > 0)) {
      throw wrapError({ response: { status: 422, data: { message: `no ${session} close for ${ticker}` } }, message: '422' })
    }

    const at = this.now()
    const fillPrice = Number(px.close)
    const order = {
      alpacaOrderId: simOrderId(this.config, session, clientOrderId),
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
        session,
        price: 'daily_close',
        source: px.source ?? 'alpha-engine',
      },
    }
    this.orders.set(clientOrderId, order)
    return structuredClone(order)
  }

  async _fromDb(clientOrderId) {
    const e = await this.db.execution.findFirst({ where: { clientOrderId, userId: this.userId } })
    if (!e || !isSimulatedOrderId(e.brokerOrderId)) return null
    const parsed = parseSimOrderId(e.brokerOrderId)
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
      simulation: { mode: parsed?.mode ?? this.config.mode, session: parsed?.session ?? this.config.session, price: 'daily_close' },
    }
  }

  async getOrderByClientOrderId(clientOrderId) {
    const o = this.orders.get(clientOrderId) ?? (await this._fromDb(clientOrderId))
    return o ? structuredClone(o) : null
  }

  async getPosition(symbol) {
    const acc = await this.getAccount()
    const p = (acc.positions || []).find((pos) => pos.symbol === symbol)
    if (!p) throw wrapError({ response: { status: 404, data: { message: 'position not found' } }, message: '404' })
    return p
  }

  async getOrder(id) {
    const local = [...this.orders.values()].find((o) => o.alpacaOrderId === id)
    if (local) return structuredClone(local)
    const parsed = parseSimOrderId(id)
    if (parsed) {
      const o = await this._fromDb(parsed.clientOrderId)
      if (o) return o
    }
    const e = await this.db.execution.findFirst({ where: { brokerOrderId: id, userId: this.userId } })
    if (e) return this._fromDb(e.clientOrderId)
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

export function createSimulatedBroker(userId, opts) {
  return new SimulatedBroker(userId, opts)
}
