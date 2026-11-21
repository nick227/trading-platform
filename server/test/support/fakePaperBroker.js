/**
 * Scripted paper broker with Alpaca order semantics, for deterministic runtime tests.
 * Never talks to a network: every order lives in memory. Shared by the M6 execution
 * integrity suite and the research → trade-history end-to-end suite.
 */
import { wrapError } from '../../../worker/src/broker/alpacaClient.js'

export class FakeBroker {
  constructor(name) {
    this.name = name
    this.orders = new Map() // clientOrderId -> order
    this.submitCalls = 0
    this.buyingPower = 1_000_000
    this.nextSubmit = 'accept' // accept | lostResponse | networkBeforeReceipt | reject
    this.credentialsValid = true
    this.seenClientOrderIds = []
    this.positions = new Map() // symbol -> qty (paper account)
  }
  _auth() {
    if (!this.credentialsValid) throw wrapError({ response: { status: 401, data: { message: 'unauthorized' } }, message: 'unauthorized' })
  }
  _snap(o) { return o ? structuredClone(o) : null }
  async submitOrder({ ticker, side, qty, clientOrderId }) {
    this._auth()
    this.submitCalls += 1
    this.seenClientOrderIds.push(clientOrderId)
    const mode = this.nextSubmit
    this.nextSubmit = 'accept'
    if (mode === 'networkBeforeReceipt') throw wrapError({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' })
    if (mode === 'reject') throw wrapError({ response: { status: 422, data: { message: 'insufficient qty' } }, message: '422' })
    if (this.orders.has(clientOrderId)) throw wrapError({ response: { status: 422, data: { message: 'client_order_id must be unique' } }, message: '422' })
    const order = { alpacaOrderId: `alp_${this.orders.size + 1}_${this.name}`, clientOrderId, ticker, side, qty, status: 'new', filledQty: 0, filledAvgPrice: null, submittedAt: new Date(), filledAt: null }
    this.orders.set(clientOrderId, order)
    if (mode === 'lostResponse') throw wrapError({ code: 'ECONNRESET', message: 'socket hang up' })
    return this._snap(order)
  }
  async getOrder(id) {
    this._auth()
    const o = [...this.orders.values()].find((x) => x.alpacaOrderId === id)
    if (!o) throw wrapError({ response: { status: 404, data: { message: 'order not found' } }, message: '404' })
    return this._snap(o)
  }
  async getOrderByClientOrderId(cid) { this._auth(); return this._snap(this.orders.get(cid)) }
  async cancelOrder(id) {
    this._auth()
    const o = [...this.orders.values()].find((x) => x.alpacaOrderId === id)
    if (o && !['filled', 'canceled', 'rejected', 'expired'].includes(o.status)) o.status = 'canceled'
  }
  async getClock() { this._auth(); return { is_open: true } }
  async getAccount() { this._auth(); return { buying_power: String(this.buyingPower) } }
  // test controls
  async getPositions() {
    this._auth()
    return [...this.positions.entries()].filter(([, q]) => q !== 0).map(([symbol, qty]) => ({ symbol, qty: String(qty) }))
  }
  fill(cid, qty, price, status) {
    const o = this.orders.get(cid)
    const delta = qty - (o.filledQty ?? 0)
    this.positions.set(o.ticker, (this.positions.get(o.ticker) ?? 0) + (o.side === 'sell' ? -delta : delta))
    o.filledQty = qty
    o.filledAvgPrice = price
    o.status = status ?? (qty >= o.qty ? 'filled' : 'partially_filled')
    if (o.status === 'filled') o.filledAt = new Date()
  }
  setStatus(cid, status) { this.orders.get(cid).status = status }
  get createdOrders() { return this.orders.size }
}
